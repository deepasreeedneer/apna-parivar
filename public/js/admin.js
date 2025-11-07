// js/admin.js (Admin Panel Functionality)
// Uses global `db` and `auth` created by firebaseConfig.js
const COLLECTIONS = {
    USERS: 'users',
    CUSTOM_FIELDS: 'customFields'
};
// `db` and `auth` are provided as globals by `firebaseConfig.js` and must not be redeclared here.
// Use `window.db` and `window.auth` (or the globals `db`/`auth`) directly.

// Prefer sessionStorage (when navigating from dashboard), fall back to localStorage
const FAMILY_ID = sessionStorage.getItem('currentFamilyId') || localStorage.getItem('familyId') || null;
// These will be refreshed at init time based on Firestore values for the current user
let IS_ADMIN_ALL = false;
let IS_ADMIN1 = false;

// ==========================================================
// 1. CUSTOM FIELDS MANAGEMENT
// ==========================================================

const loadCustomFieldsUI = async () => {
    // This is run by the admin panel to populate the form for editing field names
    if (!FAMILY_ID) return;
    const doc = await db.collection(COLLECTIONS.CUSTOM_FIELDS).doc(FAMILY_ID).get();
    const fieldNames = doc.exists ? doc.data().fields : [];
    const container = document.getElementById('custom-fields-form');
    if (!container) return;
    container.innerHTML = '';

    // Generate 10 input fields
    for (let i = 1; i <= 10; i++) {
        const fieldName = fieldNames[i - 1] || `Field ${i} Name (Unused)`;
        container.innerHTML += `
            <div>
                <label>Field ${i}:</label>
                <input type="text" id="admin-field-${i}" value="${fieldName}" placeholder="e.g., Favorite Dish">
            </div>
        `;
    }
};

window.saveCustomFieldsToDB = async () => {
    if (!IS_ADMIN_ALL) return alert("Permission denied. You must be an Admin.");

    const newFieldNames = [];
    for (let i = 1; i <= 10; i++) {
        const el = document.getElementById(`admin-field-${i}`);
        newFieldNames.push(el ? el.value : '');
    }

    try {
        // This requires the Firestore rule: allow write: if isAdmin()
        await db.collection(COLLECTIONS.CUSTOM_FIELDS).doc(FAMILY_ID).set({ fields: newFieldNames });
        alert('Custom fields saved successfully!');
    } catch (error) {
        console.error('Failed to save custom fields:', error);
        alert('Error: Failed to save custom fields. Check console.');
    }
};

// ==========================================================
// 2. USER/ROLE MANAGEMENT
// ==========================================================

const fetchFamilyUsers = async () => {
    if (!FAMILY_ID) return [];
    const snapshot = await db.collection(COLLECTIONS.USERS)
        .where('family_id', '==', FAMILY_ID)
        .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }));
};

