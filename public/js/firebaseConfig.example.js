// Copy this file to `public/js/firebaseConfig.js` and fill in the values from
// Firebase Console -> Project settings -> Your apps -> Config
// IMPORTANT: Do NOT commit the real `firebaseConfig.js` to source control. Add it to
// .gitignore (already configured in this repo).

const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Basic validation for placeholder values
function isValidConfig(cfg) {
  if (!cfg || typeof cfg.apiKey !== 'string') return false;
  if (cfg.apiKey.includes('YOUR_') || cfg.apiKey.trim().length < 20) return false;
  if (!cfg.authDomain || cfg.authDomain.indexOf('.') === -1) return false;
  return true;
}

window.__FIREBASE_CONFIG_VALID = isValidConfig(firebaseConfig);

if (window.__FIREBASE_CONFIG_VALID) {
  const app = firebase.initializeApp(firebaseConfig);
  window.auth = firebase.auth();
  window.db = firebase.firestore();
  if (firebase.storage) window.storage = firebase.storage(); else window.storage = null;
} else {
  window.auth = null; window.db = null; window.storage = null;
  console.warn('Firebase example config present. Copy firebaseConfig.example.js to firebaseConfig.js and fill values.');
}

// Export backward-compatible names
const auth = window.auth;
const db = window.db;
const storage = window.storage;
