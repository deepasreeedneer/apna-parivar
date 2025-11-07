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
      const manageBtn = document.getElementById('manageAdminsBtn');
      const isViewer = sessionStorage.getItem('isViewer') === 'true';
      if (addBtn) addBtn.disabled = !!isViewer;
      // Manage Admins button: hide for viewers
      if (manageBtn) {
        if (isViewer) {
          manageBtn.style.display = 'none';
        } else {
          manageBtn.style.display = 'inline-block';
          manageBtn.addEventListener('click', () => { window.location.href = 'admin_panel.html'; });
        }
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
  if (manageBtn) {
    // hide manage button if viewer
    if (sessionStorage.getItem('isViewer') === 'true') {
      manageBtn.style.display = 'none';
    } else {
      manageBtn.addEventListener('click', () => { window.location.href = 'admin_panel.html'; });
    }
  }
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
      admins: { [user.uid]: 'owner' },
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(docRef => {
      localStorage.setItem('familyId', docRef.id);
      // remember that this user owns the family by updating their user profile
      try {
        if (db && db.collection) {
          db.collection('users').doc(user.uid).set({ family_id: docRef.id, role: 'owner' }, { merge: true }).catch(()=>{});
        }
      } catch(e){}
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
  // clear staged relations when closing
  am_relations = [];
  try { renderRelationsList(); } catch(e){}
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

// --- Image handling for Add Member modal ---
let am_photo_data = null; // stores base64/dataURL for submission
document.addEventListener('DOMContentLoaded', () => {
  const photoInput = document.getElementById('am_photo');
  const preview = document.getElementById('am_photo_preview');
  const msg = document.getElementById('am_photo_msg');
  if (!photoInput) return;
  photoInput.addEventListener('change', (e) => {
    const file = (e.target.files && e.target.files[0]) || null;
    if (!file) {
      am_photo_data = null;
      if (preview) { preview.style.display = 'none'; preview.src = ''; }
      if (msg) msg.textContent = '';
      return;
    }
    // Basic client-side size guard (avoid huge base64 blobs in Firestore)
    const maxBytes = 700 * 1024; // ~700 KB
    if (file.size > maxBytes) {
      am_photo_data = null;
      if (msg) msg.textContent = 'Image too large (>700KB). Please choose a smaller image or crop it.';
      if (preview) { preview.style.display = 'none'; preview.src = ''; }
      return;
    }
    const reader = new FileReader();
    reader.onload = function(ev) {
      am_photo_data = ev.target.result; // dataURL string
      if (preview) { preview.src = am_photo_data; preview.style.display = 'block'; }
      if (msg) msg.textContent = '';
    };
    reader.onerror = function() {
      am_photo_data = null;
      if (msg) msg.textContent = 'Failed to read image file.';
      if (preview) { preview.style.display = 'none'; preview.src = ''; }
    };
    reader.readAsDataURL(file);
  });
});

// In-memory list of relations added in the Add Member modal
let am_relations = [];

// Bind add-relation button once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('am_add_relation');
  if (addBtn) addBtn.addEventListener('click', (e) => { e.preventDefault(); addRelationFromForm(); });
});

function addRelationFromForm() {
  const type = (document.getElementById('am_relationType') || {}).value || '';
  const target = (document.getElementById('am_relationTarget') || {}).value || '';
  if (!type) return alert('Select a relation type');
  // allow 'none' as a valid explicit relation but don't require target
  if (type !== 'none' && !target) return alert('Select a person to relate to');
  // push to local list
  am_relations.push({ type, target });
  renderRelationsList();
}

function renderRelationsList() {
  const container = document.getElementById('am_relations_list');
  if (!container) return;
  container.innerHTML = '';
  if (!am_relations.length) {
    container.innerHTML = '<div class="muted">No relations added</div>';
    return;
  }
  am_relations.forEach((r, idx) => {
    const el = document.createElement('div');
    el.className = 'relation-pill';
    const typeText = r.type || 'relation';
    const targetText = r.target ? (document.querySelector('#am_relationTarget option[value="'+r.target+'"]') || {}).textContent || r.target : '(none)';
    el.textContent = `${typeText} → ${targetText}`;
    const rem = document.createElement('button');
    rem.textContent = 'x';
    rem.className = 'btn-ghost small';
    rem.style.marginLeft = '8px';
    rem.addEventListener('click', () => { am_relations.splice(idx,1); renderRelationsList(); });
    el.appendChild(rem);
    container.appendChild(el);
  });
}

function submitAddMemberForm() {
  const familyId = localStorage.getItem('familyId');
  if (!familyId) return alert('No family selected');
  const name = (document.getElementById('am_name') || {}).value || '';
  const gender = (document.getElementById('am_gender') || {}).value || '';
  // relations are collected via the add-relation button into am_relations
  const age = parseInt(((document.getElementById('am_age') || {}).value || '').toString()) || null;
  const relationText = (document.getElementById('am_relationText') || {}).value || '';
  if (!name.trim()) return alert('Enter a name');

  const user = auth && auth.currentUser;
  if (!user) return alert('Not authenticated');

  const membersRef = db.collection('families').doc(familyId).collection('members');
  // Create member doc
  const payload = {
    name: name.trim(),
    age: age,
    gender: gender || null,
    relation: relationText || null,
    parents: [],
    spouseId: null,
    createdBy: user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  // Attach base64 image data if available (client-side only). Keep null if absent.
  if (am_photo_data) payload.photoData = am_photo_data;

  membersRef.add(payload).then(docRef => {
    const newId = docRef.id;
    // Apply relation linking for all staged relations (am_relations)
    if (Array.isArray(am_relations) && am_relations.length) {
      am_relations.forEach(rel => {
        const relationType = rel.type;
        const relationTarget = rel.target;
        if (!relationType) return;
        if (relationType === 'none') return; // explicit no-relation
        if (!relationTarget) return;
        const targetRef = membersRef.doc(relationTarget);
        if (relationType === 'parent') {
          // new member is a parent of target -> add newId to target.parents
          targetRef.update({ parents: firebase.firestore.FieldValue.arrayUnion(newId) }).catch(err => console.error(err));
        } else if (relationType === 'child') {
          // new member is child of target -> add target as parent of new member
          membersRef.doc(newId).update({ parents: firebase.firestore.FieldValue.arrayUnion(relationTarget) }).catch(err => console.error(err));
        } else if (relationType === 'spouse') {
          // link both ways
          targetRef.update({ spouseId: newId }).catch(err => console.error(err));
          membersRef.doc(newId).update({ spouseId: relationTarget }).catch(err => console.error(err));
        } else if (relationType === 'sibling') {
          // copy parents from target to new member
          targetRef.get().then(snap => {
            const t = snap.data();
            if (t && Array.isArray(t.parents) && t.parents.length) {
              membersRef.doc(newId).update({ parents: t.parents }).catch(err => console.error(err));
            }
          }).catch(err => console.error(err));
        }
      });
    }

  closeAddMemberModal();
  alert('Member added');
  // clear staged relations
  am_relations = [];
  try { renderRelationsList(); } catch(e){}
  // refresh relation targets so user can add more
  populateRelationTargets();
  // clear photo input & preview
  am_photo_data = null;
  try { const p = document.getElementById('am_photo'); if (p) p.value = ''; const prev = document.getElementById('am_photo_preview'); if (prev) { prev.src=''; prev.style.display='none'; } } catch(e){}
  }).catch(err => {
    console.error('Failed to add member', err);
    alert(err.message || 'Failed to add member');
  });
}

function createFamily() {
  const input = document.getElementById("familyName");
  const name = input.value.trim();
  if (!name) return alert("Enter family name");

  const user = auth.currentUser;
  if (!user) return alert('Not authenticated');
  // Debug: ensure auth and db are ready
  try { console.log('createFamily: user=', user && { uid: user.uid, email: user.email }, 'db=', !!db); } catch(e){ }

  // Ensure the client has a fresh ID token attached to requests (helps when token expired)
  // Then perform the write. This avoids silent permission-denied when the SDK hasn't picked up auth state.
  (user.getIdToken ? user.getIdToken(true) : Promise.resolve())
    .then(() => {
      return db.collection("families").add({
        name: name,
        ownerUid: user.uid,
        admins: { [user.uid]: 'owner' },
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then((docRef) => {
    // Use returned docRef so we immediately know the family id
    input.value = '';
    const fid = docRef.id;
    // persist that this user owns/administrates this family on their user profile
    try {
      if (db && db.collection) {
        db.collection('users').doc(user.uid).set({ family_id: fid, role: 'owner' }, { merge: true }).catch(()=>{});
      }
    } catch(e){}
    localStorage.setItem('familyId', fid);
    document.getElementById('welcomeName').textContent = name || 'Welcome!';
    const manageBtn = document.getElementById('manageAdminsBtn');
    if (manageBtn) manageBtn.style.display = 'inline-block';
    // open add member modal for quick onboarding
    openAddMemberModal();
    // refresh list
    loadFamilies(user.uid);
  })
  .catch(err => {
    // Surface richer error details for debugging
    try { console.error('createFamily failed', err); } catch(e){}
    const code = err && err.code ? err.code : 'unknown';
    const msg = err && err.message ? err.message : 'Failed to create family';
    alert(`${msg} (${code})`);
    // helpful hint for common causes
    if (code === 'permission-denied' || msg.toLowerCase().includes('permission')) {
      console.warn('Permission error when creating family — possible causes: not signed in, Firestore rules deny create, or rules evaluation depends on other document reads.');
    }
  });
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
  const adminField = 'admins.' + uid;
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