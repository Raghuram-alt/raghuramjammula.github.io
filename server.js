import express from 'express';
import PDFDocument from 'pdfkit';
import { fetchTranscript } from 'youtube-transcript-plus';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { samples } from './public/data.js';
import { InputError, youtubeId, normalizeResult } from './lib.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const MAX_PDF_CHARACTERS = 300_000;
const MAX_PDF_JOBS = 2;
const clock = value => `${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
export function createApp({ provider=fetchTranscript, dataDir=process.env.TRANSCRIBE_DATA_DIR||path.join(root,'.data') }={}) {
 const app=express();let active=0;let activePdfs=0;
 app.disable('x-powered-by');
 app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");next();});
 app.use(express.json({limit:'4kb'}));
 async function getItem(id){
  const sample=samples.find(s=>s.id===id);if(sample)return sample;
  if(!/^[a-f0-9]{32}$/.test(id))return null;
  try{return JSON.parse(await readFile(path.join(dataDir,id+'.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 app.get('/api/health',(_req,res)=>res.json({status:'ok'}));
 app.post('/api/transcribe',async(req,res)=>{
  let counted=false;
  try{
   const videoId=youtubeId(req.body?.url);
   const id=createHash('sha256').update('transcribe-v1:'+videoId).digest('hex').slice(0,32);
   const cached=await getItem(id);if(cached)return res.json(cached);
   if(active>=3)return res.status(429).json({error:'A few transcripts are in progress. Please try again in a moment.'});
   active++;counted=true;
   const result=await provider(videoId,{videoDetails:true,signal:AbortSignal.timeout(45000)});
   const item={id,...normalizeResult(result),sourceUrl:`https://www.youtube.com/watch?v=${videoId}`,topic:'Video',image:'studio',createdAt:new Date().toISOString(),permalink:`/?transcript=${id}`};
   await mkdir(dataDir,{recursive:true});const temporary=path.join(dataDir,id+'.'+randomUUID()+'.tmp');
   await writeFile(temporary,JSON.stringify(item),{mode:0o600});await rename(temporary,path.join(dataDir,id+'.json'));
   res.status(201).json(item);
  }catch(error){
   if(error instanceof InputError)return res.status(422).json({error:error.message});
   if(error.name==='TimeoutError'||error.name==='AbortError')return res.status(504).json({error:'YouTube is taking longer than expected. Please try this link again in a moment.'});
   if(error.code==='EACCES'||error.code==='ENOSPC')return res.status(503).json({error:'We couldn’t save your transcript right now. Please try again shortly.'});
   res.status(502).json({error:'We couldn’t retrieve captions for this video. It may be private, have captions disabled, or YouTube may be temporarily limiting access. Try another link or explore an example below.'});
  }finally{if(counted)active--;}
 });
 app.get('/api/transcripts/:id',async(req,res)=>{const item=await getItem(req.params.id);if(!item)return res.status(404).json({error:'This transcript wasn’t found. Please check the link or transcribe the video again.'});res.setHeader('Cache-Control','no-store');res.json(item);});
 app.get('/api/transcripts/:id/pdf',async(req,res)=>{
  const item=await getItem(req.params.id);if(!item)return res.status(404).json({error:'This transcript wasn’t found.'});
  if(activePdfs>=MAX_PDF_JOBS)return res.status(429).json({error:'A few PDFs are being prepared. Please try again in a moment.'});
  const characters=item.segments.reduce((count,segment)=>count+segment.text.length,0)+item.summary.join('').length+item.title.length+item.creator.length;
  if(characters>MAX_PDF_CHARACTERS)return res.status(413).json({error:'This transcript is too large for PDF export. Please download the TXT version.'});
  activePdfs++;
  try{
   const doc=new PDFDocument({size:'A4',margin:55,info:{Title:item.title,Author:'transcribe'}});
   const chunks=[];
   const finished=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
   // Attach immediately so a synchronous rendering failure cannot leave an unhandled rejection.
   finished.catch(()=>{});
   doc.registerFont('Body',path.join(root,'public/assets/font-0.ttf'));
   doc.registerFont('Heading',path.join(root,'public/assets/font-6.ttf'));
   doc.font('Heading').fontSize(24).fillColor('#a13d2d').text('transcribe.');doc.moveDown(.7);
   doc.fontSize(27).fillColor('#242922').text(item.title);doc.moveDown(.5);
   doc.font('Body').fontSize(10).fillColor('#74796c').text(`${item.creator}  ·  ${clock(item.duration)}${item.sample?'  ·  Original editorial sample':''}`);doc.moveDown(1.5);
   doc.font('Heading').fontSize(19).fillColor('#a13d2d').text('The short version');doc.moveDown(.5);
   doc.font('Body').fontSize(11).fillColor('#333b2e');for(const point of item.summary){doc.text(point,{lineGap:4});doc.moveDown(.7);}
   doc.moveDown(.5);doc.font('Heading').fontSize(19).fillColor('#a13d2d').text('The full transcript');doc.moveDown(.6);
   for(const segment of item.segments){doc.font('Body').fontSize(9).fillColor('#a13d2d').text(clock(segment.offset));doc.moveDown(.2);doc.fontSize(11).fillColor('#333b2e').text(segment.text,{lineGap:4});doc.moveDown();}
   doc.fontSize(9).fillColor('#74796c').text(item.sample?'Original editorial sample. Not a transcript of a real video.':`Source: ${item.sourceUrl}\nCaptions may contain errors. Summary highlights are selected from the transcript.`);
   doc.end();const pdf=await finished;
   res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="transcript-${item.id}.pdf"`);res.setHeader('Cache-Control','no-store');res.send(pdf);
  }catch{res.status(503).json({error:'We couldn’t generate the PDF. Please try again or download the TXT version.'});}finally{activePdfs--;}
 });
 app.use('/api',(_req,res)=>res.status(404).json({error:'This API endpoint does not exist.'}));
 app.use(express.static(path.join(root,'public'),{dotfiles:'deny'}));
 app.get('/',(_req,res)=>res.sendFile(path.join(root,'index.html')));
 app.use((_req,res)=>res.status(404).send('Page not found. Return to / to transcribe a video.'));
 app.use((error,_req,res,_next)=>{if(res.headersSent)return res.end();res.status(error.status===400?400:error.status===413?413:500).json({error:error.status===400?'Send a valid JSON request.':error.status===413?'This request is too large. Send only a YouTube URL.':'Something went wrong. Please try again shortly.'});});
 return app;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||3000);createApp().listen(port,'0.0.0.0',()=>console.log(`transcribe is ready at http://localhost:${port}`));
}
