// js/treeView.js

// Import utilities from firebase.js and the D3 library

// Ensure Firebase Firestore (db) and D3 (d3) are available
if (typeof db === "undefined" || typeof d3 === "undefined") {
    console.error("Dependencies (Firestore or D3.js) not initialized. Ensure firebaseConfig.js and D3.js are loaded before treeView.js");
}

// --- CORE UTILITY FUNCTIONS ---

/**
 * Provides a simple default photo path based on gender.
 * NOTE: This assumes default images are in public/img/
 */
function getFallbackPhoto(gender) {
    const defaultPath = 'img/default-neutral.svg'; 
    if (!gender) return defaultPath;
    const g = gender.toLowerCase();
    if (g === 'male') return 'img/male.png';
    if (g === 'female') return 'img/female.jpg';
    return defaultPath; 
}

// --- JAVASCRIPT MODAL HANDLERS ---
const detailModal = document.getElementById('details-modal');
const closeBtn = document.querySelector('.modal .close-button'); // Ensure we select the modal close button
const editBtn = document.getElementById('edit-member-btn');

// Set up event listeners once DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    if (closeBtn) {
        closeBtn.onclick = function() {
            if (detailModal) detailModal.style.display = "none";
        }
    }
    
    // Close modal when clicked outside
    window.onclick = function(event) {
        if (event.target == detailModal) {
            detailModal.style.display = "none";
        }
    }
});


/**
 * Function to display full member details (10 customizable fields).
 */
function displayMemberDetails(memberData) {
    if (!detailModal) {
        console.warn("Details modal element not found. Data logged for debug.", memberData);
        alert(Name: ${memberData.name}\nRole: ${memberData.role || 'User'}\nCheck console for all data.);
        return;
    }

    // 1. Populate Basic Details
    document.getElementById('details-name').textContent = memberData.name || "Unknown Member";
    document.getElementById('detail-gender').textContent = memberData.gender || "N/A";
    document.getElementById('detail-spouse').textContent = memberData.spouseId || "None";
    
    // 2. Populate Role Tag
    const roleElement = document.getElementById('details-role');
    const role = memberData.role || 'User';
    roleElement.textContent = role;
    
    if (role.includes('Admin')) {
        roleElement.style.backgroundColor = '#E91E63'; // Admin color
    } else {
        roleElement.style.backgroundColor = '#5cb85c'; 
    }

    // 3. Populate Customizable Fields
    const customContainer = document.getElementById('custom-fields-container');
    let customHtml = '<ul>';
    let foundCustom = false;
    
            Object.keys(memberData).forEach(key => {
        if (key.startsWith('custom_')) {
            foundCustom = true;
            const label = key.replace('custom_', '').replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); 
            customHtml += <li><strong>${label}:</strong> ${memberData[key]}</li>;
        }
    });
    
    customHtml += '</ul>';

    if (foundCustom) {
        customContainer.innerHTML = customHtml;
    } else {
        customContainer.innerHTML = '<p>No custom fields entered for this member.</p>';
    }

    // 4. Set Edit Button action (Placeholder for linking to the Admin edit page)
    if (editBtn) {
        editBtn.onclick = function() {
            console.log(Redirecting to edit page for member: ${memberData.id});
            alert(Admin: Implement Edit Logic for ${memberData.name} here.);
            detailModal.style.display = "none";
        };
    }
    
    // 5. Display the Modal
    detailModal.style.display = 'block';
}


// --- INITIALIZATION AND DATA FETCHING ---

document.addEventListener("DOMContentLoaded", () => {
    const familySelect = document.getElementById("familySelect");
    const storedFamily = localStorage.getItem("familyId") || sessionStorage.getItem("familyId"); 

    if (familySelect) {
        if (storedFamily) {
            // Try to set the select value (if option exists) and load tree immediately
            try { familySelect.value = storedFamily; } catch(e) {}
            loadFamilyTree(storedFamily);
        }

        familySelect.addEventListener("change", () => {
            const familyId = familySelect.value;
            if (familyId) {
                // Persist selection in localStorage so other pages (dashboard/family) can read it
                localStorage.setItem("familyId", familyId);
                loadFamilyTree(familyId);
            } else {
                localStorage.removeItem("familyId");
                clearTree();
            }
        });
    } else if (storedFamily) {
        loadFamilyTree(storedFamily);
    }
});

