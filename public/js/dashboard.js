if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
  window.auth.onAuthStateChanged((user) => {
    if (!user) return window.location.href = "index.html";

    const ui = document.getElementById("user-info");
    if (ui) ui.innerHTML = `
      <p class="muted">Signed in as: <strong>${user.displayName}</strong></p>
    `;
    loadFamilies(user.uid);
  });
} else {
  // firebase not configured — show warning in UI and disable create
  const ui = document.getElementById("user-info");
  if (ui) ui.innerHTML = '<div class="muted">Firebase not configured. Please add config in <code>js/firebaseConfig.js</code>.</div>';
  const btn = document.getElementById('createFamilyBtn');
  if (btn) btn.disabled = true;
}

// Attach handler to the create button (avoids inline JS in markup)
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('createFamilyBtn');
  if (btn) btn.addEventListener('click', createFamily);
});

function createFamily() {
  const input = document.getElementById("familyName");
  const name = input.value.trim();
  if (!name) return alert("Enter family name");

  const user = auth.currentUser;
  if (!user) return alert('Not authenticated');

  db.collection("families").add({
    name: name,
    owner: user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  })
  .then(() => {
    input.value = '';
    loadFamilies(user.uid);
  })
  .catch(err => alert(err.message || 'Failed to create family'));
}

function loadFamilies(uid) {
  db.collection("families").where("owner", "==", uid).get().then((snapshot) => {
    const div = document.getElementById("families");
    div.innerHTML = "";
    const list = document.createElement('div');
    list.className = 'families-list';
    snapshot.forEach((doc) => {
      const f = doc.data();
      const p = document.createElement('p');
      const span = document.createElement('span');
      span.textContent = f.name || 'Unnamed';
      const btn = document.createElement('button');
      btn.textContent = 'Open';
      btn.className = 'btn-ghost';
      btn.addEventListener('click', () => openFamily(doc.id));
      p.appendChild(span);
      p.appendChild(btn);
      list.appendChild(p);
    });
    div.appendChild(list);
  }).catch(err => console.error('Failed to load families', err));
}

function openFamily(id) {
  localStorage.setItem("familyId", id);
  window.location.href = "family.html";
}
