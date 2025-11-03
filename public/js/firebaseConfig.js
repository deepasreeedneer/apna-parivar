// Paste your Firebase config values here (from Firebase Console -> Project settings -> Your apps -> Config)
const firebaseConfig = {
  apiKey: "AIzaSyCOvM8XpiOgAMDB-Bjxhh4n5qhBOyzr8sE",
  authDomain: "apnaparivar-e4674.firebaseapp.com",
  projectId: "apnaparivar-e4674",
  storageBucket: "apnaparivar-e4674.firebasestorage.app",
  messagingSenderId: "47011394801",
  appId: "1:47011394801:web:8fbe81a392351c64aa6550"
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
  firebase.initializeApp(firebaseConfig);
  // export globals for other scripts
  window.auth = firebase.auth();
  window.db = firebase.firestore();
} else {
  // don't initialize Firebase; show a visible banner so developer knows what to do
  window.auth = null;
  window.db = null;
  try {
    const banner = document.createElement('div');
    banner.id = 'firebase-config-warning';
    banner.style.cssText = 'background:#fff3cd;color:#664d03;padding:12px;border:1px solid #ffecb5;border-radius:6px;margin:12px auto;max-width:980px;text-align:left;font-family:inherit';
    banner.innerHTML = `
      <strong>Firebase not configured</strong> — update <code>js/firebaseConfig.js</code> with your project's config (apiKey, authDomain, etc.) from the Firebase Console.
      <div style="margin-top:6px;font-size:0.95em;color:#4b5563">See Project settings → Your apps → Firebase SDK snippet → Config.</div>
    `;
    // try to insert at top of body
    if (document && document.body) document.body.insertBefore(banner, document.body.firstChild);
  } catch (e) {
    // ignore if DOM not ready
  }
}

// Backwards-compatible consts for existing code
const auth = window.auth;
const db = window.db;