async function loadFamilyTree(familyId) {
    console.log("Loading tree for family:", familyId);
    const container = d3.select("#d3-tree-container");
    const svg = d3.select("#family-tree-svg");
    svg.selectAll("*").remove(); // clear previous content

    try {
        const snapshot = await db
          .collection("families")
          .doc(familyId)
          .collection("members")
          .get();

        const members = [];
        snapshot.forEach((doc) => {
            members.push({ id: doc.id, ...doc.data() });
        });

        if (members.length === 0) {
            svg.append("text")
              .attr("x", 50)
              .attr("y", 50)
              .text("No members in this family yet. Add a root ancestor to begin.")
              .style("font-size", "16px")
              .style("fill", "#777");
            return;
        }

        const treeData = buildGenogramData(members);
        
        if (treeData) {
            renderGenogramTree(treeData, container, svg);
        } else {
            svg.append("text")
              .attr("x", 50)
              .attr("y", 50)
              .text("Error: Could not determine a clear root ancestor.")
              .style("font-size", "16px")
              .style("fill", "#777");
        }

    } catch (error) {
        console.error("Error loading tree:", error);
        svg.append("text")
            .attr("x", 50)
            .attr("y", 50)
            .text("Failed to load family data. Check console for errors.")
            .style("font-size", "16px")
            .style("fill", "red");
    }
}

function clearTree() {
    d3.select("#family-tree-svg").selectAll("*").remove();
}

// --- DATA TRANSFORMATION: Genogram/Union Node Structure ---

/**
 * Converts a flat array of members into a Genogram hierarchical structure using "Union" nodes.
 * The hierarchy: Parent -> Union Node (Marriage) -> Child.
 */
function buildGenogramData(members) {
    const memberMap = new Map();

    // 1. First pass - create nodes
    members.forEach(m => {
        memberMap.set(m.id, {
            id: m.id,
            name: m.name || '',
            gender: m.gender,
            spouseId: m.spouseId,
            parents: m.parents || [],
            children: [],
            x: 0,
            y: 0,
            level: 0,
            ...m
        });
    });

    // 2. Build relationships
    members.forEach(m => {
        const member = memberMap.get(m.id);
        
        // Find and link spouse
        if (m.spouseId) {
            const spouse = memberMap.get(m.spouseId);
            if (spouse) {
                member.spouse = spouse;
                spouse.spouse = member;
            }
        }

        // Link children to both parents
        if (m.parents && m.parents.length > 0) {
            m.parents.forEach(parentId => {
                const parent = memberMap.get(parentId);
                if (parent) {
                    if (!parent.children) parent.children = [];
                    if (!member.parentNodes) member.parentNodes = [];
                    parent.children.push(member);
                    member.parentNodes.push(parent);
                    member.level = (parent.level || 0) + 1;
                }
            });
        }
    });

    // 3. Find root - try multiple strategies
    let root = null;
    
    // First try: Find members without parents
    const noParentMembers = Array.from(memberMap.values())
        .filter(m => !m.parents || m.parents.length === 0);

    if (noParentMembers.length === 1) {
        // Single member without parents - clear root
        root = noParentMembers[0];
    } else if (noParentMembers.length > 1) {
        // Multiple potential roots - try to find main ancestor
        root = noParentMembers.find(m => {
            // Check if this member has children that are parents of others
            const hasGrandchildren = m.children?.some(child => 
                child.children && child.children.length > 0
            );
            return hasGrandchildren;
        });

        // If no clear main ancestor, use the oldest member or first one
        if (!root) {
            root = noParentMembers.sort((a, b) => {
                // Sort by age if available
                if (a.birthYear && b.birthYear) return a.birthYear - b.birthYear;
                // Or by creation date
                if (a.createdAt && b.createdAt) return a.createdAt - b.createdAt;
                return 0;
            })[0];
        }
    } else {
        // No members without parents - find the one with most descendants
        const membersByDescendants = Array.from(memberMap.values())
            .map(m => ({
                member: m,
                descendants: countDescendants(m)
            }))
            .sort((a, b) => b.descendants - a.descendants);

        root = membersByDescendants[0]?.member;
    }

    return root;
}

