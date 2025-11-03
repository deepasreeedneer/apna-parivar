const familyId = localStorage.getItem("familyId");
if (!familyId) window.location.href = "dashboard.html";

let editingMemberId = null;

function addMemberLocal() {
  const name = document.getElementById("memberName").value.trim();
  const age = parseInt((document.getElementById("memberAge").value || '').toString()) || null;
  const gender = (document.getElementById("memberGender").value || '').trim();
  const relation = document.getElementById("relation").value.trim();
  if (!name) return alert("Enter name");

  const user = auth && auth.currentUser;
  if (!user) return alert('Not authenticated');

  // Check admin permission on client (server rules should enforce formally)
  db.collection('families').doc(familyId).get().then(snap => {
    const fam = snap.data() || {};
    const isAdmin = fam.ownerUid === user.uid || (fam.admins && fam.admins[user.uid]);
    if (!isAdmin) return alert('You are not allowed to add members to this family');
    const membersRef = db.collection("families").doc(familyId).collection("members");

    // Try to find an existing member with same name. Prefer exact match first.
    membersRef.where('name', '==', name).get().then(querySnap => {
      if (!querySnap.empty) {
        // Found an exact match. Ask user whether to overwrite or create a new entry.
        const doc = querySnap.docs[0];
        const doOverwrite = confirm(`A member named "${name}" already exists. Overwrite existing member?\nOK = Overwrite, Cancel = Add as new member`);
        if (doOverwrite) {
          // Overwrite the first matching member document with the new data
          doc.ref.update({
            name: name,
            age: age,
            gender: gender || null,
            relation: relation || null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }).then(() => {
            // clear inputs and reload
            document.getElementById("memberName").value = '';
            document.getElementById("memberAge").value = '';
            document.getElementById("memberGender").value = '';
            document.getElementById("relation").value = '';
            loadMembers();
          }).catch(err => alert(err.message || 'Failed to update existing member'));
        } else {
          // User chose not to overwrite; create a new member instead
          membersRef.add({
            name: name,
            age: age,
            gender: gender || null,
            relation: relation || null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }).then(() => {
            document.getElementById("memberName").value = '';
            document.getElementById("memberAge").value = '';
            document.getElementById("memberGender").value = '';
            document.getElementById("relation").value = '';
            loadMembers();
          }).catch(err => alert(err.message || 'Failed to add member'));
        }
      } else {
        // Fallback: perform a client-side case-insensitive search (small families)
        membersRef.get().then(allSnap => {
          const lower = name.toLowerCase();
          const match = allSnap.docs.find(d => (d.data().name||'').toLowerCase() === lower);
          if (match) {
            const doOverwriteFallback = confirm(`A member named "${name}" (case-insensitive match) already exists. Overwrite existing member?\nOK = Overwrite, Cancel = Add as new member`);
            if (doOverwriteFallback) {
              match.ref.update({
                name: name,
                age: age,
                gender: gender || null,
                relation: relation || null,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              }).then(()=>{
                document.getElementById("memberName").value = '';
                document.getElementById("memberAge").value = '';
                document.getElementById("memberGender").value = '';
                document.getElementById("relation").value = '';
                loadMembers();
              }).catch(err=>alert(err.message || 'Failed to update existing member'));
            } else {
              // User chose not to overwrite; create a new member instead
              membersRef.add({
                name: name,
                age: age,
                gender: gender || null,
                relation: relation || null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
              }).then(() => {
                document.getElementById("memberName").value = '';
                document.getElementById("memberAge").value = '';
                document.getElementById("memberGender").value = '';
                document.getElementById("relation").value = '';
                loadMembers();
              }).catch(err => alert(err.message || 'Failed to add member'));
            }
          } else {
            // No match — create a new member
            membersRef.add({
              name: name,
              age: age,
              gender: gender || null,
              relation: relation || null,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
              document.getElementById("memberName").value = '';
              document.getElementById("memberAge").value = '';
              document.getElementById("memberGender").value = '';
              document.getElementById("relation").value = '';
              loadMembers();
            }).catch(err => alert(err.message || 'Failed to add member'));
          }
        }).catch(err => alert(err.message || 'Failed to search existing members'));
      }
    }).catch(err => alert(err.message || 'Failed to search for existing member'));
  }).catch(err => { console.error(err); alert('Failed to verify permissions'); });
}

