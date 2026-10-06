import { samples } from './data.js';
const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2,'0')}`;
let recent = [];
try { recent = JSON.parse(localStorage.getItem('transcribe-recent') || '[]'); if (!Array.isArray(recent)) recent = []; recent = recent.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.segments)).slice(0,12); } catch { recent = []; }
let currentView = 'latest', filter = null, showAll = false, currentTranscript = null, toastTimer, requestSequence = 0;
const reader = $('#reader-dialog');
function toast(message) { clearTimeout(toastTimer); (document.querySelector('dialog[open]') || document.body).append($('#toast')); $('#toast').textContent=message; $('#toast').hidden=false; toastTimer=setTimeout(()=>$('#toast').hidden=true,3500); }
function allItems(){ return [...recent,...samples]; }
function readMinutes(item){ return Math.max(1,Math.ceil(item.segments.reduce((n,s)=>n+s.text.split(/\s+/).length,0)/220)); }
function card(item){
 const theme=['studio','forest','robot'].includes(item.image)?item.image:'studio';
 return `<button class="transcript-card" data-transcript="${escape(item.id)}" aria-label="Read ${escape(item.title)}"><div class="card-image ${theme}"><img src="/assets/${theme}.jpg" alt="" loading="lazy"><span class="thumbnail-label">${escape(item.kicker||'A CONVERSATION WORTH KEEPING')}</span><span class="thumbnail-heading">${item.sample?item.thumbnail:escape(item.title).slice(0,95)}</span><span class="thumbnail-footer">${escape(item.creator)}</span><span class="duration">${clock(item.duration)}</span></div><div class="card-meta"><span class="category ${escape((item.topic||'Video').toLowerCase().replace(/\s/g,'-'))}">${escape((item.topic||'VIDEO').toUpperCase())}</span><span>${item.sample?'EDITOR’S PICK':'JUST TRANSCRIBED'}</span></div><h3 class="card-title">${escape(item.title)}</h3><div class="card-creator"><span class="creator-avatar ${theme}">${escape(item.initials||item.creator?.slice(0,2)||'YT')}</span>${escape(item.creator)}</div><div class="card-bottom"><span>${readMinutes(item)} min read${item.sample?' · Editorial sample':''}</span><span class="read-link">Read transcript <span>↗</span></span></div></button>`;
}
function render(){
 const content=$('#browse-content'); let items=allItems();
 document.querySelectorAll('[data-view]').forEach(tab=>{const active=tab.dataset.view===currentView;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
 content.setAttribute('aria-labelledby',`${currentView}-tab`);
 if(currentView==='latest'||filter){
   if(filter)items=items.filter(x=>x[currentView==='creators'?'creator':'topic']===filter);
   const visible=showAll||filter?items:items.slice(0,3);
   content.innerHTML=(filter?`<div class="filter-header"><button id="back-directory">← All ${currentView}</button><span>${escape(filter)}</span></div>`:'')+`<div class="card-grid">${visible.map(card).join('')}</div>`;
   $('#more-button').hidden=!!filter||items.length<=3;$('#more-button').innerHTML=showAll?'Show less <span>↑</span>':'More to explore <span>↓</span>';
 }else{
   const key=currentView==='creators'?'creator':'topic';
   const values=[...new Set(items.map(item=>item[key]||'Video'))];
   content.innerHTML=`<div class="directory-grid">${values.map(value=>{const members=items.filter(item=>(item[key]||'Video')===value);return `<button class="directory-card" data-filter="${escape(value)}"><span class="creator-avatar ${escape(members[0].image||'')}">${escape(currentView==='creators'?members[0].initials||'YT':'#')}</span><div><h3>${escape(value)}</h3><p>${members.length} reads to explore</p></div><span>↗</span></button>`;}).join('')}</div>`;
   $('#more-button').hidden=true;
 }
 $('#library-caption').textContent=filter?`A little more on ${filter.toLowerCase()}.`:currentView==='latest'?'A few handpicked reads to get you started.':currentView==='creators'?'Follow a familiar voice. Find a new perspective.':'A little curiosity goes a long way.';
}
function transcriptText(item){return `${item.title}\n${item.creator}\n${item.sample?'Original editorial sample — not a recording transcript.\n':''}\nSUMMARY\n${item.summary.join('\n\n')}\n\nTRANSCRIPT\n${item.segments.map(segment=>`[${clock(segment.offset)}] ${segment.text}`).join('\n\n')}\n\n${new URL(item.permalink,location.origin).href}\n`;}
function showTranscript(item,updateUrl=true){
 currentTranscript=item;
 $('#reader-content').innerHTML=`<span class="reader-eyebrow">${item.sample?'THE READING ROOM · EDITORIAL SAMPLE':'YOUR WORDS, READY TO READ'}</span><h2 id="reader-title">${escape(item.title)}</h2><div class="reader-meta"><span>${escape(item.creator)}</span><span>·</span><span>${clock(item.duration)}</span><span>·</span><span>${readMinutes(item)} min read</span>${item.sourceUrl?`<a href="${escape(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a>`:''}</div><div class="reader-actions"><button class="outline-button" id="copy-transcript">Copy transcript</button><button class="outline-button" id="download-txt">↓ Download TXT</button><button class="outline-button" id="download-pdf">↓ Download PDF</button><button class="outline-button share-button" id="share-transcript">Share link ↗</button></div><div id="action-error" class="action-error" role="alert" hidden></div><div class="summary-box"><h3>The short version <span aria-hidden="true">✳</span></h3><ul>${item.summary.map(point=>`<li>${escape(point)}</li>`).join('')}</ul></div><div class="reader-section-title"><h3>The full transcript</h3><span>${item.sample?'ORIGINAL EDITORIAL SAMPLE':'FROM AVAILABLE YOUTUBE CAPTIONS'}</span></div><div class="transcript-body">${item.segments.map(segment=>`<div class="transcript-segment"><span class="timestamp">${clock(segment.offset)}</span><p>${escape(segment.text)}</p></div>`).join('')}</div><p class="reader-note">${item.sample?'This is an original editorial sample created to demonstrate transcribe. It is not a transcript of a real video.':'Summary highlights are selected from the transcript. Captions may contain errors; refer to the original video for verification.'}</p>`;
 if(!reader.open)reader.showModal(); reader.scrollTop=0;
 if(updateUrl){const url=new URL(location.href);url.searchParams.set('transcript',item.id);history.pushState({},'',url);}
}
async function openTranscript(id,updateUrl=true){
 const sequence=++requestSequence;
 const item=allItems().find(x=>x.id===id); if(item){showTranscript(item,updateUrl);return;}
 try{const response=await fetch(`/api/transcripts/${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('This transcript link is unavailable. Try a new video or an example.');const data=await response.json();if(sequence===requestSequence)showTranscript(data,updateUrl);}catch(error){toast(error.name==='TimeoutError'?'Loading took too long. Please try again.':error.message);}
}
function actionError(message){$('#action-error').textContent=message;$('#action-error').hidden=false;}
async function copy(text,success){try{await navigator.clipboard.writeText(text);toast(success);}catch{if(reader.open)actionError('Clipboard access is unavailable. Download the TXT file to keep these words.');else toast('Clipboard access is unavailable in this browser. Select and copy the text.');}}
function download(blob,name){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function safeName(){return currentTranscript.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'transcript';}
document.addEventListener('click',async event=>{
 const target=event.target.closest('button,[data-transcript]');if(!target)return;
 if(target.dataset.open){$('#'+target.dataset.open).showModal();return;}
 if(target.hasAttribute('data-close')){target.closest('dialog').close();return;}
 if(target.dataset.view){currentView=target.dataset.view;filter=null;showAll=false;render();return;}
 if(target.dataset.filter){filter=target.dataset.filter;render();return;}
 if(target.dataset.transcript){openTranscript(target.dataset.transcript);return;}
 switch(target.id){
  case 'try-example':openTranscript(samples[0].id);break;
  case 'back-directory':filter=null;render();break;
  case 'more-button':showAll=!showAll;render();break;
  case 'how-start':$('#how-dialog').close();$('#video-url').focus();$('#transcribe-form').scrollIntoView({block:'center'});break;
  case 'copy-transcript':await copy(transcriptText(currentTranscript),'Transcript copied. Make it yours.');break;
  case 'share-transcript':await copy(new URL(currentTranscript.permalink,location.origin).href,'Link copied. Good ideas travel.');break;
  case 'download-txt':download(new Blob([transcriptText(currentTranscript)],{type:'text/plain;charset=utf-8'}),safeName()+'.txt');toast('Your transcript is ready to keep.');break;
  case 'download-pdf':{
   const item=currentTranscript;const filename=safeName()+'.pdf';target.disabled=true;target.textContent='Preparing PDF…';$('#action-error').hidden=true;
   try{const response=await fetch(`/api/transcripts/${encodeURIComponent(item.id)}/pdf`,{signal:AbortSignal.timeout(20000)});if(!response.ok||!response.headers.get('content-type')?.includes('application/pdf'))throw new Error('PDF unavailable');download(await response.blob(),filename);toast('Your PDF is ready to keep.');}catch{if(currentTranscript===item)actionError('We couldn’t create your PDF. Please try again, or download the TXT version — your transcript is still here.');}finally{target.disabled=false;target.textContent='↓ Download PDF';}break;
  }
  case 'copy-api':await copy($('#api-code').textContent,'API example copied.');break;
  case 'clear-history':try{localStorage.removeItem('transcribe-recent');recent=[];render();toast('Your local reading history is clear.');}catch{toast('Your browser couldn’t clear local history. Try your browser’s site settings.');}break;
 }
});
$('#browse-tabs').addEventListener('keydown',event=>{const tabs=[...document.querySelectorAll('[data-view]')];const index=tabs.indexOf(document.activeElement);if(index<0)return;let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();tabs[next].click();tabs[next].focus();});
$('#browse-all').addEventListener('click',()=>{currentView='latest';filter=null;showAll=true;render();});
reader.addEventListener('close',()=>{requestSequence++;const url=new URL(location.href);if(url.searchParams.has('transcript')){url.searchParams.delete('transcript');history.replaceState({},'',url);}currentTranscript=null;});
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
window.addEventListener('popstate',()=>{const id=new URL(location.href).searchParams.get('transcript');if(id)openTranscript(id,false);else{requestSequence++;if(reader.open)reader.close();}});
$('#transcribe-form').addEventListener('submit',async event=>{
 event.preventDefault();const input=$('#video-url'),button=$('#submit-button'),errorBox=$('#form-error');errorBox.hidden=true;input.removeAttribute('aria-invalid');
 const value=input.value.trim();let parsed;
 try{parsed=new URL(value);const host=parsed.hostname.toLowerCase();if(!['https:','http:'].includes(parsed.protocol)||!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host))throw new Error();let id=host==='youtu.be'?parsed.pathname.slice(1).split('/')[0]:parsed.pathname==='/watch'?parsed.searchParams.get('v'):parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1];if(!/^[\w-]{11}$/.test(id||''))throw new Error();}catch{errorBox.textContent='That doesn’t look like a YouTube video link. Paste a full youtube.com or youtu.be URL and try again.';errorBox.hidden=false;input.setAttribute('aria-invalid','true');input.focus();return;}
 button.disabled=true;input.readOnly=true;button.innerHTML='<span>Finding the words…</span><i class="loading-ring" aria-hidden="true"></i>';$('#transcribe-form').setAttribute('aria-busy','true');
 try{
  const response=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:value}),signal:AbortSignal.timeout(60000)});
  let item;try{item=await response.json();}catch{throw new Error('The transcription service is unavailable. Please try again in a moment.');}
  if(!response.ok)throw new Error(item.error||'We couldn’t transcribe this video. Please try another link.');
  recent=[item,...recent.filter(x=>x.id!==item.id)].slice(0,12);try{localStorage.setItem('transcribe-recent',JSON.stringify(recent));}catch{toast('Transcript saved. Browser history is full; keep the share link to return.');}
  currentView='latest';filter=null;showAll=false;render();showTranscript(item);input.value='';
 }catch(error){errorBox.textContent=error.name==='TimeoutError'?'This is taking longer than expected. Please try again in a moment.':error.message;errorBox.hidden=false;}
 finally{button.disabled=false;input.readOnly=false;button.innerHTML='<span>Transcribe</span><span aria-hidden="true">↗</span>';$('#transcribe-form').removeAttribute('aria-busy');}
});
$('#year').textContent=new Date().getFullYear();
$('#api-code').textContent=`curl -X POST '${location.origin}/api/transcribe' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"url":"https://www.youtube.com/watch?v=arj7oStGLkU"}'`;
render();
const initialId=new URL(location.href).searchParams.get('transcript');if(initialId)openTranscript(initialId,false);
