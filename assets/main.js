/* global ZAFClient */
const client = ZAFClient.init();

// UI refs
const els = {
  disableToggle: null,
  undoBtn: null,
  status: null,
  diffWrap: null,
  removed: null,
  restored: null,
};

// State
let ticketId = null;
let baseTags = new Set(); // last saved tags from server (truth)
let lastComment = '';
let lastTags = new Set();
let watchersActive = false; // whether listeners are attached

// Utilities
const key = (id) => `undo-macro:disable:${id}`;
const persistDisabled = (id, val) => localStorage.setItem(key(id), val ? '1' : '0');
const readDisabled = (id) => localStorage.getItem(key(id)) === '1';

const setsEqual = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const escapeHtml = (s) => String(s)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function setStatus(msg, ok = true) {
  if (!els.status) return;
  els.status.textContent = msg || '';
  els.status.classList.toggle('ok', !!msg && ok);
  els.status.classList.toggle('err', !!msg && !ok);
}

function showDiff(removed, restored) {
  if (!els.diffWrap) return;
  els.diffWrap.hidden = false;
  els.removed.innerHTML = removed.length ? removed.map(escapeHtml).join(', ') : '—';
  els.restored.innerHTML = restored.length ? restored.map(escapeHtml).join(', ') : '—';
}

function hideDiff() {
  if (!els.diffWrap) return;
  els.diffWrap.hidden = true;
  els.removed.textContent = '';
  els.restored.textContent = '';
}

async function refreshBaseTags() {
  const data = await client.get([
    'ticket.id',
    'ticket.tags',
    'ticket.comment.text',
  ]);
  ticketId = data['ticket.id'];
  baseTags = new Set(data['ticket.tags'] || []);
  lastTags = new Set(baseTags);
  lastComment = data['ticket.comment.text'] || '';
}

function isBlankish(s) {
  return !s || !String(s).trim();
}

async function applyAutoClearIfNeeded(evtName) {
  if (readDisabled(ticketId)) return;

  const data = await client.get(['ticket.comment.text', 'ticket.tags']);
  const comment = data['ticket.comment.text'] || '';
  const tags = new Set(data['ticket.tags'] || []);

  const commentBecameBlank = isBlankish(comment) && !isBlankish(lastComment);
  const commentChanged = comment !== lastComment;

  if (commentChanged || commentBecameBlank) {
    const removed = [...lastTags].filter((t) => !baseTags.has(t));
    const restored = [...baseTags].filter((t) => !lastTags.has(t));

    await client.set({
      'ticket.comment.text': '',
      'ticket.tags': [...baseTags],
    });

    showDiff(removed, restored);
    setStatus(`Auto-cleared (${evtName}). You can type your own comment now.`, true);

    lastComment = '';
    lastTags = new Set(baseTags);
  }
}

function detachWatchers() {
  if (!watchersActive) return;
  client.off('ticket.comment.changed', onCommentChange);
  client.off('ticket.tags.changed', onTagsChange);
  watchersActive = false;
}

function attachWatchers() {
  if (watchersActive) return;
  client.on('ticket.comment.changed', onCommentChange);
  client.on('ticket.tags.changed', onTagsChange);
  watchersActive = true;
}

async function onCommentChange() {
  try { await applyAutoClearIfNeeded('comment change'); } catch (e) { console.error(e); }
}
async function onTagsChange() {
  try { await applyAutoClearIfNeeded('tags change'); } catch (e) { console.error(e); }
}

async function onUndo() {
  try {
    hideDiff();
    await client.set({ 'ticket.comment.text': lastComment, 'ticket.tags': [...lastTags] });
    setStatus('Undid last auto-clear.', true);
  } catch (e) {
    console.error('Undo failed', e);
    setStatus('Undo failed. Check console.', false);
  }
}

function applyDisableUI(disabled) {
  els.disableToggle.checked = !!disabled;
  els.undoBtn.disabled = !!disabled;
  if (disabled) {
    setStatus('Disabled for this case. No autoclear will run.');
    detachWatchers();
  } else {
    setStatus('');
    attachWatchers();
  }
}

async function onToggleChanged() {
  const disabled = !!els.disableToggle.checked;
  try {
    persistDisabled(ticketId, disabled);
    applyDisableUI(disabled);
  } catch (e) {
    console.error('Toggle error', e);
    setStatus('Could not update disable state.', false);
  }
}

// Boot
(async function init() {
  els.disableToggle = document.getElementById('disableToggle');
  els.undoBtn = document.getElementById('undoBtn');
  els.status = document.getElementById('status');
  els.diffWrap = document.getElementById('diff');
  els.removed = document.getElementById('removedTags');
  els.restored = document.getElementById('restoredTags');

  els.undoBtn.addEventListener('click', onUndo);
  els.disableToggle.addEventListener('change', onToggleChanged);

  try {
    await refreshBaseTags();
    const disabled = readDisabled(ticketId);
    applyDisableUI(disabled);
    if (!disabled) attachWatchers();
  } catch (e) {
    console.error('Init failed', e);
    setStatus('Could not initialize. Refresh the ticket.', false);
  }
})();
