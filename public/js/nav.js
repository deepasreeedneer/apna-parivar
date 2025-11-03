document.addEventListener('DOMContentLoaded', () => {
  // If auth is available, show user info in header
  function renderUser(user) {
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
      // show sign in button on index if firebase is configured
      const signin = document.createElement('button');
      signin.className = 'btn-primary';
      signin.textContent = 'Sign in';
      signin.addEventListener('click', () => { if (window.signIn) window.signIn(); });
      right.appendChild(signin);
    }
  }

  if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
    window.auth.onAuthStateChanged(user => renderUser(user));
  } else {
    // if no auth, render guest (so index shows Sign in button)
    renderUser(null);
  }
});
