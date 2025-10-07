/* global ZAFClient */
const client = ZAFClient.init();

/* Google Apps Script URL */
const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyPkX98H5wn_FiBqn3BKvac6luyRSSpwHKsy-EnFvKrIklEX3Fg_AE0QqadhguhOVqQ/exec';  // Replace with your Google Apps Script URL

// Language mapping for the translation API
const LANGUAGES = {
  'es': 'es', // Spanish
  'de': 'de', // German
  'it': 'it', // Italian
  'nl': 'nl', // Dutch
  'pt': 'pt', // Portuguese
};

// Initialize elements
const els = { 
  undoBtn: null, 
  status: null, 
  translateBtn: null,
  languageSelect: null,
  publicReplyText: null,
  translatedText: null
};

// Setup listeners and event handling
client.on('app.registered', async () => {
  els.undoBtn = document.getElementById('undoBtn');
  els.status = document.getElementById('status');
  els.languageSelect = document.getElementById('languageSelect');
  els.publicReplyText = document.getElementById('publicReplyText');
  els.translatedText = document.getElementById('translatedText');
  
  // Event listener for language selection change
  if (els.languageSelect) {
    els.languageSelect.addEventListener('change', onLanguageChange);
  }

  // Event listener for undo button click
  if (els.undoBtn) {
    els.undoBtn.addEventListener('click', onUndo);
  }
});

// Function to handle language change and translation
async function onLanguageChange() {
  const text = els.publicReplyText.value.trim();  // Get text from the public reply box
  const language = els.languageSelect.value;  // Get the selected language

  if (!text) {
    setStatus('Please enter text to translate.', false);
    return;
  }

  setStatus('Translating...', true);
  try {
    const translatedText = await translateTextWithAppsScript(text, language);
    els.translatedText.innerText = `Translated text: ${translatedText}`;
    setStatus('Translation successful!', true);
    
    // Optional: Automatically update the public reply text area with the translated text
    els.publicReplyText.value = translatedText;

  } catch (error) {
    setStatus('Translation failed. Please try again.', false);
    console.error(error);
  }
}

// Function to send translation request to Google Apps Script
async function translateTextWithAppsScript(text, targetLanguage) {
  const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: text,
      language: targetLanguage
    })
  });

  if (!response.ok) {
    throw new Error('Google Apps Script API call failed');
  }

  const data = await response.json();
  return data.translatedText;  // Return the translated text from the response
}

// Helper to update the status
function setStatus(msg, success) {
  els.status.textContent = msg;
  els.status.className = `status${success ? ' success' : ' error'}`;
}

// Undo functionality
function onUndo() {
  setStatus('Undoing…', true);
  setDisabled(true);
  try {
    // Add your undo logic here if needed
    setStatus('Undo successful.', true);
  } catch (e) {
    setStatus('Undo failed.', false);
  } finally {
    setDisabled(false);
  }
}

// Helper to disable/enable buttons
function setDisabled(disabled) {
  if (els.undoBtn) els.undoBtn.disabled = disabled;
  if (els.translateBtn) els.translateBtn.disabled = disabled;
}
