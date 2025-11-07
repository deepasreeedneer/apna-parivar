async function loadFamilies() {
    const familySelect = document.getElementById('familySelect');
    if (!familySelect) return;

    try {
        const snapshot = await db.collection('families').get();
        familySelect.innerHTML = '<option value="">Select Family</option>';
        
        snapshot.forEach(doc => {
            const family = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = family.name || Family ${doc.id};
            familySelect.appendChild(option);
        });

        familySelect.style.display = 'block';

        // If there's a stored family ID, select it
        const storedFamily = localStorage.getItem('familyId');
        if (storedFamily) {
            familySelect.value = storedFamily;
        }
    } catch (error) {
        console.error('Error loading families:', error);
    }
}

// Listen for auth state changes
firebase.auth().onAuthStateChanged(user => {
    if (user) {
        loadFamilies();
    }
});
