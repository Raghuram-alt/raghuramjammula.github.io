import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { youtubeId, normalizeResult, summarize } from '../lib.js';
const fixture = { videoDetails: { title:'A useful conversation', author:'Test creator', lengthSeconds:120, isLiveContent:false }, segments:[{offset:0,duration:30,text:'Careful attention helps us understand the work in front of us. Small daily habits make careful attention easier to practice.'},{offset:35,duration:30,text:'A useful tool can remove unnecessary effort from the work. The goal is to make space for ideas that deserve careful attention.'}] };
test('accepts supported URLs and rejects malformed or external hosts',()=>{
 for(const url of ['https://youtu.be/arj7oStGLkU','https://www.youtube.com/watch?v=arj7oStGLkU&t=12','https://m.youtube.com/shorts/arj7oStGLkU','https://youtube.com/embed/arj7oStGLkU'])assert.equal(youtubeId(url),'arj7oStGLkU');
 for(const url of ['https://youtube.com.evil.test/watch?v=arj7oStGLkU','http://localhost/video','https://youtube.com/watch?v=no','javascript:alert(1)','https://user:pass@youtube.com/watch?v=arj7oStGLkU','https://youtu.be/arj7oStGLkU/extra',null])assert.throws(()=>youtubeId(url));
});
test('duration limit, missing metadata, live content, empty captions',()=>{
 assert.equal(normalizeResult({...fixture,videoDetails:{...fixture.videoDetails,lengthSeconds:5400}}).duration,5400);
 for(const videoDetails of [{...fixture.videoDetails,lengthSeconds:5401},{...fixture.videoDetails,lengthSeconds:undefined},{...fixture.videoDetails,isLiveContent:true}])assert.throws(()=>normalizeResult({...fixture,videoDetails}));
 assert.throws(()=>normalizeResult({...fixture,segments:[]}));
});
test('summary is bounded and extracted from source text',()=>{
 const result=summarize(fixture.segments);assert.ok(result.length>0&&result.length<=3);for(const sentence of result)assert.ok(fixture.segments.some(s=>s.text.includes(sentence)));
});
async function harness(t,provider){const dataDir=await mkdtemp(path.join(os.tmpdir(),'transcribe-test-'));const app=createApp({provider,dataDir});const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});});return {base:`http://127.0.0.1:${server.address().port}`,dataDir};}
const post=(base,url)=>fetch(base+'/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
test('successful transcription persists, caches, reloads and exports real PDF',async t=>{
 let calls=0;const {base,dataDir}=await harness(t,async()=>{calls++;return fixture;});
 const response=await post(base,'https://youtu.be/arj7oStGLkU');assert.equal(response.status,201);const item=await response.json();assert.equal(item.title,fixture.videoDetails.title);assert.match(item.permalink,/^\/\?transcript=[a-f0-9]{32}$/);
 assert.equal((await fetch(base+'/api/transcripts/'+item.id)).status,200);assert.equal((await post(base,'https://youtu.be/arj7oStGLkU')).status,200);assert.equal(calls,1);
 const pdf=await fetch(base+'/api/transcripts/'+item.id+'/pdf');assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/application\/pdf/);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
 const app2=createApp({dataDir,provider:()=>{throw Error('Must use persisted data');}});const server2=await new Promise(resolve=>{const s=app2.listen(0,'127.0.0.1',()=>resolve(s));});try{const restored=await fetch(`http://127.0.0.1:${server2.address().port}/api/transcripts/${item.id}`);assert.equal((await restored.json()).title,item.title);}finally{await new Promise(resolve=>server2.close(resolve));}
});
test('provider error and invalid requests have graceful status and JSON',async t=>{
 const {base}=await harness(t,async()=>{throw Error('upstream credential or internal detail');});
 assert.equal((await post(base,'https://example.com/test')).status,422);
 const response=await post(base,'https://youtu.be/arj7oStGLkU');assert.equal(response.status,502);const body=await response.json();assert.match(body.error,/captions/);assert.ok(!body.error.includes('internal detail'));
 assert.equal((await fetch(base+'/api/transcripts/unknown')).status,404);
 assert.equal((await fetch(base+'/api/transcripts/unknown/pdf')).status,404);
 assert.equal((await fetch(base+'/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'})).status,400);
 assert.equal((await fetch(base+'/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'x'.repeat(5000)})})).status,413);
});
test('sample PDF remains available without the caption provider',async t=>{
 const {base}=await harness(t,async()=>{throw Error('unused');});const response=await fetch(base+'/api/transcripts/sample-creative-practice/pdf');assert.equal(response.status,200);assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
});

test('oversized PDF is rejected while the saved transcript remains available',async t=>{
 const {base,dataDir}=await harness(t,async()=>fixture);
 const id='1'.repeat(32);
 const item={id,title:'Large transcript',creator:'Fixture',duration:5400,summary:['Large fixture'],segments:[{offset:0,text:'x'.repeat(300001)}]};
 await writeFile(path.join(dataDir,id+'.json'),JSON.stringify(item));
 const response=await fetch(base+'/api/transcripts/'+id+'/pdf');
 assert.equal(response.status,413);assert.match((await response.json()).error,/TXT/);
 assert.equal((await fetch(base+'/api/transcripts/'+id)).status,200);
});
