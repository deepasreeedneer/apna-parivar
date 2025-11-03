if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
  window.auth.onAuthStateChanged((user) => {
    if (!user) return window.location.href = "index.html";

    const ui = document.getElementById("user-info");
    if (ui) ui.innerHTML = `
      <p class="muted">Signed in as: <strong>${user.displayName}</strong></p>
    `;
      loadFamilies(user.uid);
      // enable Add Member button once authenticated (will only be active when a family is selected)
      const addBtn = document.getElementById('addMemberBtn');
      if (addBtn) addBtn.disabled = false;
      // Manage Admins button
      const manageBtn = document.getElementById('manageAdminsBtn');
      if (manageBtn) {
        manageBtn.addEventListener('click', () => { window.location.href = 'admin_panel.html'; });
      }
      // populate family dropdown/options
      populateFamilyOptions(user.uid);
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
  const addMember = document.getElementById('addMemberBtn');
  if (addMember) addMember.addEventListener('click', addMemberHandler);
  const manageBtn = document.getElementById('manageAdminsBtn');
  if (manageBtn) manageBtn.addEventListener('click', () => { window.location.href = 'admin_panel.html'; });
  // manage modal close/add
  const maClose = document.getElementById('ma_close');
  const maAdd = document.getElementById('ma_add');
  if (maClose) maClose.addEventListener('click', (e) => { e.preventDefault(); closeManageAdminsModal(); });
  if (maAdd) maAdd.addEventListener('click', (e) => { e.preventDefault(); inviteAdmin(); });
});

