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
        alert(`Name: ${memberData.name}\nRole: ${memberData.role || 'User'}\nCheck console for all data.`);
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
            customHtml += `<li><strong>${label}:</strong> ${memberData[key]}</li>`;
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
            console.log(`Redirecting to edit page for member: ${memberData.id}`);
            alert(`Admin: Implement Edit Logic for ${memberData.name} here.`);
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
    const childrenToParents = new Map(); // childId -> [parent1Id, parent2Id]
    const spouseMap = new Map(); // personId -> spouseId

    // 1. Pre-process and map members/relationships
    members.forEach((m) => {
        // Prepare member node structure
        memberMap.set(m.id, { 
            id: m.id, 
            name: m.name, 
            gender: m.gender, 
            role: m.role, 
            photoUrl: m.photoUrl,
            children: [],
            isUnion: false, // Flag for visual distinction
            ...m // Include all other data
        });

        // Map children to parents
        const parents = Array.isArray(m.parents) ? m.parents : [];
        if (parents.length > 0) childrenToParents.set(m.id, parents);

        // Map spouses (store bidirectional mapping if present)
        if (m.spouseId) {
            try {
                spouseMap.set(m.id, m.spouseId);
                spouseMap.set(m.spouseId, m.id);
            } catch (e) {
                // ignore mapping errors
            }
        }
    });

    const unionNodes = [];
    // Track which parent/union a member has been placed under to avoid duplicate placements
    const assignedParent = new Map(); // childId -> unionId (or 'root')
    
    // 2. Create Union Nodes (Marriages) and link them to children
    function pushUnique(arr, node) {
        if (!Array.isArray(arr)) return;
        const id = node && node.id;
        if (!id) return arr.push(node);
        if (!arr.find(x => x && x.id === id)) arr.push(node);
    }

    childrenToParents.forEach((parents, childId) => {
        const unionKey = Array.isArray(parents) ? parents.slice().sort().join(':') : String(parents);
        let unionId = `union:${unionKey}`;
        let unionNode = memberMap.get(unionId);

        if (!unionNode) {
            // Create a new Union Node
            unionNode = {
                id: unionId,
                isUnion: true,
                parents: parents, // Store parent IDs on the union node
                children: [],
                name: '', // Union node is invisible/unlabeled
                role: 'System'
            };
            memberMap.set(unionId, unionNode);
            unionNodes.push(unionNode);
        }
        
        // Link the child to the Union node (avoid duplicates and avoid assigning a child to multiple unions)
        const childNode = memberMap.get(childId);
        if (childNode) {
            const already = assignedParent.get(childId);
            if (!already) {
                pushUnique(unionNode.children, childNode);
                assignedParent.set(childId, unionId);
            } else if (already !== unionId) {
                // Inconsistent data: child references multiple parent sets. Skip additional placements to
                // keep each person appearing only once in the rendered hierarchy.
                console.warn(`Child ${childId} referenced by multiple parent sets; already assigned to ${already}, skipping extra union ${unionId}.`);
            }
        }
    });

    // 3. Re-wire the hierarchy: Parent(s) -> Union Node -> Children
    const allChildrenIds = new Set(childrenToParents.keys());
    const unionIds = new Set(unionNodes.map(u => u.id));
    
    // Track nodes that are children of other nodes or union nodes.
    const allDescendantIds = new Set(allChildrenIds);
    unionIds.forEach(id => allDescendantIds.add(id)); 

    // Now, link parents to the Union Nodes they created
    unionNodes.forEach(union => {
        union.parents.forEach(pId => {
            const parentNode = memberMap.get(pId);
            if (parentNode) {
                if (!parentNode.children) parentNode.children = [];
                pushUnique(parentNode.children, union);
                allDescendantIds.add(union.id);
            }
        });
    });

    // 4. Find the ultimate root(s)
    const rootCandidates = members.filter(m => !allDescendantIds.has(m.id));

    let rootNode = null;
    if (rootCandidates.length === 1) {
        rootNode = memberMap.get(rootCandidates[0].id);
    } else if (rootCandidates.length > 1) {
        // Multiple roots: Create virtual "Super Root" for a single hierarchy
        console.warn(`Found ${rootCandidates.length} potential roots. Creating a virtual root.`);
        const virtualRoot = { 
            id: 'virtual-root', 
            name: 'Family Ancestors', 
            isUnion: false, 
            children: [], 
            role: 'System' 
        };
        rootCandidates.forEach(r => virtualRoot.children.push(memberMap.get(r.id)));
        rootNode = virtualRoot;
    } else if (members.length > 0) {
        console.warn("No root found. Using first member as fallback root.");
        rootNode = memberMap.get(members[0].id);
    }
    
    if (rootNode) rootNode.spouseMap = spouseMap; 

    // Ensure no member is left orphaned: if any member node in memberMap
    // isn't reachable from the chosen root, attach it to the root so
    // every member appears in the tree. This handles inconsistent data
    // where parents/children references may be missing or incomplete.
    if (rootNode) {
        // collect ids reachable from rootNode
        const reachable = new Set();
        function collect(node) {
            if (!node) return;
            if (node.id) reachable.add(node.id);
            if (Array.isArray(node.children)) node.children.forEach(c => collect(c));
        }
        collect(rootNode);

        // attach any non-union member nodes that are not yet reachable and not already assigned
        memberMap.forEach((node, id) => {
            if (!node) return;
            if (node.isUnion) return;
            // If node is already reachable or is already assigned under some union, skip
            if (!reachable.has(id) && !assignedParent.has(id)) {
                if (!rootNode.children) rootNode.children = [];
                pushUnique(rootNode.children, node);
                reachable.add(id);
                assignedParent.set(id, 'root');
            }
        });
        // copy spouseMap for renderer use
        rootNode.spouseMap = spouseMap;
    }

    return rootNode;
}


