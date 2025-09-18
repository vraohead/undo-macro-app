/* global ZAFClient */
const client = ZAFClient.init();

/* CONFIG */
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyh31By-Z1sEUarGBGIjrJ9-Z-V5TpHzfK9b_G1nmhbfqzMgzkV08rLNWqu41wCOxps6Q/exec';
const KEYWORDS = [
  'RO error','CO error','wrong ticket sent','wrong tickets booked',
  'manual error','refund error','payment error','booking error','ticketing error'
];
const BOOKING_ID_REGEX = /\b(?:BOOKING[_\- ]?ID|BKG[_\- ]?ID|BK[_\- ]?ID)?[:#]?\s*([A-Z]{1,3}?\d{6,}|\d{7,})\b/i;

/* Dedup */
const FP_CACHE_PREFIX = 'zdscanner_fp_';
function rememberFingerprint(fp){ try{localStorage.setItem(FP_CACHE_PREFIX+fp, Date.now());}catch{} }
function seenFingerprint(fp){ try{return localStorage.getItem(FP_CACHE_PREFIX+fp)!=null;}catch{return false;} }

/* Undo macro state */
const els = { undoBtn:null, status:null, diffWrap:null, removed:null, restored:null };
let ticketId=null, baseTags=new Set();
let watchTimer=null, refreshTimer=null;
const POLL_MS=80;
let cleanedWhileBlank=false;

function isBlankish(t){ return !t || t.replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\u00A0/g,' ').trim().length===0; }

client.on('app.registered', async () => {
  els.undoBtn=document.getElementById('undoBtn');
  els.status=document.getElementById('status');
  els.diffWrap=document.getElementById('diff');
  els.removed=document.getElementById('removedTags');
  els.restored=document.getElementById('restoredTags');
  if(els.undoBtn) els.undoBtn.addEventListener('click', onUndo);

  try {
    ticketId=(await client.get('ticket.id'))['ticket.id'];
    await refreshBaseTags();
    startWatchers();
    await scanExistingCommentsAndLog();
  } catch(e){ console.error(e); }

  client.on('ticket.submit', onTicketSubmitCheckAndLog);
});

/* Undo logic (unchanged) */
function startWatchers(){ stopWatchers(); watchTimer=setInterval(checkStateAndAutoCleanOnBlank,POLL_MS); refreshTimer=setInterval(refreshBaseTags,8000); }
function stopWatchers(){ if(watchTimer)clearInterval(watchTimer); if(refreshTimer)clearInterval(refreshTimer); }
async function checkStateAndAutoCleanOnBlank(){
  try{
    const comment=(await client.get('ticket.comment.text'))['ticket.comment.text']||'';
    const tagsArr=(await client.get('ticket.tags'))['ticket.tags']||[];
    const tags=new Set(tagsArr);
    const blank=isBlankish(comment);
    const tagsDrifted=!setsEqual(tags,baseTags);
    if(blank && !cleanedWhileBlank && tagsDrifted){
      await autoClearAndReset(tags,baseTags);
      cleanedWhileBlank=true; return;
    } else if(!blank){ cleanedWhileBlank=false; }
  }catch{}
}
async function autoClearAndReset(uiTagsSet,baseTagsSet){
  await client.set('ticket.comment.text','');
  await client.set('ticket.tags',Array.from(baseTagsSet));
  showDiff([...uiTagsSet].filter(t=>!baseTagsSet.has(t)),[...baseTagsSet].filter(t=>!uiTagsSet.has(t)));
  setStatus('Auto: reset tags to last saved.',true);
}
async function refreshBaseTags(){
  try{ const res=await client.request({url:`/api/v2/tickets/${ticketId}.json`,type:'GET'});
       baseTags=new Set(res?.ticket?.tags||[]);}catch{}
}
async function onUndo(){
  setStatus('Working…'); setDisabled(true); hideDiff();
  try{
    const uiTags=new Set(((await client.get('ticket.tags'))['ticket.tags'])||[]);
    await refreshBaseTags();
    await client.set('ticket.comment.text','');
    await client.set('ticket.tags',Array.from(baseTags));
    showDiff([...uiTags].filter(t=>!baseTags.has(t)),[...baseTags].filter(t=>!uiTags.has(t)));
    setStatus('Macro text cleared and tags reset.',true);
  }catch(e){setStatus('Could not undo',false);}finally{setDisabled(false);}
}
function setStatus(msg,ok){ els.status.textContent=msg; els.status.className='status'+(ok===true?' success':ok===false?' error':''); }
function setDisabled(d){ if(els.undoBtn)els.undoBtn.disabled=d; }
function showDiff(removed,restored){
  els.removed.innerHTML=(removed.length?removed:['—']).map(t=>`<span class="tag">${t}</span>`).join(' ');
  els.restored.innerHTML=(restored.length?restored:['—']).map(t=>`<span class="tag">${t}</span>`).join(' ');
  els.diffWrap.hidden=false;
}
function hideDiff(){ els.diffWrap.hidden=true; els.removed.textContent=''; els.restored.textContent=''; }
function setsEqual(a,b){ if(a.size!==b.size)return false; for(const v of a) if(!b.has(v)) return false; return true; }

