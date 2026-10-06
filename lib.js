export class InputError extends Error {}
export function youtubeId(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new InputError('Paste a valid YouTube video URL.');
  let url;
  try { url = new URL(value); } catch { throw new InputError('Paste a full YouTube video URL.'); }
  const host = url.hostname.toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host)) throw new InputError('Please use a youtube.com or youtu.be video link.');
  const id = host === 'youtu.be' ? url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1] : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1];
  if (!/^[\w-]{11}$/.test(id || '')) throw new InputError('This link is missing a valid video ID. Please copy the video’s share link.');
  return id;
}
export function summarize(segments) {
  const stop = new Set('the a an and or to of in is it that this for on with as be are was were you your we our they their i my at by from have has had not but can will would do so if about what how'.split(' '));
  const text = segments.map(s=>s.text).join(' ').replace(/\s+/g,' ').trim();
  let sentences = text.match(/[^.!?]+[.!?]+(?:[”’"']|$)?|[^.!?]+$/g)?.map(s=>s.trim()).filter(s=>s.length>=45 && s.length<=480) || [];
  if (!sentences.length) sentences = segments.map(s=>s.text).filter(Boolean).map(s=>s.length>350?s.slice(0,347)+'…':s).slice(0,60);
  const words = value => value.toLowerCase().match(/[a-z]{3,}/g)?.filter(w=>!stop.has(w)) || [];
  const frequencies = new Map();
  for (const word of words(text)) frequencies.set(word,(frequencies.get(word)||0)+1);
  const seen = new Set();
  return sentences.map((sentence,index)=>({sentence,index,score:words(sentence).reduce((n,w)=>n+(frequencies.get(w)||0),0)/Math.sqrt(Math.max(1,words(sentence).length))})).filter(x=>{const key=x.sentence.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>b.score-a.score).slice(0,3).sort((a,b)=>a.index-b.index).map(x=>x.sentence);
}
export function normalizeResult(result) {
  const duration = Number(result?.videoDetails?.lengthSeconds);
  if (!Number.isFinite(duration) || duration<=0 || result.videoDetails.isLiveContent) throw new InputError('We couldn’t confirm the length of this video. Please choose a completed video up to 90 minutes.');
  if (duration>5400) throw new InputError('This video is longer than 90 minutes. Try a shorter video to keep going.');
  const segments = (Array.isArray(result.segments)?result.segments:[]).filter(s=>typeof s.text==='string' && Number.isFinite(Number(s.offset))).map(s=>({offset:Math.max(0,Number(s.offset)),text:s.text.replace(/\s+/g,' ').trim()})).filter(s=>s.text);
  if (!segments.length) throw new InputError('This video doesn’t have readable captions. Please try another video.');
  if(segments.length>30000 || segments.reduce((n,s)=>n+s.text.length,0)>2_000_000) throw new InputError('This transcript is too large to process. Please try a shorter video.');
  // Group short caption lines into readable paragraphs while preserving the start timestamp.
  const paragraphs=[];
  for(const segment of segments){const last=paragraphs.at(-1);if(last && last.text.length<500 && segment.offset-last.offset<55) last.text+=' '+segment.text;else paragraphs.push({...segment});}
  return {title:String(result.videoDetails.title||'Untitled video').slice(0,500),creator:String(result.videoDetails.author||'YouTube creator').slice(0,200),duration,segments:paragraphs,summary:summarize(segments)};
}
