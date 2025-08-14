/* global ZAFClient */
const client = ZAFClient.init();

const els = {
  undoBtn: null,
  status: null,
  diffWrap: null,
  removed: null,
  restored: null
};

let ticketId = null;
let baseTags = new Set();      // server truth (last saved)
let lastComment = '';
let lastTags = new Set();

let watchTimer = null;
let refreshTimer = null;

// Make backspace feel instant but still light
const POLL_MS = 80;

// One-shot guard so we don't fire repeatedly while blank
let cleanedWhileBlank = false;

// Robust "blank" detector: strips zero-width chars & NBSP before trimming
function isBlankish(text) {
  if (!text) return true;
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
    .replace(/\u00A0/g, ' ')               // NBSP to space
    .trim().length === 0;
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
    await refreshBaseTags();   // ensure we have server truth before watching
    startWatchers();
  } catch (e) {
    console.error('Init failed', e);
    setStatus('Could not initialize. Refresh the ticket.', false);
  }
});

function startWatchers() {
  stopWatchers();
  watchTimer = setInterval(checkStateAndAutoCleanOnBlank, POLL_MS);
  // Keep base tags fresh (after submits / other agents)
  refreshTimer = setInterval(refreshBaseTags, 8000);
}

function stopWatchers() {
  if (watchTimer)  { clearInterval(watchTimer);  watchTimer = null; }
  if (refreshTimer){ clearInterval(refreshTimer);refreshTimer = null; }
}

async function checkStateAndAutoCleanOnBlank() {
  try {
    const comment = (await client.get('ticket.comment.text'))['ticket.comment.text'] || '';
    const tagsArr = (await client.get('ticket.tags'))['ticket.tags'] || [];
    const tags = new Set(tagsArr);

    const blank = isBlankish(comment);
    const tagsDrifted = !setsEqual(tags, baseTags); // unsent macro changed tags vs saved

    if (blank) {
      // Fire once when it *first* becomes blank and tags differ from saved
      if (!cleanedWhileBlank && tagsDrifted) {
        await autoClearAndReset({ reason: 'Auto: comment cleared' }, tags, baseTags);
        cleanedWhileBlank = true;            // don't repeat while still blank
        lastComment = '';
        lastTags = new Set(baseTags);
        return;
      }
    } else {
      // Re-arm when the agent types anything again
      cleanedWhileBlank = false;
    }

    lastComment = comment;
    lastTags = tags;
  } catch (e) {
    // Keep quiet to avoid UI noise; log for dev
    console.debug('Auto-clean check skipped', e);
  }
}

async function autoClearAndReset(meta, uiTagsSet, baseTagsSet) {
  const removed = [...uiTagsSet].filter(t => !baseTagsSet.has(t));  // unsent macro-added
  const restored = [...baseTagsSet].filter(t => !uiTagsSet.has(t)); // unsent macro-removed

  // 1) Ensure composer is empty (safe even if already blank)
  await client.set('ticket.comment.text', '');
  // 2) Reset tags to server truth
  await client.set('ticket.tags', Array.from(baseTagsSet));

  showDiff(removed, restored);
  setStatus(`${meta.reason}: reset tags to last saved.`, true);
}

async function refreshBaseTags() {
  try {
    const res = await client.request({ url: `/api/v2/tickets/${ticketId}.json`, type: 'GET' });
    const serverTags = Array.isArray(res?.ticket?.tags) ? res.ticket.tags : [];
    baseTags = new Set(serverTags);
  } catch (e) {
    console.debug('Could not refresh base tags', e);
  }
}

/* ---------- Manual Undo ---------- */
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
  } finally {
    setDisabled(false);
  }
}

/* ---------- UI helpers ---------- */
function setStatus(msg, ok) {
  if (!els.status) return;
  els.status.textContent = msg;
  els.status.className = 'status' + (ok === true ? ' success' : ok === false ? ' error' : '');
}
function setDisabled(disabled) {
  if (els.undoBtn) els.undoBtn.disabled = disabled;
}
function showDiff(removedTags, restoredTags) {
  if (!els.diffWrap) return;
  els.removed.innerHTML = (removedTags.length ? removedTags : ['—'])
    .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
  els.restored.innerHTML = (restoredTags.length ? restoredTags : ['—'])
    .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
  els.diffWrap.hidden = false;
}
function hideDiff() {
  if (!els.diffWrap) return;
  els.diffWrap.hidden = true;
  els.removed.textContent = '';
  els.restored.textContent = '';
}
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function setsEqual(a,b){ if(a.size!==b.size) return false; for (const v of a) if(!b.has(v)) return false; return true; }
