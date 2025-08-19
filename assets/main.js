/* global ZAFClient, moment */
const client = ZAFClient.init();

const els = {
  undoBtn: null,
  status: null,
  timeLeft: null,
  timeStatus: null
};

let ticketId = null;
let baseTags = new Set();  // Server truth (last saved)
let lastComment = '';
let lastTags = new Set();

client.on('app.registered', async () => {
  els.undoBtn = document.getElementById('undoBtn');
  els.status = document.getElementById('status');
  els.timeLeft = document.getElementById('timeLeft');
  els.timeStatus = document.getElementById('timeStatus');

  if (els.undoBtn) els.undoBtn.addEventListener('click', onUndo);

  try {
    ticketId = (await client.get('ticket.id'))['ticket.id'];
    await refreshBaseTags();  // Ensure we have server truth before starting
    startWatchers();
  } catch (e) {
    console.error('Init failed', e);
    setStatus('Could not initialize. Refresh the ticket.', false);
  }

  // Calculate the time left for the experience
  calculateTimeLeft();
});

// Function to get and compare the experience time
async function calculateTimeLeft() {
  try {
    const ticket = await client.get('ticket');
    
    const city = ticket.ticket.custom_fields['360021522151'];  // City
    const startTime = ticket.ticket.custom_fields['360021522271'];  // Start Time
    const tourDate = ticket.ticket.custom_fields['360024232231'];  // Tour Date

    if (!city || !startTime || !tourDate) {
      els.timeLeft.textContent = "Experience data not available.";
      return;
    }

    // Combine date and start time into a single datetime string
    const experienceTimeStr = `${tourDate} ${startTime}`;
    
    // Parse the experience time to the local city time zone
    const experienceTime = moment.tz(experienceTimeStr, city);

    // Convert to IST
    const currentTimeIST = moment.tz('Asia/Kolkata');
    const diffMinutes = experienceTime.diff(currentTimeIST, 'minutes');
    
    // Update UI with the time left
    if (diffMinutes < 0) {
      els.timeLeft.textContent = "The experience time has already passed.";
      els.timeStatus.textContent = `Experience was at ${experienceTime.format('YYYY-MM-DD HH:mm')}`;
    } else if (diffMinutes <= 10) {
      els.timeLeft.textContent = `${diffMinutes} minutes left to fulfill`;
      els.timeStatus.textContent = `Experience is almost here!`;
    } else {
      els.timeLeft.textContent = `${diffMinutes} minutes remaining`;
      els.timeStatus.textContent = `Fulfillment time is getting closer.`;
    }
  } catch (error) {
    console.error("Error calculating experience time:", error);
  }
}

// Undo functionality for clearing comment and resetting tags
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

// Refresh base tags from the server
async function refreshBaseTags() {
  try {
    const res = await client.request({ url: `/api/v2/tickets/${ticketId}.json`, type: 'GET' });
    const serverTags = Array.isArray(res?.ticket?.tags) ? res.ticket.tags : [];
    baseTags = new Set(serverTags);
  } catch (e) {
    console.debug('Could not refresh base tags', e);
  }
}

// Helper functions for UI updates
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