// Helper function to count descendants
function countDescendants(member) {
    let count = 0;
    if (member.children) {
        count += member.children.length;
        member.children.forEach(child => {
            count += countDescendants(child);
        });
    }
    return count;
}

function renderGenogramTree(data, container, svg) {
    const containerWidth = container.node().clientWidth;
    const margin = { top: 50, right: 50, bottom: 50, left: 50 };
    const nodeSize = 80;
    const levelGap = 120;

    // Clear SVG
    svg.selectAll("*").remove();

    // Create levels map
    const levels = new Map();
    function traverse(node, level = 0) {
        if (!levels.has(level)) levels.set(level, []);
        levels.get(level).push(node);
        
        // Add spouse to same level if exists
        if (node.spouse && !levels.get(level).includes(node.spouse)) {
            levels.get(level).push(node.spouse);
        }
        
        if (node.children) {
            node.children.forEach(child => traverse(child, level + 1));
        }
    }
    traverse(data);

    // Calculate positions
    levels.forEach((members, level) => {
        const y = level * levelGap + margin.top;
        const availWidth = containerWidth - margin.left - margin.right;
        const xStep = availWidth / (members.length + 1);
        
        members.forEach((member, i) => {
            member.x = (i + 1) * xStep + margin.left;
            member.y = y;
        });
    });

    // Set SVG size
    const height = (levels.size * levelGap) + margin.top + margin.bottom;
    svg.attr("width", containerWidth)
       .attr("height", height);

    // Draw connections first (so they appear behind nodes)
    const g = svg.append("g");

    // Parent-child connections
    levels.forEach((members, level) => {
        members.forEach(member => {
            // Draw connections from both parents if they exist
            if (member.parentNodes) {
                member.parentNodes.forEach(parent => {
                    // Calculate control points for curved lines
                    const midY = (parent.y + member.y) / 2;
                    
                    // Draw curved connection line
                    g.append("path")
                        .attr("d", `
                            M ${parent.x} ${parent.y + nodeSize/2}
                            C ${parent.x} ${midY},
                              ${member.x} ${midY},
                              ${member.x} ${member.y - nodeSize/2}
                        `)
                        .attr("stroke", parent.gender === 'female' ? "#ff69b4" : "#4169e1") // Pink for mother, Blue for father
                        .attr("fill", "none")
                        .attr("stroke-width", 2);
                });
            }
        });
    });

    // Spouse connections (horizontal lines)
    levels.forEach(members => {
        members.forEach(member => {
            if (member.spouse && member.x < member.spouse.x) {
                g.append("line")
                    .attr("x1", member.x + nodeSize/2)
                    .attr("y1", member.y)
                    .attr("x2", member.spouse.x - nodeSize/2)
                    .attr("y2", member.spouse.y)
                    .attr("stroke", "#666")
                    .attr("stroke-width", 3);
            }
        });
    });

    // Draw nodes
    levels.forEach((members, level) => {
        members.forEach(member => {
            const node = g.append("g")
                .attr("transform", translate(${member.x - nodeSize/2},${member.y - nodeSize/2}))
                .on("click", () => displayMemberDetails(member));

            // Node circle
            node.append("circle")
                .attr("cx", nodeSize/2)
                .attr("cy", nodeSize/2)
                .attr("r", nodeSize/2)
                .attr("fill", "white")
                .attr("stroke", "#ccc");

            // Photo
            node.append("image")
                .attr("x", 10)
                .attr("y", 10)
                .attr("width", nodeSize - 20)
                .attr("height", nodeSize - 20)
                .attr("clip-path", "circle(50%)")
                .attr("href", member.photoUrl || getFallbackPhoto(member.gender));

            // Name label
            node.append("text")
                .attr("x", nodeSize/2)
                .attr("y", nodeSize + 20)
                .attr("text-anchor", "middle")
                .style("font-size", "12px")
                .style("font-weight", "bold")
                .text(member.name || "Unknown");
        });
    });

    // Add zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.5, 2])
        .on("zoom", (event) => g.attr("transform", event.transform));
    
    svg.call(zoom);
}
// --- END OF FILE ---
