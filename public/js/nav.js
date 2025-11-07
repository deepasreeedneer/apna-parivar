document.addEventListener('DOMContentLoaded', () => {
  // If auth is available, show user info in header
  function renderUser(user) {
    const path = (window.location && window.location.pathname) ? window.location.pathname : '';
    const onIndex = path.endsWith('index.html') || path === '/' || path.endsWith('\\');
    const header = document.querySelector('.header-inner');
    if (!header) return;
    let right = document.getElementById('nav-right');
    if (!right) {
      right = document.createElement('div');
      right.id = 'nav-right';
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '10px';
      header.appendChild(right);
    }
    right.innerHTML = '';
    // If we're on the landing (index) page, don't render the logged-in user / logout in the header.
    // Keep the landing page focused on the sign-in hero button.
    if (onIndex) {
      right.innerHTML = '';
      // show sign-in in header only if there's no hero sign-in already
      const hasHeroSignin = !!document.querySelector('.hero button[onclick*="signIn"]');
      if (!user && !hasHeroSignin) {
        const signin = document.createElement('button');
        signin.className = 'btn-primary';
        signin.textContent = 'Sign in';
        signin.addEventListener('click', () => { if (window.signIn) window.signIn(); });
        right.appendChild(signin);
      }
      return;
    }

    if (user) {
      const img = document.createElement('img');
      img.src = user.photoURL || '';
      img.alt = user.displayName || 'User';
      img.style.width = '34px';
      img.style.height = '34px';
      img.style.borderRadius = '50%';
      img.style.objectFit = 'cover';
      img.onerror = () => { img.style.display = 'none'; };

      const name = document.createElement('span');
      name.textContent = user.displayName || user.email || '';
      name.style.fontSize = '14px';
      name.style.color = '#374151';

      const logout = document.createElement('button');
      logout.className = 'btn-ghost';
      logout.textContent = 'Logout';
      logout.addEventListener('click', () => {
        if (window.signOut) window.signOut();
        else if (window.auth) window.auth.signOut().then(()=>window.location.href='index.html');
      });

      right.appendChild(img);
      right.appendChild(name);
      right.appendChild(logout);
    } else {
      // Avoid adding a duplicate sign-in button if the page already shows one (e.g., landing page hero)
      const hasHeroSignin = !!document.querySelector('.hero button[onclick*="signIn"]');
      if (!hasHeroSignin) {
        const signin = document.createElement('button');
        signin.className = 'btn-primary';
        signin.textContent = 'Sign in';
        signin.addEventListener('click', () => { if (window.signIn) window.signIn(); });
        right.appendChild(signin);
      }
    }
  }

  const path = (window.location && window.location.pathname) ? window.location.pathname : '';
  const onIndex = path.endsWith('index.html') || path === '/' || path.endsWith('\\');

  function attachAuthListener() {
    if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
      window.auth.onAuthStateChanged(user => renderUser(user));
      return true;
    }
    return false;
  }

  if (attachAuthListener()) {
    // attached successfully
  } else if (onIndex) {
    // If we're on the landing page and auth isn't ready, show guest view so sign-in is available.
    renderUser(null);
  } else {
    // On non-index pages (dashboard/family) we should not show a Sign in button while auth initializes.
    // Poll briefly for the auth object to be created (e.g., by firebaseConfig.js), then attach.
    const start = Date.now();
    const timeout = 5000; // ms
    const interval = setInterval(() => {
      if (attachAuthListener()) {
        clearInterval(interval);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        // Auth didn't initialize in time; render a neutral header (no sign-in button).
        renderUser(null); // this will not add a sign-in button on non-index pages (renderUser checks onIndex)
      }
    }, 200);
  }
});
