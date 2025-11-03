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
      try { sessionStorage.setItem('pendingSignIn', '1'); } catch(e){}
      window.location.href = "dashboard.html";
    })
    .catch((error) => alert(error.message || 'Sign-in failed'));
}

function signOut() {
  if (!window.auth) {
    window.location.href = 'index.html';
    return;
  }
  // clear app-local data on sign out so next visitor starts fresh
  try { localStorage.removeItem('familyId'); sessionStorage.removeItem('familyId'); } catch(e){}
  window.auth.signOut().then(() => {
    // also clear any remaining app keys
    try { localStorage.removeItem('familyId'); } catch(e){}
    window.location.href = "index.html";
  }).catch(() => { window.location.href = 'index.html'; });
}

// Redirect already signed-in users from landing page to dashboard (only when auth is available)
if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
  window.auth.onAuthStateChanged((user) => {
    // when user is present, ensure users/{uid} exists and accept any pending admin invites for their email
    if (user && window.db) {
      try {
        const uref = window.db.collection('users').doc(user.uid);
        uref.set({ name: user.displayName, email: user.email, photoURL: user.photoURL, lastSeen: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(()=>{});

        // find admin invites where email == user.email and status == 'pending'
        window.db.collectionGroup('adminInvites').where('email', '==', user.email).where('status', '==', 'pending').get().then(invSnap => {
          invSnap.forEach(invDoc => {
            const inv = invDoc.data();
            const familyRef = invDoc.ref.parent.parent; // parent collection is adminInvites, parent is family doc
            if (!familyRef) return;
            // perform a transaction: mark invite accepted and add uid to admins map, remove email-keyed admin placeholder if present
            window.db.runTransaction(tx => {
              return tx.get(familyRef).then(famSnap => {
                const fam = famSnap.data() || {};
                const admins = fam.admins || {};
                // add uid with role 'admin'
                const updates = {};
                updates['admins.' + user.uid] = 'admin';
                // remove placeholder keyed by email if exists
                if (admins && admins[user.email]) {
                  updates['admins.' + user.email] = firebase.firestore.FieldValue.delete();
                }
                tx.update(familyRef, updates);
                tx.update(invDoc.ref, { status: 'accepted', acceptedBy: user.uid, acceptedAt: firebase.firestore.FieldValue.serverTimestamp() });
              });
            }).catch(err => { console.warn('Invite acceptance failed', err); });
          });
        }).catch(err => {/* ignore */});
      } catch (e) {}
    }
    // hide splash overlay once auth state is known with a smooth fade
    try {
      const sp = document.getElementById('splash');
      const path = window.location.pathname || '';
      const onIndex = path.endsWith('index.html') || path === '/' || path.endsWith('\\');
      if (sp) {
        // If user is signed in and we're on index, keep the splash visible and redirect after fade
        if (user && onIndex) {
          sp.classList.add('splash-fade');
          const onEndRedirect = () => {
            try { sessionStorage.removeItem('pendingSignIn'); } catch(e){}
            try { window.location.href = 'dashboard.html'; } catch(e){}
          };
          sp.addEventListener('transitionend', onEndRedirect);
          setTimeout(onEndRedirect, 400);
          return; // don't reveal index page before redirect
        }

        // otherwise, fade the splash and reveal the page
        sp.classList.add('splash-fade');
        const onEnd = () => {
          try { sp.parentNode && sp.parentNode.removeChild(sp); } catch(e){}
          try { document.body.classList.remove('splash-hidden'); } catch(e){}
          sp.removeEventListener('transitionend', onEnd);
        };
        sp.addEventListener('transitionend', onEnd);
        // fallback in case transitionend doesn't fire
        setTimeout(onEnd, 450);
      } else {
        try { document.body.classList.remove('splash-hidden'); } catch(e){}
      }
    } catch(e){}
    // note: redirection for signed-in users on index handled above during splash fade
  });
}
