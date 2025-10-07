/* global ZAFClient */
const client = ZAFClient.init();

/* Hugging Face API Setup */
const API_KEY = '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';  // Replace with your Hugging Face API key
const TRANSLATE_URL = 'https://api-inference.huggingface.co/models/Helsinki-NLP/opus-mt-en-';  // Base URL for the translation model

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
    const translatedText = await translateText(text, language);
    els.translatedText.innerText = `Translated text: ${translatedText}`;
    setStatus('Translation successful!', true);
    
    // Optional: Automatically update the public reply text area with the translated text
    els.publicReplyText.value = translatedText;

  } catch (error) {
    setStatus('Translation failed. Please try again.', false);
    console.error(error);
  }
}

// Function to perform translation using Hugging Face API
async function translateText(text, targetLanguage) {
  const url = `${TRANSLATE_URL}${targetLanguage}`;  // Set the correct model URL

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ inputs: text })
  });

  if (!response.ok) {
    throw new Error('Translation API call failed');
  }

  const data = await response.json();
  return data[0].translation_text;  // Return the translated text from the API response
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