const renderUserManagement = async () => {
    // ensure admin flags are current
    try { await refreshAdminFlags(); } catch(e){}
    const users = await fetchFamilyUsers();
    
    // --- Render Admin Slots ---
    const adminSlots = [
        { role: 'is_admin1', label: 'Admin 1 (Primary)' },
        { role: 'is_admin2', label: 'Admin 2' },
        { role: 'is_admin3', label: 'Admin 3' }
    ];
    
    const adminContainer = document.getElementById('admin-slots-container');
    if (!adminContainer) return;
    // prefer family doc mapping when available so UI reflects authoritative admin assignments
    const familySnap = await db.collection('families').doc(FAMILY_ID).get();
    const familyData = familySnap.exists ? familySnap.data() : {};
    adminContainer.innerHTML = adminSlots.map(slot => {
        // try users doc role flag first
        let currentAdmin = users.find(u => u[slot.role] === true);
        // fallback: if family has admins map keyed by uid, try to resolve to the user with matching uid
        if (!currentAdmin && familyData && familyData.admins) {
            const adminUid = Object.keys(familyData.admins || {}).find(uid => {
                // owner is represented separately (ownerUid). Skip owner for admin2/admin3
                return slot.role === 'is_admin1' ? (familyData.ownerUid === uid) : true;
            });
            if (adminUid) currentAdmin = users.find(u => u.id === adminUid) || null;
        }
        // special-case Admin 1 (owner)
        if (slot.role === 'is_admin1' && familyData && familyData.ownerUid) {
            currentAdmin = users.find(u => u.id === familyData.ownerUid) || currentAdmin;
        }

        const canTransfer = IS_ADMIN1 && (slot.role !== 'is_admin1'); // Only Admin 1 can assign 2/3

        return `
            <div class="role-slot">
                <span>${slot.label}</span>
                ${currentAdmin ? `
                    <span style="font-weight: 600; color: var(--color-accent);">${currentAdmin.gmail_id}</span>
                    <button class="btn-primary" style="background: #e74c3c; ${!canTransfer ? 'opacity: 0.5; pointer-events: none;' : ''}" onclick="promptTransfer('${slot.role}', '${currentAdmin.gmail_id}')">Transfer</button>
                ` : `
                    <button class="btn-primary" style="${!canTransfer ? 'opacity: 0.5; pointer-events: none;' : ''}" onclick="promptTransfer('${slot.role}', null)">Assign</button>
                `}
            </div>
        `;
    }).join('');

    // --- Render Viewer List ---
    const viewerContainer = document.getElementById('viewer-list-container');
    viewerContainer.innerHTML = users.sort((a, b) => a.gmail_id.localeCompare(b.gmail_id)).map(user => {
        const isSelf = user.gmail_id === auth.currentUser.email;
        const role = user.is_admin1 ? 'Admin 1' : user.can_view ? 'Viewer' : 'Pending';
        const roleColor = user.is_admin1 ? 'var(--color-primary)' : user.can_view ? 'var(--color-accent)' : '#f39c12';
        
        return `
            <div class="role-slot">
                <span>${user.gmail_id}</span>
                <span class="role-badge" style="background-color: ${roleColor}">${role}</span>
                ${!isSelf && IS_ADMIN_ALL && (user.can_view || user.is_admin2 || user.is_admin3)
                    ? `<button class="btn-primary" style="background: #e74c3c; margin-left: 10px;"
                               onclick="revokeAccess('${user.gmail_id}')">Revoke</button>`
                    : ''}
            </div>
        `;
    }).join('');
};

// ==========================================================
// 3. WINDOW EXPOSED FUNCTIONS
// ==========================================================