function loadMembers() {
  db.collection("families").doc(familyId)
    .collection("members").get()
    .then((snapshot) => {
      const div = document.getElementById("memberList");
      div.innerHTML = "";
      snapshot.forEach((doc) => {
        const m = doc.data();
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '8px 0';

        const left = document.createElement('div');
        left.innerHTML = `<strong>${escapeHtml(m.name || '')}</strong> ${m.age ? '- ' + m.age + ' yrs' : ''} ${m.gender ? '- ' + m.gender : ''} ${m.relation ? '- ' + escapeHtml(m.relation) : ''}`;

        const actions = document.createElement('div');
        // show edit/delete only if current user is admin/owner
        db.collection('families').doc(familyId).get().then(fsnap => {
          const fam = fsnap.data() || {};
          const user = auth && auth.currentUser;
          const isAdmin = user && (fam.ownerUid === user.uid || (fam.admins && fam.admins[user.uid]));
          if (isAdmin) {
            const editBtn = document.createElement('button');
            editBtn.className = 'btn-ghost';
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => openEditMember(doc.id, m));
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-ghost';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', () => deleteMember(doc.id));
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
          }
        }).catch(err => console.error('Failed to check admin for member row', err));

        row.appendChild(left);
        row.appendChild(actions);
        div.appendChild(row);
      });
    }).catch(err => console.error('Failed to load members', err));
}

function goBack() {
  window.location.href = "dashboard.html";
}

function openEditMember(id, data) {
  editingMemberId = id;
  const modal = document.getElementById('editMemberModal');
  if (!modal) return;
  document.getElementById('em_name').value = data.name || '';
  document.getElementById('em_age').value = data.age || '';
  document.getElementById('em_gender').value = data.gender || '';
  document.getElementById('em_relation').value = data.relation || '';
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
}

function closeEditMemberModal() {
  const modal = document.getElementById('editMemberModal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden','true');
  editingMemberId = null;
}

function saveEditedMember() {
  if (!editingMemberId) return;
  const name = (document.getElementById('em_name')||{}).value.trim();
  const age = parseInt((document.getElementById('em_age')||{}).value || '') || null;
  const gender = (document.getElementById('em_gender')||{}).value || null;
  const relation = (document.getElementById('em_relation')||{}).value || null;
  if (!name) return alert('Enter name');
  const user = auth && auth.currentUser;
  if (!user) return alert('Not authenticated');
  // verify admin
  db.collection('families').doc(familyId).get().then(fsnap => {
    const fam = fsnap.data() || {};
    const isAdmin = fam.ownerUid === user.uid || (fam.admins && fam.admins[user.uid]);
    if (!isAdmin) return alert('You are not allowed to edit members');
    db.collection('families').doc(familyId).collection('members').doc(editingMemberId).update({
      name: name,
      age: age,
      gender: gender,
      relation: relation,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(()=>{
      closeEditMemberModal();
      loadMembers();
    }).catch(err=>{ console.error(err); alert('Failed to save member'); });
  }).catch(err=>{ console.error(err); alert('Failed to verify permissions'); });
}

function deleteMember(id) {
  if (!confirm('Delete this member?')) return;
  const user = auth && auth.currentUser;
  if (!user) return alert('Not authenticated');
  db.collection('families').doc(familyId).get().then(fsnap => {
    const fam = fsnap.data() || {};
    const isAdmin = fam.ownerUid === user.uid || (fam.admins && fam.admins[user.uid]);
    if (!isAdmin) return alert('You are not allowed to delete members');
    db.collection('families').doc(familyId).collection('members').doc(id).delete().then(()=>{
      loadMembers();
    }).catch(err=>{ console.error(err); alert('Failed to delete member'); });
  }).catch(err=>{ console.error(err); alert('Failed to verify permissions'); });
}

// small helper to escape text for innerHTML
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]; }); }

// Wire up buttons
document.addEventListener('DOMContentLoaded', ()=>{
  const addBtn = document.getElementById('addMemberBtnLocal');
  if (addBtn) addBtn.addEventListener('click', addMemberLocal);
  const cancelEdit = document.getElementById('cancelEdit');
  if (cancelEdit) cancelEdit.addEventListener('click', ()=>{ document.getElementById('memberName').value=''; document.getElementById('memberAge').value=''; document.getElementById('memberGender').value=''; document.getElementById('relation').value=''; editingMemberId=null; });
  const emCancel = document.getElementById('em_cancel');
  const emSave = document.getElementById('em_save');
  if (emCancel) emCancel.addEventListener('click', (e)=>{ e.preventDefault(); closeEditMemberModal(); });
  if (emSave) emSave.addEventListener('click', (e)=>{ e.preventDefault(); saveEditedMember(); });
});

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
