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
let baseTags = new Set();   // "truth" from the server at init
let lastComment = '';       // last known editor contents
let lastTags = new Set();   // last known tag set (for Undo)
let watchersActive = false;

// Per-case disable (persists per ticket ID)
const key = (id) => `undo-macro:disable:${id}`;
const persistDisabled = (id, val) => localStorage.setItem(key(id), val ? '1' : '0');
const readDisabled = (id) => localStorage.getItem(key(id)) === '1';

// Utils
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

async function refreshBase() {
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

/**
 * Auto-clear only when the agent *clears the whole comment*.
 * - Trigger condition: comment transitioned from non-empty -> empty
 * - No trigger when macro applies text (usually empty -> non-empty or non-empty -> other text)
 */
async function maybeAutoClearOnFullDelete(evtName) {
  if (readDisabled(ticketId)) return;

  const data = await client.get(['ticket.comment.text', 'ticket.tags']);
  const comment = data['ticket.comment.text'] || '';
  const tags = new Set(data['ticket.tags'] || []);

  const becameEmpty = isBlankish(comment) && !isBlankish(lastComment); // full clear
  const justAppliedMacro = !isBlankish(comment) && isBlankish(lastComment); // macro filled text

  // Do NOT clear on macro apply
  if (justAppliedMacro) {
    lastComment = comment;
    lastTags = new Set(tags);
    return;
  }

  if (becameEmpty) {
    // Diff vs baseTags based on lastTags (state before full delete)
    const removed = [...lastTags].filter((t) => !baseTags.has(t));
    const restored = [...baseTags].filter((t) => !lastTags.has(t));

    // Reset tags to base; keep comment empty (agent intentionally cleared it)
    await client.set({
      'ticket.comment.text': '',
      'ticket.tags': [...baseTags],
    });

    showDiff(removed, restored);
    setStatus(`Auto-cleared after full delete (${evtName}).`, true);

    // Update memory
    lastComment = '';
    lastTags = new Set(baseTags);
    return;
  }

  // Normal typing / small edits / tag changes: just update memory
  lastComment = comment;
  lastTags = new Set(tags);
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
  try { await maybeAutoClearOnFullDelete('comment change'); } catch (e) { console.error(e); }
}
async function onTagsChange() {
  try { await maybeAutoClearOnFullDelete('tags change'); } catch (e) { console.error(e); }
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
    setStatus('Disabled for this case. No auto-clear will run.');
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
  // Bind elements
  els.disableToggle = document.getElementById('disableToggle');
  els.undoBtn = document.getElementById('undoBtn');
  els.status = document.getElementById('status');
  els.diffWrap = document.getElementById('diff');
  els.removed = document.getElementById('removedTags');
  els.restored = document.getElementById('restoredTags');

  els.undoBtn.addEventListener('click', onUndo);
  els.disableToggle.addEventListener('change', onToggleChanged);

  try {
    await refreshBase();

    // Respect per-case disable flag
    const disabled = readDisabled(ticketId);
    applyDisableUI(disabled);

    if (!disabled) attachWatchers();
  } catch (e) {
    console.error('Init failed', e);
    setStatus('Could not initialize. Refresh the ticket.', false);
  }
})();