window.approveNewViewer = async () => {
    if (!IS_ADMIN_ALL) return alert("Permission denied.");
    const email = document.getElementById('newViewerEmail').value.trim();
    if (!email) return alert("Please enter a valid Gmail ID.");
    
    try {
        // refresh ID token to avoid stale-token permission-denied errors
        if (auth && auth.currentUser && typeof auth.currentUser.getIdToken === 'function') {
            try {
                await auth.currentUser.getIdToken(true);
                console.log('approveNewViewer: refreshed ID token for', auth.currentUser.uid);
            } catch (tErr) {
                console.warn('approveNewViewer: failed to refresh token', tErr);
            }
        }

        console.log('approveNewViewer: looking up user by gmail_id=', email);
        // Users are stored keyed by uid in many flows; lookup by gmail_id instead
        const q = await db.collection(COLLECTIONS.USERS).where('gmail_id', '==', email).limit(1).get();
        if (q.empty) {
            // No user doc exists yet. Create a family-scoped viewer record instead so admins
            // can approve viewers without needing write access to `users/*` documents.
            const vid = encodeURIComponent(email);
            await db.collection('families').doc(FAMILY_ID).collection('viewers').doc(vid).set({
                email: email,
                approvedBy: auth && auth.currentUser ? auth.currentUser.uid : null,
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert(`No account found for ${email}. Stored approval on the family; they will be allowed to join once they sign in.`);
            document.getElementById('newViewerEmail').value = '';
            renderUserManagement();
            return;
        }

        const userDocRef = q.docs[0].ref;
        console.log('approveNewViewer: updating user doc', userDocRef.id, 'with family_id=', FAMILY_ID);
        try {
            await userDocRef.update({ family_id: FAMILY_ID, can_view: true });
            // Also record the approval on the family viewers subcollection for consistency
            const vid2 = encodeURIComponent(email);
            await db.collection('families').doc(FAMILY_ID).collection('viewers').doc(vid2).set({
                email: email,
                approvedBy: auth && auth.currentUser ? auth.currentUser.uid : null,
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert(`User ${email} approved and assigned!`);
            document.getElementById('newViewerEmail').value = '';
            renderUserManagement();
        } catch (err) {
            console.error('approveNewViewer: failed to update user doc', err);
            // If rules prevent updating other user docs, fall back to creating a family viewer record
            if (err && err.code === 'permission-denied') {
                try {
                    const vid = encodeURIComponent(email);
                    await db.collection('families').doc(FAMILY_ID).collection('viewers').doc(vid).set({
                        email: email,
                        approvedBy: auth && auth.currentUser ? auth.currentUser.uid : null,
                        approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    alert(`Could not update user doc due to rules. Stored approval on the family for ${email}; they will be allowed to join when they sign in.`);
                    document.getElementById('newViewerEmail').value = '';
                    renderUserManagement();
                } catch (addErr) {
                    console.error('approveNewViewer: failed to create family viewer fallback', addErr);
                    alert('Error: Failed to approve viewer and failed to create family-level viewer. Check console.');
                }
            } else {
                throw err;
            }
        }
    } catch (error) {
        console.error("Approval failed:", error);
        alert(`Error during approval. Check console. (${error && error.code ? error.code : 'unknown'})`);
    }
};

window.revokeAccess = async (email) => {
    if (!IS_ADMIN_ALL) return alert("Permission denied.");
    if (!confirm(`Are you sure you want to REVOKE all access for ${email}?`)) return;

    try {
        // refresh token
        if (auth && auth.currentUser && typeof auth.currentUser.getIdToken === 'function') {
            try { await auth.currentUser.getIdToken(true); console.log('revokeAccess: refreshed token'); } catch(e){ console.warn('revokeAccess: token refresh failed', e); }
        }

        const q = await db.collection(COLLECTIONS.USERS).where('gmail_id', '==', email).limit(1).get();
        if (q.empty) return alert('User not found in users collection');
        const userRef = q.docs[0].ref;
        console.log('revokeAccess: updating user', userRef.id);
        await userRef.update({
            family_id: null, // Unassign from family
            can_view: false,
            is_admin1: false, is_admin2: false, is_admin3: false
        });
        alert(`Access for ${email} revoked.`);
        renderUserManagement();
    } catch (error) {
        console.error("Revoke failed:", error);
        alert(`Error during revocation. Check console. (${error && error.code ? error.code : 'unknown'})`);
    }
};

window.promptTransfer = (targetField, currentAdminId) => {
    if (!IS_ADMIN1) return alert("Only Admin 1 can assign/transfer Admin roles.");
    
    const newEmail = prompt(`Enter the Gmail ID of the user to assign as ${targetField}:`);
    if (newEmail) {
        transferAdminRole(targetField, newEmail, currentAdminId);
    }
};

const transferAdminRole = async (targetField, newEmail, oldEmail) => {
    // Requires transaction or batch write for consistency
    const batch = db.batch();
    try {
        // refresh token before making role changes
        if (auth && auth.currentUser && typeof auth.currentUser.getIdToken === 'function') {
            try { await auth.currentUser.getIdToken(true); console.log('transferAdminRole: refreshed token'); } catch(e){ console.warn('transferAdminRole: token refresh failed', e); }
        }
        // Find the new admin doc by gmail_id
        const qNew = await db.collection(COLLECTIONS.USERS).where('gmail_id', '==', newEmail).limit(1).get();
        if (qNew.empty) return alert('New admin user not found. They must sign in first.');
        const newAdminDoc = qNew.docs[0];
        if (newAdminDoc.data().family_id !== FAMILY_ID) return alert("Error: New Admin must be an approved member of this family.");

        // 2. Clear role from the previous holder (if provided) and remove from family admins map
        const familyRef = db.collection('families').doc(FAMILY_ID);
        const familySnap = await familyRef.get();
        const familyData = familySnap.exists ? familySnap.data() : {};

        let oldUid = null;
        if (oldEmail) {
            const qOld = await db.collection(COLLECTIONS.USERS).where('gmail_id', '==', oldEmail).limit(1).get();
            if (!qOld.empty) {
                oldUid = qOld.docs[0].id;
                batch.update(qOld.docs[0].ref, { [targetField]: false });
                // remove from family admins map if present
                batch.update(familyRef, { ['admins.' + oldUid]: firebase.firestore.FieldValue.delete() });
            }
        }

        // 3. Assign the role to the new user and add to family admins map
        const newUid = newAdminDoc.id;
        const userUpdate = { [targetField]: true, can_view: true };
        batch.update(newAdminDoc.ref, userUpdate);
        // set family admins map key
        batch.update(familyRef, { ['admins.' + newUid]: 'admin' });

        await batch.commit();

        alert(`${targetField} successfully transferred to ${newEmail}.`);
        renderUserManagement();
    } catch (error) {
        console.error("Transfer failed:", error);
        alert("Error during transfer. Check console.");
    }
};

// Refresh admin flags by inspecting the family doc and current user's profile.
async function refreshAdminFlags() {
    if (!FAMILY_ID || !window.auth || !auth.currentUser) return;
    try {
        // Read family doc to see admins map and ownerUid
        const fSnap = await db.collection('families').doc(FAMILY_ID).get();
        const f = fSnap.exists ? fSnap.data() : {};
        const uid = auth.currentUser.uid;
        // is admin all if user is owner or appears in admins map
        IS_ADMIN_ALL = (f && f.ownerUid === uid) || (f && f.admins && f.admins[uid]);
        // determine admin1 (owner) specifically by checking users collection flag or ownership
        const uSnap = await db.collection('users').doc(uid).get();
        const u = uSnap.exists ? uSnap.data() : {};
        IS_ADMIN1 = !!(u && (u.is_admin1 || f && f.ownerUid === uid));
        // store in sessionStorage for quick access by other pages
        sessionStorage.setItem('isAdmin', IS_ADMIN_ALL ? 'true' : 'false');
        sessionStorage.setItem('isAdmin1', IS_ADMIN1 ? 'true' : 'false');
    } catch (err) {
        console.error('Failed to refresh admin flags', err);
    }
}


// --- INITIALIZATION ---
const initAdminPanel = () => {
    // Ensure we have a family id and auth ready
    if (!FAMILY_ID) {
        console.warn('No FAMILY_ID found. Redirecting to dashboard.');
        return window.location.href = 'dashboard.html';
    }

    const start = () => {
        if (!document.getElementById('admin-slots-container')) return;
        // ensure current user is actually an admin for this family before rendering
        refreshAdminFlags().then(() => {
            if (!IS_ADMIN_ALL) {
                alert('Access denied: you are not an admin for this family.');
                return window.location.href = 'dashboard.html';
            }
            renderUserManagement();
            loadCustomFieldsUI();
        }).catch(err => {
            console.error('Failed to verify admin flags', err);
            // proceed cautiously
            renderUserManagement();
            loadCustomFieldsUI();
        });
    };

    if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
        // Wait until a user is signed-in before rendering admin UI
        window.auth.onAuthStateChanged(user => {
            if (!user) return window.location.href = 'index.html';
            start();
        });
    } else {
        // auth not ready — try again shortly
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
                clearInterval(iv);
                window.auth.onAuthStateChanged(user => {
                    if (!user) return window.location.href = 'index.html';
                    start();
                });
            } else if (Date.now() - t0 > 5000) {
                clearInterval(iv);
                console.warn('Auth did not initialize in time for admin panel.');
            }
        }, 200);
    }
};

document.addEventListener('DOMContentLoaded', initAdminPanel);