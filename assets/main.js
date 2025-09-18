/* global ZAFClient */
const client = ZAFClient.init();

/* ===================== CONFIG ===================== */
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyh31By-Z1sEUarGBGIjrJ9-Z-V5TpHzfK9b_G1nmhbfqzMgzkV08rLNWqu41wCOxps6Q/exec';

const KEYWORDS = [
  'RO error', 'CO error', 'wrong ticket sent', 'wrong tickets booked',
  'manual error', 'refund error', 'payment error', 'booking error', 'ticketing error'
];

const BOOKING_ID_REGEX = /\b(?:BOOKING[_\- ]?ID|BKG[_\- ]?ID|BK[_\- ]?ID)?[:#]?\s*([A-Z]{1,3}?\d{6,}|\d{7,})\b/i;

/* Local dedupe (per browser session) */
const FP_CACHE_PREFIX = 'zdscanner_fp_';
function rememberFingerprint(fp) { try { localStorage.setItem(FP_CACHE_PREFIX + fp, String(Date.now())); } catch {} }
function seenFingerprint(fp) { try { return localStorage.getItem(FP_CACHE_PREFIX + fp) != null; } catch { return false; } }
/* ================================================== */

/* ---------- EXISTING UNDO UI HOOKS (unchanged) ---------- */
const els = { undoBtn: null, status: null, diffWrap: null, removed: null, restored: null };

let ticketId = null;
let baseTags = new Set();
let lastComment = '';
let lastTags = new Set();

let watchTimer = null;
let refreshTimer = null;

const POLL_MS = 80;

function isBlankish(text) {
  if (!text) return true;
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ').trim().length === 0;
}

client.on('app.registered', async () => {
  els.undoBtn  = document.getElementById('undoBtn');
  els.status   = document.getElementById('status');
  els.diffWrap = document.getElementById('diff');
  els.removed  = document.getElementById('removedTags');
  els.restored = document.getElementById('restoredTags');
  if (els.undoBtn) els.undoBtn.addEventListener('click', onUndo);

  try {
    ticketId = (await client.get('ticket.id'))['ticket.id'];
    await refreshBaseTags();
    startWatchers();

    // ✅ Scan existing comments on load (so old “RO error” is logged when you open)
    await scanExistingCommentsAndLog();
  } catch (e) {
    console.error('Init failed', e);
    setStatus('Could not initialize. Refresh the ticket.', false);
  }

  // ✅ Real-time on submit
  client.on('ticket.submit', onTicketSubmitCheckAndLog);
});

/* ---------------- Undo behavior ---------------- */
function startWatchers() {
  stopWatchers();
  watchTimer = setInterval(checkStateAndAutoCleanOnBlank, POLL_MS);
  refreshTimer = setInterval(refreshBaseTags, 8000);
}
function stopWatchers() {
  if (watchTimer)  { clearInterval(watchTimer);  watchTimer = null; }
  if (refreshTimer){ clearInterval(refreshTimer);refreshTimer = null; }
}
let cleanedWhileBlank = false;

async function checkStateAndAutoCleanOnBlank() {
  try {
    const comment = (await client.get('ticket.comment.text'))['ticket.comment.text'] || '';
    const tagsArr = (await client.get('ticket.tags'))['ticket.tags'] || [];
    const tags = new Set(tagsArr);
    const blank = isBlankish(comment);
    const tagsDrifted = !setsEqual(tags, baseTags);

    if (blank) {
      if (!cleanedWhileBlank && tagsDrifted) {
        await autoClearAndReset({ reason: 'Auto: comment cleared' }, tags, baseTags);
        cleanedWhileBlank = true;
        lastComment = '';
        lastTags = new Set(baseTags);
        return;
      }
    } else {
      cleanedWhileBlank = false;
    }
    lastComment = comment;
    lastTags = tags;
  } catch (e) {}
}

async function autoClearAndReset(meta, uiTagsSet, baseTagsSet) {
  const removed = [...uiTagsSet].filter(t => !baseTagsSet.has(t));
  const restored = [...baseTagsSet].filter(t => !uiTagsSet.has(t));
  await client.set('ticket.comment.text', '');
  await client.set('ticket.tags', Array.from(baseTagsSet));
  showDiff(removed, restored);
  setStatus(`${meta.reason}: reset tags to last saved.`, true);
}

async function refreshBaseTags() {
  try {
    const res = await client.request({ url: `/api/v2/tickets/${ticketId}.json`, type: 'GET' });
    const serverTags = Array.isArray(res?.ticket?.tags) ? res.ticket.tags : [];
    baseTags = new Set(serverTags);
  } catch (e) {}
}

async function onUndo() {
  setStatus('Working…');
  setDisabled(true);
  hideDiff();
  try {
    const uiTags = new Set(((await client.get('ticket.tags'))['ticket.tags']) || []);
    await refreshBaseTags();
    await client.set('ticket.comment.text', '');
    await client.set('ticket.tags', Array.from(baseTags));
    const removed = [...uiTags].filter(t => !baseTags.has(t));
    const restored = [...baseTags].filter(t => !uiTags.has(t));
    showDiff(removed, restored);
    setStatus('Macro text cleared and tags reset to last saved.', true);
  } catch (e) {
    console.error('Undo failed', e);
    setStatus('Could not undo. Check permissions or refresh.', false);
  } finally { setDisabled(false); }
}

/* ---------------- Small UI helpers ---------------- */
function setStatus(msg, ok) {
  const el = els.status; if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (ok === true ? ' success' : ok === false ? ' error' : '');
}
function setDisabled(disabled) { if (els.undoBtn) els.undoBtn.disabled = disabled; }
function showDiff(removedTags, restoredTags) {
  if (!els.diffWrap) return;
  els.removed.innerHTML = (removedTags.length ? removedTags : ['—']).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
  els.restored.innerHTML = (restoredTags.length ? restoredTags : ['—']).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
  els.diffWrap.hidden = false;
}
function hideDiff() { if (!els.diffWrap) return; els.diffWrap.hidden = true; els.removed.textContent = ''; els.restored.textContent = ''; }
function escapeHtml(s) { return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;'); }
function setsEqual(a,b){ if(a.size!==b.size) return false; for (const v of a) if(!b.has(v)) return false; return true; }

/* ---------------- Keyword logging (load + submit) ---------------- */
function matchAnyKeyword(text, keywords) {
  for (const kw of keywords) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(esc, 'i').test(text)) return kw;
  }
  return null;
}
function extractBookingId(text) { const m = text.match(BOOKING_ID_REGEX); return m ? (m[1] || m[0]) : ''; }