/* Keyword logging */
function matchAnyKeyword(text,keywords){ for(const kw of keywords){ if(new RegExp(kw,'i').test(text)) return kw; } return null; }
function extractBookingId(text){ const m=text.match(BOOKING_ID_REGEX); return m?m[1]||m[0]:''; }

async function onTicketSubmitCheckAndLog(){
  try{
    const comment=(await client.get('ticket.comment.text'))['ticket.comment.text']||'';
    if(!comment) return;
    const kwHit=matchAnyKeyword(comment,KEYWORDS);
    if(!kwHit) return;
    const id=(await client.get('ticket.id'))['ticket.id'];
    const ctx=await client.context(); const subdomain=ctx?.account?.subdomain||window.location.hostname.split('.')[0];
    const link=`https://${subdomain}.zendesk.com/agent/tickets/${id}`;
    const fp=`t${id}|kw:${kwHit}|s:${comment.slice(0,32)}`;
    if(seenFingerprint(fp)) return; rememberFingerprint(fp);
    const row={timestamp:new Date().toISOString(),ticket_id:id,ticket_link:link,
               booking_id:extractBookingId(comment),matched_text:comment.slice(0,3000),
               matched_keyword:kwHit,fingerprint:fp};
    await postToWebhook(WEBHOOK_URL,{rows:[row]});
  }catch(e){ console.debug('Keyword log failed',e); }
}

async function scanExistingCommentsAndLog(){
  try{
    const id=(await client.get('ticket.id'))['ticket.id'];
    const ctx=await client.context(); const subdomain=ctx?.account?.subdomain||window.location.hostname.split('.')[0];
    const link=`https://${subdomain}.zendesk.com/agent/tickets/${id}`;
    let page=`/api/v2/tickets/${id}/comments.json?sort_order=desc`; const rows=[];
    while(page){
      const res=await client.request({url:page,type:'GET'}); const comments=res?.comments||[];
      for(const c of comments){
        const text=c.body||''; if(!text) continue;
        const kwHit=matchAnyKeyword(text,KEYWORDS); if(!kwHit) continue;
        const fp=`t${id}|kw:${kwHit}|cid:${c.id}`;
        if(seenFingerprint(fp)) continue; rememberFingerprint(fp);
        rows.push({timestamp:c.created_at,ticket_id:id,ticket_link:link,
                   booking_id:extractBookingId(text),matched_text:text.slice(0,3000),
                   matched_keyword:kwHit,fingerprint:fp});
      }
      page=res?.next_page?res.next_page.replace(/^https?:\/\/[^/]+/,''):null;
      if(rows.length>100) break;
    }
    if(rows.length) await postToWebhook(WEBHOOK_URL,{rows});
  }catch(e){ console.debug('Load-scan failed',e); }
}

async function postToWebhook(url,payload){
  return client.request({
    url, type:'POST', cors:true,
    contentType:'application/json',
    data:JSON.stringify(payload)
  });
}
