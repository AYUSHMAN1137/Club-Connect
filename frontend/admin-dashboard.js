const API_URL = window.API_URL || 'http://localhost:4000';
const token = localStorage.getItem('token');

async function ensureAdmin() {
    if (!token) {
        window.location.href = 'index.html';
        return;
    }
    try {
        const res = await fetch(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.success || data.user.role !== 'admin') {
            localStorage.removeItem('token');
            window.location.href = 'index.html';
            return;
        }
    } catch {
        localStorage.removeItem('token');
        window.location.href = 'index.html';
    }
}

function notify(msg, type = 'info') {
    const c = document.getElementById('notificationContainer');
    const el = document.createElement('div');
    el.className = 'notification';
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

async function fetchOwners() {
    const res = await fetch(`${API_URL}/admin/owners`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
        const list = document.getElementById('ownersList');
        const select = document.getElementById('clubOwnerSelect');
        const addOwnerSelect = document.getElementById('addOwnerSelect');
        const selectedOwner = select?.value || '';
        const selectedAddOwner = addOwnerSelect?.value || '';
        list.innerHTML = '';
        select.innerHTML = '<option value="">Select Owner</option>';
        if (addOwnerSelect) {
            addOwnerSelect.innerHTML = '<option value="">Select Owner</option>';
        }
        data.owners.forEach(o => {
            const item = document.createElement('div');
            item.className = 'item';
            item.innerHTML = `<span>${o.username} (${o.email})</span><span>id: ${o.id}</span>`;
            list.appendChild(item);
            const opt = document.createElement('option');
            opt.value = o.id;
            opt.textContent = `${o.username} (#${o.id})`;
            select.appendChild(opt);
            if (addOwnerSelect) {
                const addOpt = document.createElement('option');
                addOpt.value = o.id;
                addOpt.textContent = `${o.username} (#${o.id})`;
                addOwnerSelect.appendChild(addOpt);
            }
        });
        if (selectedOwner) {
            select.value = selectedOwner;
        }
        if (addOwnerSelect && selectedAddOwner) {
            addOwnerSelect.value = selectedAddOwner;
        }
    }
}

async function fetchClubs() {
    const res = await fetch(`${API_URL}/admin/clubs`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
        const list = document.getElementById('clubsList');
        const select = document.getElementById('memberClubSelect');
        const addOwnerClubSelect = document.getElementById('addOwnerClubSelect');
        const selectedClub = select?.value || '';
        const selectedAddOwnerClub = addOwnerClubSelect?.value || '';
        list.innerHTML = '';
        select.innerHTML = '<option value="">Select Club</option>';
        if (addOwnerClubSelect) {
            addOwnerClubSelect.innerHTML = '<option value="">Select Club</option>';
        }
        data.clubs.forEach(c => {
            const item = document.createElement('div');
            item.className = 'item';
            const ownerNames = (c.owners && c.owners.length > 0)
                ? c.owners.map(o => o.username).join(', ')
                : (c.owner?.username || 'none');
            item.innerHTML = `<span>${c.name}</span><span>Owners: ${ownerNames}</span>`;
            list.appendChild(item);
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.name} (#${c.id})`;
            select.appendChild(opt);
            if (addOwnerClubSelect) {
                const addOpt = document.createElement('option');
                addOpt.value = c.id;
                addOpt.textContent = `${c.name} (#${c.id})`;
                addOwnerClubSelect.appendChild(addOpt);
            }
        });
        if (selectedClub) {
            select.value = selectedClub;
        }
        if (addOwnerClubSelect && selectedAddOwnerClub) {
            addOwnerClubSelect.value = selectedAddOwnerClub;
        }
    }
}

async function createOwner() {
    const username = document.getElementById('ownerUsername').value.trim();
    const studentId = document.getElementById('ownerStudentId').value.trim();
    const email = document.getElementById('ownerEmail').value.trim();
    const password = document.getElementById('ownerPassword').value;
    if (!username || !studentId || !email || !password) {
        notify('Fill in all owner fields', 'error');
        return;
    }
    const res = await fetch(`${API_URL}/admin/create-owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username, studentId, email, password })
    });
    const data = await res.json();
    if (data.success) {
        notify('Owner created');
        await fetchOwners();
    } else {
        notify(data.message || 'Owner create failed', 'error');
    }
}

async function createClub() {
    const name = document.getElementById('clubName').value.trim();
    const tagline = document.getElementById('clubTagline').value.trim();
    const themeColor = document.getElementById('clubTheme').value.trim();
    const ownerId = document.getElementById('clubOwnerSelect').value;
    if (!name || !ownerId) {
        notify('Select a club name and owner', 'error');
        return;
    }
    const res = await fetch(`${API_URL}/admin/create-club`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, tagline, themeColor, ownerId: parseInt(ownerId, 10) })
    });
    const data = await res.json();
    if (data.success) {
        notify('Club created');
        await fetchClubs();
    } else {
        notify(data.message || 'Club create failed', 'error');
    }
}

async function addOwnerToClub() {
    const ownerId = document.getElementById('addOwnerSelect').value;
    const clubId = document.getElementById('addOwnerClubSelect').value;
    if (!ownerId || !clubId) {
        notify('Select an owner and club', 'error');
        return;
    }
    const res = await fetch(`${API_URL}/admin/add-owner-to-club`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ownerId: parseInt(ownerId, 10), clubId: parseInt(clubId, 10) })
    });
    const data = await res.json();
    if (data.success) {
        notify('Owner added to club');
        await fetchClubs();
    } else {
        notify(data.message || 'Add owner failed', 'error');
    }
}

async function addMemberToClub() {
    const studentId = document.getElementById('memberStudentId').value.trim();
    const clubId = document.getElementById('memberClubSelect').value;
    if (!studentId || !clubId) {
        notify('Select student ID and club', 'error');
        return;
    }
    const res = await fetch(`${API_URL}/admin/add-member-to-club`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ studentId, clubId: parseInt(clubId, 10) })
    });
    const data = await res.json();
    if (data.success) {
        notify('Member added to club');
    } else {
        notify(data.message || 'Add member failed', 'error');
    }
}

async function createMember() {
    const username = document.getElementById('memberUsername').value.trim();
    const studentId = document.getElementById('memberStudentIdCreate').value.trim();
    const email = document.getElementById('memberEmail').value.trim();
    const password = document.getElementById('memberPassword').value;
    if (!username || !studentId || !email || !password) {
        notify('Fill in all member fields', 'error');
        return;
    }
    const res = await fetch(`${API_URL}/admin/create-member`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username, studentId, email, password })
    });
    const data = await res.json();
    if (data.success) {
        notify('Member created');
    } else {
        notify(data.message || 'Member create failed', 'error');
    }
}

document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    window.location.href = 'index.html';
});
document.getElementById('createOwnerBtn').addEventListener('click', createOwner);
document.getElementById('createClubBtn').addEventListener('click', createClub);
document.getElementById('addOwnerBtn').addEventListener('click', addOwnerToClub);
document.getElementById('addMemberBtn').addEventListener('click', addMemberToClub);
document.getElementById('createMemberBtn').addEventListener('click', createMember);

window.addEventListener('load', async () => {
    await ensureAdmin();
    await fetchOwners();
    await fetchClubs();
    const ownerSelect = document.getElementById('clubOwnerSelect');
    const addOwnerSelect = document.getElementById('addOwnerSelect');
    const addOwnerClubSelect = document.getElementById('addOwnerClubSelect');
    const memberClubSelect = document.getElementById('memberClubSelect');
    if (ownerSelect) {
        ownerSelect.addEventListener('focus', () => {
            if (ownerSelect.options.length <= 1) fetchOwners();
        });
    }
    if (addOwnerSelect) {
        addOwnerSelect.addEventListener('focus', () => {
            if (addOwnerSelect.options.length <= 1) fetchOwners();
        });
    }
    if (addOwnerClubSelect) {
        addOwnerClubSelect.addEventListener('focus', () => {
            if (addOwnerClubSelect.options.length <= 1) fetchClubs();
        });
    }
    if (memberClubSelect) {
        memberClubSelect.addEventListener('focus', () => {
            if (memberClubSelect.options.length <= 1) fetchClubs();
        });
    }
});