/** Real-time check of comment being submitted */
async function onTicketSubmitCheckAndLog() {
  try {
    const commentText = (await client.get('ticket.comment.text'))['ticket.comment.text'] || '';
    if (!commentText) return;
    const kwHit = matchAnyKeyword(commentText, KEYWORDS);
    if (!kwHit) return;

    const id = (await client.get('ticket.id'))['ticket.id'];
    const subdomain = (await client.context())?.account?.subdomain || window.location.hostname.split('.')[0];
    const link = `https://${subdomain}.zendesk.com/agent/tickets/${id}`;

    const fp = `t${id}|kw:${kwHit}|s:${commentText.slice(0,32)}`;
    if (seenFingerprint(fp)) return;
    rememberFingerprint(fp);

    const bookingId = extractBookingId(commentText);
    const row = {
      timestamp: new Date().toISOString(),
      ticket_id: id,
      ticket_link: link,
      booking_id: bookingId || '',
      matched_text: commentText.slice(0, 3000),
      matched_keyword: kwHit,
      fingerprint: fp
    };
    await postToWebhook(WEBHOOK_URL, { rows: [row] });
  } catch (e) { console.debug('Keyword log (submit) failed (non-blocking):', e); }
}

/** On load: scan existing comments */
async function scanExistingCommentsAndLog() {
  try {
    const id = (await client.get('ticket.id'))['ticket.id'];
    const subdomain = (await client.context())?.account?.subdomain || window.location.hostname.split('.')[0];
    const link = `https://${subdomain}.zendesk.com/agent/tickets/${id}`;

    let page = `/api/v2/tickets/${id}/comments.json?sort_order=desc`;
    const rows = [];
    while (page) {
      const res = await client.request({ url: page, type: 'GET' });
      const comments = Array.isArray(res?.comments) ? res.comments : [];
      for (const c of comments) {
        const text = `${c.body || ''}`; if (!text) continue;
        const kwHit = matchAnyKeyword(text, KEYWORDS); if (!kwHit) continue;

        const fp = `t${id}|kw:${kwHit}|cid:${c.id}`;
        if (seenFingerprint(fp)) continue;
        rememberFingerprint(fp);

        rows.push({
          timestamp: c.created_at || new Date().toISOString(),
          ticket_id: id,
          ticket_link: link,
          booking_id: extractBookingId(text) || '',
          matched_text: text.slice(0, 3000),
          matched_keyword: kwHit,
          fingerprint: fp
        });
      }
      page = res?.next_page ? res.next_page.replace(/^https?:\/\/[^/]+/, '') : null;
      if (rows.length > 100) break;
    }
    if (rows.length) await postToWebhook(WEBHOOK_URL, { rows });
  } catch (e) { console.debug('Keyword log (on-load) failed (non-blocking):', e); }
}

/** IMPORTANT: use ZAF request so domainWhitelist applies */
async function postToWebhook(url, payload) {
  return client.request({
    url,
    type: 'POST',
    cors: true,
    contentType: 'application/json',
    data: JSON.stringify(payload)
  }).then(res => {
    try { return typeof res === 'string' ? JSON.parse(res) : res; }
    catch { return { ok: true }; }
  });
}
