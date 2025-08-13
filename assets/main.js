/* global ZAFClient */
const client = ZAFClient.init();

const els = {
  undoBtn: null,
  resetBtn: null,
  status: null,
  diffWrap: null,
  removed: null,
  restored: null
};

client.on('app.registered', () => {
  els.undoBtn = document.getElementById('undoBtn');
  els.resetBtn = document.getElementById('resetBtn');
  els.status = document.getElementById('status');
  els.diffWrap = document.getElementById('diff');
  els.removed = document.getElementById('removedTags');
  els.restored = document.getElementById('restoredTags');

  els.undoBtn.addEventListener('click', onUndo);
  els.resetBtn.addEventListener('click', onResetOnly);
});

async function onUndo() {
  setStatus('Working…');
  setDisabled(true);
  hideDiff();

  try {
    const ticketId = (await client.get('ticket.id'))['ticket.id'];

    // 0) Read current UI tags before we change them (to compute diff for preview)
    const uiTags = new Set(((await client.get('ticket.tags'))['ticket.tags']) || []);

    // 1) Clear comment box (removes macro text in composer)
    await client.set('ticket.comment.text', '');

    // 2) Fetch the last saved ticket from API (server truth)
    const saved = await client.request({ url: `/api/v2/tickets/${ticketId}.json`, type: 'GET' });
    const baseTags = Array.isArray(saved?.ticket?.tags) ? saved.ticket.tags : [];

    // 3) Reset current tags to saved tags
    await client.set('ticket.tags', baseTags);

    // 4) Compute and show diff (removed/restored)
    const base = new Set(baseTags);
    const removed = [...uiTags].filter(t => !base.has(t));     // these were added by unsent macro(s)
    const restored = [...base].filter(t => !uiTags.has(t));    // these were removed by unsent macro(s)

    showDiff(removed, restored);

    setStatus('Macro text cleared and tags reset to last saved.', true);
  } catch (e) {
    console.error('Undo Macro failed', e);
    setStatus('Could not undo. Check permissions or refresh the ticket.', false);
  } finally {
    setDisabled(false);
  }
}

// Optional helper: just reset tags to last saved, without clearing comment
async function onResetOnly() {
  setStatus('Resetting tags…');
  setDisabled(true);
  hideDiff();

  try {
    const ticketId = (await client.get('ticket.id'))['ticket.id'];
    const uiTags = new Set(((await client.get('ticket.tags'))['ticket.tags']) || []);

    const saved = await client.request({ url: `/api/v2/tickets/${ticketId}.json`, type: 'GET' });
    const baseTags = Array.isArray(saved?.ticket?.tags) ? saved.ticket.tags : [];

    await client.set('ticket.tags', baseTags);

    const base = new Set(baseTags);
    const removed = [...uiTags].filter(t => !base.has(t));
    const restored = [...base].filter(t => !uiTags.has(t));

    showDiff(removed, restored);
    setStatus('Tags reset to last saved.', true);
  } catch (e) {
    console.error('Reset tags failed', e);
    setStatus('Could not reset tags. Check permissions or refresh the ticket.', false);
  } finally {
    setDisabled(false);
  }
}

/* UI helpers */
function setStatus(msg, ok) {
  els.status.textContent = msg;
  els.status.className = 'status' + (ok === true ? ' success' : ok === false ? ' error' : '');
}
function setDisabled(disabled) {
  els.undoBtn.disabled = disabled;
  els.resetBtn.disabled = disabled;
}
function showDiff(removedTags, restoredTags) {
  els.removed.innerHTML = (removedTags.length ? removedTags : ['—'])
    .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
  els.restored.innerHTML = (restoredTags.length ? restoredTags : ['—'])
    .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
  els.diffWrap.hidden = false;
}
function hideDiff() {
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