// --- D3 GENOGRAM RENDERING LOGIC ---

/**
 * Renders the D3 Genogram (Top-Down, Spouse-Connected) visualization.
 */
function renderGenogramTree(data, container, svg) {
    const containerWidth = container.node().clientWidth;
    const margin = { top: 50, right: 20, bottom: 50, left: 20 };

    const nodeWidth = 220;
    const nodeHeight = 160;

    const dx = nodeWidth + 40; // horizontal spacing
    const dy = nodeHeight; // vertical spacing

    const root = d3.hierarchy(data, d => d.children);

    const tree = d3.tree().nodeSize([dx, dy]);

    // separation logic preserved
    tree.separation((a, b) => {
        if (a.parent === b.parent) {
            if (a.parent && a.parent.data.isUnion) return 0.5;
            return 1;
        }
        return 2;
    });

    // initial layout
    tree(root);
    // Do not auto-collapse nodes: show full tree by default so all members are visible
    root.descendants().forEach((d, i) => {
        d.id = d.data && d.data.id ? d.data.id : i;
        d._children = d.children;
        // keep children as-is (no auto-collapse) so users see the whole family initially
    });

    // single group for all nodes/links to avoid duplicates/flicker
    svg.attr('width', containerWidth);

    // Add SVG defs once for drop-shadow
    if (svg.select('defs').empty()) {
        const defs = svg.append('defs');
        const filter = defs.append('filter').attr('id', 'drop-shadow').attr('height', '130%');
        filter.append('feGaussianBlur').attr('in', 'SourceAlpha').attr('stdDeviation', 2).attr('result', 'blur');
        filter.append('feOffset').attr('in', 'blur').attr('dx', 0).attr('dy', 2).attr('result', 'offsetBlur');
        const feMerge = filter.append('feMerge');
        feMerge.append('feMergeNode').attr('in', 'offsetBlur');
        feMerge.append('feMergeNode').attr('in', 'SourceGraphic');
    }

    // Create a zoomable wrapper group and an inner content group (used for centering)
    const zoomWrapper = svg.append('g').attr('class', 'zoom-wrap');
    const g = zoomWrapper.append('g').attr('transform', `translate(0, ${margin.top})`);

    // Attach zoom/pan behavior to the SVG which transforms the wrapper group
    const zoomBehavior = d3.zoom().scaleExtent([0.25, 3]).on('zoom', (event) => {
        zoomWrapper.attr('transform', event.transform);
    });
    svg.call(zoomBehavior);

    // link path generator
    const linkGenerator = (d) => {
        const s = d.source; const t = d.target;
        if (!s || !t || !s.data || !t.data) return 'M0,0';
        const offset = 4;
        if (t.data.isUnion) {
            return `M${s.x},${s.y + nodeHeight/2} V${t.y}`;
        } else if (s.data.isUnion) {
            return `M${s.x},${s.y} V${t.y - nodeHeight/2 + offset}`;
        }
        return `M${s.x},${s.y} L${t.x},${t.y}`;
    };

    update();

    function update(source) {
        const duration = 600;

        // Recompute layout
        tree(root);

        const nodes = root.descendants();
        const links = root.links();

        // compute extents
        let x0 = Infinity, x1 = -Infinity;
        root.each(d => { if (d.x < x0) x0 = d.x; if (d.x > x1) x1 = d.x; });

    const treeWidth = x1 - x0 + dx;
    const finalWidth = treeWidth + margin.left + margin.right;
    const finalHeight = d3.max(root.descendants(), d => d.y) + margin.top + margin.bottom + nodeHeight/2;

    // Responsive container width (re-read in case of resize)
    const containerWidth = container.node() ? container.node().clientWidth : (svg.attr('width') || 800);

    // center the tree horizontally: compute tree center and translate so it aligns to svg center
    const treeCenter = (x0 + x1) / 2;
    const translateX = (containerWidth / 2) - treeCenter;

    svg.attr('width', containerWidth).attr('height', finalHeight).attr('viewBox', [0, 0, containerWidth, finalHeight]);
    // center the content group; the outer zoomWrapper will receive any zoom/pan transforms
    g.attr('transform', `translate(${translateX}, ${margin.top})`);

        // NODES
        const node = g.selectAll('g.node').data(nodes, d => d.data && d.data.id ? d.data.id : d.id);

        const nodeEnter = node.enter().append('g')
            .attr('class', d => d.data.isUnion ? 'node union' : `node person ${d.data.role || 'user'} ${d.data.gender || 'neutral'}`)
            .attr('transform', d => `translate(${source ? source.x0 : d.x},${source ? source.y0 : d.y})`)
            .attr('opacity', 0)
            .on('click', (event, d) => { if (!d.data.isUnion) displayMemberDetails(d.data); });

        // union nodes
        nodeEnter.filter(d => d.data.isUnion).append('circle')
            .attr('r', 6).attr('fill', '#999').attr('stroke', '#fff').attr('stroke-width', 2);

        // person cards
        const personEnter = nodeEnter.filter(d => !d.data.isUnion);
        const imgSize = 56;
        const cardX = -nodeWidth / 2;
        const cardY = -nodeHeight / 2 + 30;
        const cardContentHeight = 80;
        const photoOffset = 10;

        personEnter.append('rect')
            .attr('class','node-card-bg')
            .attr('x', cardX).attr('y', cardY)
            .attr('rx', 12).attr('ry', 12)
            .attr('width', nodeWidth).attr('height', cardContentHeight)
            .attr('fill', '#fff')
            .attr('stroke', d => (d.data.role && d.data.role.includes('Admin')) ? '#E91E63' : '#ddd')
            .attr('stroke-width', d => (d.data.role && d.data.role.includes('Admin')) ? 3 : 1)
            .attr('filter', 'url(#drop-shadow)');

        personEnter.append('clipPath').attr('id', d => 'clip-' + encodeURIComponent(String(d.data.id || d.id)))
            .append('circle').attr('r', imgSize/2)
            .attr('cx', cardX + photoOffset + imgSize/2)
            .attr('cy', cardY + cardContentHeight/2);

        personEnter.append('image')
            .attr('class','node-photo')
            .attr('x', cardX + photoOffset).attr('y', cardY + cardContentHeight/2 - imgSize/2)
            .attr('width', imgSize).attr('height', imgSize)
            .attr('preserveAspectRatio', 'xMidYMid slice')
            .attr('clip-path', d => `url(#clip-${encodeURIComponent(String(d.data.id || d.id))})`)
            .attr('href', d => (d.data.photoUrl || d.data.photoData) || getFallbackPhoto(d.data.gender));

        personEnter.append('text').attr('class','node-name')
            .attr('x', cardX + imgSize + photoOffset * 2).attr('y', cardY + 30)
            .text(d => d.data.name || 'No Name')
            .style('font-size','14px').style('font-weight','700').style('fill','#222');

        personEnter.append('text').attr('class','node-sub')
            .attr('x', cardX + imgSize + photoOffset * 2).attr('y', cardY + 50)
            .text(d => { const parts = []; if (d.data.role && d.data.role.includes('Admin')) parts.push(d.data.role); if (d.data.relation) parts.push(d.data.relation); return parts.join(' | '); })
            .style('font-size','12px').style('fill','#666');

        personEnter.append('circle').attr('class','toggle-button')
            .attr('r', 10).attr('cx', cardX + nodeWidth).attr('cy', cardY + cardContentHeight / 2)
            .attr('fill', d => d._children ? '#6c757d' : '#03A9F4').attr('stroke', '#fff').attr('stroke-width', 2)
            .style('cursor', 'pointer')
            .on('click', (event, d) => { event.stopPropagation(); d.children = d.children ? null : d._children; update(d); });

        personEnter.append('text').attr('class','toggle-sign')
            .attr('x', cardX + nodeWidth).attr('y', cardY + cardContentHeight / 2 + 4)
            .attr('text-anchor', 'middle').attr('fill', '#fff').style('font-size', '16px').style('pointer-events', 'none')
            .text(d => d.children ? '−' : '+');

        // merge + transition
        const nodeUpdate = nodeEnter.merge(node);
        nodeUpdate.transition().duration(duration).attr('transform', d => `translate(${d.x},${d.y})`).attr('opacity', 1);

        nodeUpdate.select('.toggle-button').attr('fill', d => d._children ? '#6c757d' : '#03A9F4');
        nodeUpdate.select('.toggle-sign').text(d => d.children ? '−' : '+');

        node.exit().transition().duration(duration).attr('opacity', 0).remove();

        // LINKS
        const link = g.selectAll('path.link').data(links, d => d.target.data && d.target.data.id ? d.target.data.id : d.target.id);

        const linkEnter = link.enter().insert('path', 'g').attr('class','link')
            .attr('d', d => { const o = { x: (source ? source.x : d.source.x), y: (source ? source.y : d.source.y)}; return linkGenerator({ source: o, target: o }); })
            .attr('fill','none').attr('stroke','#ccc').attr('stroke-width', 1.8);

        linkEnter.merge(link).transition().duration(duration).attr('d', linkGenerator);
        link.exit().transition().duration(duration).attr('opacity',0).remove();

        // update positions for next transition
        root.eachBefore(d => { d.x0 = d.x; d.y0 = d.y; });

        // SPOUSE LINES
        const idToNode = new Map();
        root.descendants().forEach(n => { if (n.data && n.data.id) idToNode.set(n.data.id, n); });
        const spousePairs = [];
        if (data.spouseMap) {
            data.spouseMap.forEach((spouseId, personId) => {
                const a = idToNode.get(personId); const b = idToNode.get(spouseId);
                if (a && b) spousePairs.push({ a, b, key: (a.data.id + ':' + b.data.id) });
            });
        }

        const lineOffset = cardY + cardContentHeight / 2;
        // Draw spouse connectors even when spouses are on different rows
        const spouseGroup = g.selectAll('line.spouse').data(spousePairs, d => d.key);
        const spouseEnter = spouseGroup.enter().append('line').attr('class','spouse')
            .attr('stroke','#888').attr('stroke-width',3).attr('stroke-linecap','round').lower();

        spouseEnter.merge(spouseGroup).transition().duration(duration)
            .attr('x1', d => d.a.x + (d.a.x < d.b.x ? nodeWidth/2 : -nodeWidth/2))
            .attr('y1', d => d.a.y + lineOffset)
            .attr('x2', d => d.b.x + (d.b.x < d.a.x ? nodeWidth/2 : -nodeWidth/2))
            .attr('y2', d => d.b.y + lineOffset);

        spouseGroup.exit().remove();
    }
}
// --- END OF FILE ---