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
const IS_ADMIN_ALL = sessionStorage.getItem('isAdmin') === 'true' || localStorage.getItem('isAdmin') === 'true' || false;
const IS_ADMIN1 = sessionStorage.getItem('isAdmin1') === 'true' || localStorage.getItem('isAdmin1') === 'true' || false;

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
    const users = await fetchFamilyUsers();
    
    // --- Render Admin Slots ---
    const adminSlots = [
        { role: 'is_admin1', label: 'Admin 1 (Primary)' },
        { role: 'is_admin2', label: 'Admin 2' },
        { role: 'is_admin3', label: 'Admin 3' }
    ];
    
    const adminContainer = document.getElementById('admin-slots-container');
    if (!adminContainer) return;
    adminContainer.innerHTML = adminSlots.map(slot => {
        const currentAdmin = users.find(u => u[slot.role] === true);
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
        // Users are stored keyed by uid in many flows; lookup by gmail_id instead
        const q = await db.collection(COLLECTIONS.USERS).where('gmail_id', '==', email).limit(1).get();
        if (q.empty) return alert("Error: User must sign in once to create a profile entry.");
        const userDocRef = q.docs[0].ref;
        await userDocRef.update({ family_id: FAMILY_ID, can_view: true });

        alert(`User ${email} approved and assigned!`);
        document.getElementById('newViewerEmail').value = '';
        renderUserManagement();
    } catch (error) {
        console.error("Approval failed:", error);
        alert("Error during approval. Check console. (Need write access on user doc)");
    }
};

window.revokeAccess = async (email) => {
    if (!IS_ADMIN_ALL) return alert("Permission denied.");
    if (!confirm(`Are you sure you want to REVOKE all access for ${email}?`)) return;

    try {
        const q = await db.collection(COLLECTIONS.USERS).where('gmail_id', '==', email).limit(1).get();
        if (q.empty) return alert('User not found in users collection');
        const userRef = q.docs[0].ref;
        await userRef.update({
            family_id: null, // Unassign from family
            can_view: false,
            is_admin1: false, is_admin2: false, is_admin3: false
        });
        alert(`Access for ${email} revoked.`);
        renderUserManagement();
    } catch (error) {
        console.error("Revoke failed:", error);
        alert("Error during revocation. Check console.");
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
        // Find the new admin doc by gmail_id
        const qNew = await db.collection(COLLECTIONS.USERS).where('gmail_id', '==', newEmail).limit(1).get();
        if (qNew.empty) return alert('New admin user not found. They must sign in first.');
        const newAdminDoc = qNew.docs[0];
        if (newAdminDoc.data().family_id !== FAMILY_ID) return alert("Error: New Admin must be an approved member of this family.");

        // 2. Clear role from the previous holder (if provided)
        if (oldEmail) {
            const qOld = await db.collection(COLLECTIONS.USERS).where('gmail_id', '==', oldEmail).limit(1).get();
            if (!qOld.empty) batch.update(qOld.docs[0].ref, { [targetField]: false });
        }

        // 3. Assign the role to the new user
        batch.update(newAdminDoc.ref, { [targetField]: true, can_view: true });

        await batch.commit();

        alert(`${targetField} successfully transferred to ${newEmail}.`);
        renderUserManagement();
    } catch (error) {
        console.error("Transfer failed:", error);
        alert("Error during transfer. Check console.");
    }
};


// --- INITIALIZATION ---
const initAdminPanel = () => {
    // Ensure we have a family id and auth ready
    if (!FAMILY_ID) {
        console.warn('No FAMILY_ID found. Redirecting to dashboard.');
        return window.location.href = 'dashboard.html';
    }

    const start = () => {
        if (!document.getElementById('admin-slots-container')) return;
        renderUserManagement();
        loadCustomFieldsUI();
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