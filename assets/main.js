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

// Faster poll so Ctrl+A → Backspace feels instant
const POLL_MS = 120;

client.on('app.registered', async () => {
  els.undoBtn  = document.getElementById('undoBtn');
  els.status   = document.getElementById('status');
  els.diffWrap = document.getElementById('diff');
  els.removed  = document.getElementById('removedTags');
  els.restored = document.getElementById('restoredTags');

  if (els.undoBtn) els.undoBtn.addEventListener('click', onUndo);

  try {
    ticketId = (await client.get('ticket.id'))['ticket.id'];
    await refreshBaseTags();  // load saved tags before starting watcher
    startWatchers();
  } catch (e) {
    console.error('Init failed', e);
    setStatus('Could not initialize. Refresh the ticket.', false);
  }
});

function startWatchers() {
  stopWatchers();
  watchTimer = setInterval(checkStateAndAutoCleanOnBlank, POLL_MS);
  refreshTimer = setInterval(refreshBaseTags, 8000);
}
function stopWatchers() {
  if (watchTimer)  { clearInterval(watchTimer);  watchTimer = null; }
  if (refreshTimer){ clearInterval(refreshTimer);refreshTimer = null; }
}

// Prevent repeated firing while the composer stays blank
let cleanedWhileBlank = false;

async function checkStateAndAutoCleanOnBlank() {
  try {
    const comment = (await client.get('ticket.comment.text'))['ticket.comment.text'] || '';
    const tagsArr = (await client.get('ticket.tags'))['ticket.tags'] || [];
    const tags = new Set(tagsArr);

    const isBlank = comment.trim().length === 0;

    if (isBlank) {
      // Fire once when it first becomes blank AND tags differ from saved
      if (!cleanedWhileBlank && !setsEqual(tags, baseTags)) {
        await autoClearAndReset({ reason: 'Auto: comment blank' }, tags, baseTags);
        cleanedWhileBlank = true;            // don’t repeat while still blank
        lastComment = comment;
        lastTags = new Set(baseTags);
        return;
      }
    } else {
      // Re-arm when the agent types again
      cleanedWhileBlank = false;
    }

    lastComment = comment;
    lastTags = tags;
  } catch (e) {
    // Quiet fail to avoid UI noise
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
  setStatus(`${meta.reason}: cleared composer and reset tags to last saved.`, true);
}

async function refreshBaseTags() {
  try {
    c
