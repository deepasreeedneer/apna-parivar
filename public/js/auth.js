function signIn() {
  if (!window.__FIREBASE_CONFIG_VALID || !window.auth) {
    alert('Firebase is not configured correctly. Please update js/firebaseConfig.js with your project values.');
    return;
  }

  const provider = new firebase.auth.GoogleAuthProvider();
  window.auth.signInWithPopup(provider)
    .then((result) => {
      const user = result.user;
      if (window.db) {
        window.db.collection('users').doc(user.uid).set({
          name: user.displayName,
          email: user.email,
          photoURL: user.photoURL,
        }, { merge: true });
      }
      window.location.href = "dashboard.html";
    })
    .catch((error) => alert(error.message || 'Sign-in failed'));
}

function signOut() {
  if (!window.auth) {
    window.location.href = 'index.html';
    return;
  }
  window.auth.signOut().then(() => {
    window.location.href = "index.html";
  }).catch(() => { window.location.href = 'index.html'; });
}

// Redirect already signed-in users from landing page to dashboard (only when auth is available)
if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
  window.auth.onAuthStateChanged((user) => {
    try{
      const path = window.location.pathname || '';
      const onIndex = path.endsWith('index.html') || path === '/' || path.endsWith('\\');
      if (user && onIndex) window.location.href = 'dashboard.html';
    }catch(e){/* ignore in non-browser env */}
  });
}