function addMemberHandler() {
  // Open the Add Member modal when a family is selected, otherwise prompt to create a family
  const familyId = localStorage.getItem('familyId');
  if (!familyId) {
    const name = prompt('No family selected. Enter a name to create a new family:');
    if (!name) return;
    const user = auth && auth.currentUser;
    if (!user) return alert('Not authenticated');
    db.collection('families').add({
      name: name.trim(),
      ownerUid: user.uid,
      admins: { [user.uid]: 'admin1' },
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(docRef => {
      localStorage.setItem('familyId', docRef.id);
      // now open modal for adding member
      openAddMemberModal();
    }).catch(err => alert(err.message || 'Failed to create family'));
    return;
  }

  // family exists — open modal
  openAddMemberModal();
}

// Modal helpers
function openAddMemberModal() {
  const modal = document.getElementById('addMemberModal');
  if (!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  populateRelationTargets();
}

function closeAddMemberModal() {
  const modal = document.getElementById('addMemberModal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

function populateRelationTargets() {
  const familyId = localStorage.getItem('familyId');
  const sel = document.getElementById('am_relationTarget');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select person (optional)</option>';
  if (!familyId) return;
  db.collection('families').doc(familyId).collection('members').get().then(snapshot => {
    snapshot.forEach(doc => {
      const m = doc.data();
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = m.name || '(no-name)';
      sel.appendChild(opt);
    });
  }).catch(err => console.error('Failed to load members for relation targets', err));
}

// Submit handler for modal
document.addEventListener('DOMContentLoaded', () => {
  const cancel = document.getElementById('am_cancel');
  const submit = document.getElementById('am_submit');
  if (cancel) cancel.addEventListener('click', (e) => { e.preventDefault(); closeAddMemberModal(); });
  if (submit) submit.addEventListener('click', (e) => { e.preventDefault(); submitAddMemberForm(); });
});

function submitAddMemberForm() {
  const familyId = localStorage.getItem('familyId');
  if (!familyId) return alert('No family selected');
  const name = (document.getElementById('am_name') || {}).value || '';
  const gender = (document.getElementById('am_gender') || {}).value || '';
  const relationType = (document.getElementById('am_relationType') || {}).value || '';
  const relationTarget = (document.getElementById('am_relationTarget') || {}).value || '';
  const age = parseInt(((document.getElementById('am_age') || {}).value || '').toString()) || null;
  const relationText = (document.getElementById('am_relationText') || {}).value || '';
  if (!name.trim()) return alert('Enter a name');

  const user = auth && auth.currentUser;
  if (!user) return alert('Not authenticated');

  const membersRef = db.collection('families').doc(familyId).collection('members');

  // helper to apply relation linking given a member doc id
  function applyRelationLink(memberId) {
    if (!relationType || !relationTarget) return Promise.resolve();
    const targetRef = membersRef.doc(relationTarget);
    if (relationType === 'parent') {
      // memberId is a parent of target -> add memberId to target.parents
      return targetRef.update({ parents: firebase.firestore.FieldValue.arrayUnion(memberId) }).catch(err => console.error(err));
    } else if (relationType === 'child') {
      // memberId is child of target -> set member's parents to include target
      return membersRef.doc(memberId).update({ parents: firebase.firestore.FieldValue.arrayUnion(relationTarget) }).catch(err => console.error(err));
    } else if (relationType === 'spouse') {
      // link both ways
      const p1 = targetRef.update({ spouseId: memberId }).catch(err => console.error(err));
      const p2 = membersRef.doc(memberId).update({ spouseId: relationTarget }).catch(err => console.error(err));
      return Promise.all([p1, p2]);
    } else if (relationType === 'sibling') {
      // copy parents from target to new member
      return targetRef.get().then(snap => {
        const t = snap.data();
        if (t && Array.isArray(t.parents) && t.parents.length) {
          return membersRef.doc(memberId).update({ parents: t.parents }).catch(err => console.error(err));
        }
      }).catch(err => console.error(err));
    }
    return Promise.resolve();
  }

  // Look for existing member with same name first (exact match)
  membersRef.where('name', '==', name.trim()).get().then(qsnap => {
    if (!qsnap.empty) {
      const existing = qsnap.docs[0];
      const doOverwrite = confirm(`A member named "${name.trim()}" already exists. Overwrite existing member?\nOK = Overwrite, Cancel = Add as new member`);
      if (doOverwrite) {
        existing.ref.update({
          name: name.trim(),
          age: age,
          gender: gender || null,
          relation: relationText || null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(()=> applyRelationLink(existing.id)).then(()=>{
          closeAddMemberModal();
          alert('Member updated');
          populateRelationTargets();
        }).catch(err=>{ console.error('Failed to update member', err); alert(err.message || 'Failed to update member'); });
      } else {
        // add as new
        membersRef.add({
          name: name.trim(),
          age: age,
          gender: gender || null,
          relation: relationText || null,
          parents: [],
          spouseId: null,
          createdBy: user.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(docRef => applyRelationLink(docRef.id)).then(()=>{
          closeAddMemberModal();
          alert('Member added');
          populateRelationTargets();
        }).catch(err => { console.error('Failed to add member', err); alert(err.message || 'Failed to add member'); });
      }
      return;
    }

    // Fallback: case-insensitive check by reading members (acceptable for small families)
    membersRef.get().then(allSnap => {
      const lower = name.trim().toLowerCase();
      const match = allSnap.docs.find(d => (d.data().name||'').toLowerCase() === lower);
      if (match) {
        const doOverwriteFallback = confirm(`A member named "${name.trim()}" (case-insensitive match) already exists. Overwrite existing member?\nOK = Overwrite, Cancel = Add as new member`);
        if (doOverwriteFallback) {
          match.ref.update({
            name: name.trim(),
            age: age,
            gender: gender || null,
            relation: relationText || null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }).then(()=> applyRelationLink(match.id)).then(()=>{
            closeAddMemberModal();
            alert('Member updated');
            populateRelationTargets();
          }).catch(err=>{ console.error('Failed to update member', err); alert(err.message || 'Failed to update member'); });
        } else {
          membersRef.add({
            name: name.trim(),
            age: age,
            gender: gender || null,
            relation: relationText || null,
            parents: [],
            spouseId: null,
            createdBy: user.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }).then(docRef => applyRelationLink(docRef.id)).then(()=>{
            closeAddMemberModal();
            alert('Member added');
            populateRelationTargets();
          }).catch(err => { console.error('Failed to add member', err); alert(err.message || 'Failed to add member'); });
        }
      } else {
        // No match — create new member
        membersRef.add({
          name: name.trim(),
          age: age,
          gender: gender || null,
          relation: relationText || null,
          parents: [],
          spouseId: null,
          createdBy: user.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(docRef => applyRelationLink(docRef.id)).then(()=>{
          closeAddMemberModal();
          alert('Member added');
          populateRelationTargets();
        }).catch(err => { console.error('Failed to add member', err); alert(err.message || 'Failed to add member'); });
      }
    }).catch(err => { console.error('Failed to search members', err); alert(err.message || 'Failed to search existing members'); });
  }).catch(err => { console.error('Failed to search for existing member', err); alert(err.message || 'Failed to search for existing member'); });
}

function createFamily() {
  const input = document.getElementById("familyName");
  const name = input.value.trim();
  if (!name) return alert("Enter family name");

  const user = auth.currentUser;
  if (!user) return alert('Not authenticated');

  db.collection("families").add({
    name: name,
    ownerUid: user.uid,
    admins: { [user.uid]: 'admin1' },
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  })
  .then((docRef) => {
    // Use returned docRef so we immediately know the family id
    input.value = '';
    const fid = docRef.id;
    localStorage.setItem('familyId', fid);
    document.getElementById('welcomeName').textContent = name || 'Welcome!';
    const manageBtn = document.getElementById('manageAdminsBtn');
    if (manageBtn) manageBtn.style.display = 'inline-block';
    // open add member modal for quick onboarding
    openAddMemberModal();
    // refresh list
    loadFamilies(user.uid);
  })
  .catch(err => alert(err.message || 'Failed to create family'));
}

function loadFamilies(uid) {
  db.collection("families").where("ownerUid", "==", uid).get().then((snapshot) => {
    const div = document.getElementById("families");
    div.innerHTML = "";
    if (snapshot.empty) {
      div.innerHTML = '<div class="muted">No families yet — create one below and then add members.</div>';
      return;
    }
    const list = document.createElement('div');
    list.className = 'families-list';
    snapshot.forEach((doc) => {
      const f = doc.data();
      const item = document.createElement('div');
      item.className = 'family-item';

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '12px';

      const nameSpan = document.createElement('div');
      nameSpan.className = 'family-name';
      nameSpan.textContent = f.name || 'Unnamed';

      left.appendChild(nameSpan);

      const actions = document.createElement('div');
      actions.className = 'family-actions';

      const openBtn = document.createElement('button');
      openBtn.textContent = 'Open';
      openBtn.className = 'btn-ghost';
      openBtn.addEventListener('click', () => { localStorage.setItem('familyId', doc.id); window.location.href = 'family.html'; });

      const selectBtn = document.createElement('button');
      selectBtn.textContent = 'Select';
      selectBtn.className = 'btn-primary';
      selectBtn.addEventListener('click', () => selectFamily(doc.id, f.name));

      actions.appendChild(openBtn);
      actions.appendChild(selectBtn);

      item.appendChild(left);
      item.appendChild(actions);
      list.appendChild(item);
    });
    div.appendChild(list);
  }).catch(err => console.error('Failed to load families', err));
}

function selectFamily(id, name) {
  localStorage.setItem('familyId', id);
  document.getElementById('welcomeName').textContent = name || 'Welcome!';
  const manageBtn = document.getElementById('manageAdminsBtn');
  if (manageBtn) manageBtn.style.display = 'inline-block';
  // enable add member
  const addBtn = document.getElementById('addMemberBtn');
  if (addBtn) addBtn.disabled = false;
}

// Populate the family dropdown with families the user owns or is an admin of
function populateFamilyOptions(uid) {
  const select = document.getElementById('familySelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Select a family --</option>';

  // helper to add option avoiding duplicates
  const added = new Set();
  function addDocOption(doc) {
    if (added.has(doc.id)) return;
    added.add(doc.id);
    const opt = document.createElement('option');
    opt.value = doc.id;
    opt.textContent = (doc.data().name || '(unnamed)') + (doc.data().ownerUid === uid ? ' (owner)' : '');
    select.appendChild(opt);
  }

  // 1) families owned by user
  db.collection('families').where('ownerUid', '==', uid).get().then(snap => {
    snap.forEach(doc => addDocOption(doc));
  }).catch(err => console.error('Failed to load owned families', err));

  // 2) families where user is in admins map (query on map key)
  const adminField = `admins.${uid}`;
  db.collection('families').where(adminField, '!=', null).get().then(snap => {
    snap.forEach(doc => addDocOption(doc));
  }).catch(err => {
    // some projects may not allow querying on map keys; fallback to loading small set of families
    console.warn('admins map query failed, skipping extra families', err);
  });

  select.addEventListener('change', () => {
    const val = select.value;
    if (!val) {
      localStorage.removeItem('familyId');
      document.getElementById('addMemberBtn').disabled = true;
      document.getElementById('manageAdminsBtn').style.display = 'none';
      return;
    }
    localStorage.setItem('familyId', val);
    // show manage admins only if owner
    db.collection('families').doc(val).get().then(snap => {
      const data = snap.data() || {};
      const welcome = data.name || 'Welcome!';
      document.getElementById('welcomeName').textContent = welcome;
      const isOwner = data.ownerUid === uid;
      const isAdmin = isOwner || (data.admins && data.admins[uid]);
      document.getElementById('addMemberBtn').disabled = !isAdmin;
      const manageBtn = document.getElementById('manageAdminsBtn');
      if (manageBtn) manageBtn.style.display = isOwner ? 'inline-block' : 'none';
    }).catch(err => console.error('Failed to load family for selection', err));
  });
}

// Manage Admins modal functions
function openManageAdminsModal() {
  const familyId = localStorage.getItem('familyId');
  if (!familyId) return alert('Select a family first');
  const modal = document.getElementById('manageAdminsModal');
  if (!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  populateAdminsList();
}

function closeManageAdminsModal() {
  const modal = document.getElementById('manageAdminsModal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden','true');
}

function populateAdminsList() {
  const familyId = localStorage.getItem('familyId');
  if (!familyId) return;
  db.collection('families').doc(familyId).get().then(snap => {
    const data = snap.data() || {};
    const admins = data.admins || {};
    const list = document.getElementById('adminsList');
    list.innerHTML = '';
    // owner
    const ownerUid = data.ownerUid;
    const ownerP = document.createElement('p');
    ownerP.textContent = 'Owner: ' + (ownerUid || '—');
    list.appendChild(ownerP);
    // other admins
    const keys = Object.keys(admins).filter(k => k !== ownerUid);
    if (!keys.length) {
      const p = document.createElement('div'); p.className='muted'; p.textContent = 'No additional admins invited yet.'; list.appendChild(p);
    } else {
      keys.forEach(k => { const p = document.createElement('p'); p.textContent = admins[k] + ' ('+k+')'; list.appendChild(p); });
    }
  }).catch(err => console.error('Failed to load admins', err));
}

function inviteAdmin() {
  const email = (document.getElementById('ma_email') || {}).value || '';
  if (!email) return alert('Enter email to invite');
  const familyId = localStorage.getItem('familyId');
  if (!familyId) return alert('Select a family first');
  // Client-side limit: max 3 additional admins
  db.collection('families').doc(familyId).get().then(snap => {
    const data = snap.data() || {};
    const admins = data.admins || {};
    const ownerUid = data.ownerUid;
    const extra = Object.keys(admins).filter(k=>k!==ownerUid).length;
    if (extra >= 3) return alert('You can add up to 3 additional admins');
    // store invite record (simple) and mark in family doc adminsEmails
    const invitesRef = db.collection('families').doc(familyId).collection('adminInvites');
    invitesRef.add({ email: email, invitedBy: (auth.currentUser && auth.currentUser.uid) || null, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() })
      .then(()=>{
        // also add placeholder in family admins map with key as email (will be converted when user accepts)
        const familiesRef = db.collection('families').doc(familyId);
        familiesRef.update({ ['admins.'+email]: 'invited' }).then(()=>{
          alert('Invitation recorded. The invited user can accept once they sign in.');
          populateAdminsList();
        }).catch(err=>{ console.error(err); alert('Failed to record invite'); });
      }).catch(err=>{ console.error(err); alert('Failed to send invite'); });
  }).catch(err => console.error(err));
}

function openFamily(id) {
  localStorage.setItem("familyId", id);
  window.location.href = "family.html";
}
