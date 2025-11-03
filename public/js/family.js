const familyId = localStorage.getItem("familyId");
if (!familyId) window.location.href = "dashboard.html";

function addMember() {
  const name = document.getElementById("memberName").value.trim();
  const relation = document.getElementById("relation").value.trim();
  if (!name || !relation) return alert("Enter both fields");

  const user = auth.currentUser;
  if (!user) return alert('Not authenticated');

  db.collection("families").doc(familyId)
    .collection("members").add({
      name: name,
      relation: relation,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
      document.getElementById("memberName").value = '';
      document.getElementById("relation").value = '';
      loadMembers();
    })
    .catch(err => alert(err.message || 'Failed to add member'));
}

function loadMembers() {
  db.collection("families").doc(familyId)
    .collection("members").get()
    .then((snapshot) => {
      const div = document.getElementById("memberList");
      div.innerHTML = "";
      snapshot.forEach((doc) => {
        const m = doc.data();
        const p = document.createElement('p');
        p.textContent = `${m.name} - ${m.relation}`;
        div.appendChild(p);
      });
    }).catch(err => console.error('Failed to load members', err));
}

function goBack() {
  window.location.href = "dashboard.html";
}

// Ensure user is authenticated before loading members
if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
  window.auth.onAuthStateChanged((user) => {
    if (!user) return window.location.href = 'index.html';
    loadMembers();
  });
} else {
  const div = document.getElementById('memberList');
  if (div) div.innerHTML = '<div class="muted">Firebase not configured. Please add config in <code>js/firebaseConfig.js</code>.</div>';
}
