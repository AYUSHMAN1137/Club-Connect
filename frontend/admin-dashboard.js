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

function setSelectLoading(select, text) {
    if (!select) return;
    select.disabled = true;
    select.innerHTML = `<option value="">${text}</option>`;
}

function setSelectReady(select) {
    if (!select) return;
    select.disabled = false;
}

async function fetchOwners() {
    const select = document.getElementById('clubOwnerSelect');
    const addOwnerSelect = document.getElementById('addOwnerSelect');
    const deleteOwnerSelect = document.getElementById('deleteOwnerSelect');
    setSelectLoading(select, 'Loading owners...');
    setSelectLoading(addOwnerSelect, 'Loading owners...');
    setSelectLoading(deleteOwnerSelect, 'Loading owners...');
    const res = await fetch(`${API_URL}/admin/owners`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
        const list = document.getElementById('ownersList');
        const selectedOwner = select?.value || '';
        const selectedAddOwner = addOwnerSelect?.value || '';
        const selectedDeleteOwner = deleteOwnerSelect?.value || '';
        list.innerHTML = '';
        select.innerHTML = '<option value="">Select Owner</option>';
        if (addOwnerSelect) {
            addOwnerSelect.innerHTML = '<option value="">Select Owner</option>';
        }
        if (deleteOwnerSelect) {
            deleteOwnerSelect.innerHTML = '<option value="">Select Owner</option>';
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
            if (deleteOwnerSelect) {
                const delOpt = document.createElement('option');
                delOpt.value = o.id;
                delOpt.textContent = `${o.username} (#${o.id})`;
                deleteOwnerSelect.appendChild(delOpt);
            }
        });
        if (selectedOwner) {
            select.value = selectedOwner;
        }
        if (addOwnerSelect && selectedAddOwner) {
            addOwnerSelect.value = selectedAddOwner;
        }
        if (deleteOwnerSelect && selectedDeleteOwner) {
            deleteOwnerSelect.value = selectedDeleteOwner;
        }
        setSelectReady(select);
        setSelectReady(addOwnerSelect);
        setSelectReady(deleteOwnerSelect);
    }
}

async function fetchClubs() {
    const select = document.getElementById('memberClubSelect');
    const addOwnerClubSelect = document.getElementById('addOwnerClubSelect');
    const deleteClubSelect = document.getElementById('deleteClubSelect');
    setSelectLoading(select, 'Loading clubs...');
    setSelectLoading(addOwnerClubSelect, 'Loading clubs...');
    setSelectLoading(deleteClubSelect, 'Loading clubs...');
    const res = await fetch(`${API_URL}/admin/clubs`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
        const list = document.getElementById('clubsList');
        const selectedClub = select?.value || '';
        const selectedAddOwnerClub = addOwnerClubSelect?.value || '';
        const selectedDeleteClub = deleteClubSelect?.value || '';
        list.innerHTML = '';
        select.innerHTML = '<option value="">Select Club</option>';
        if (addOwnerClubSelect) {
            addOwnerClubSelect.innerHTML = '<option value="">Select Club</option>';
        }
        if (deleteClubSelect) {
            deleteClubSelect.innerHTML = '<option value="">Select Club</option>';
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
            if (deleteClubSelect) {
                const delOpt = document.createElement('option');
                delOpt.value = c.id;
                delOpt.textContent = `${c.name} (#${c.id})`;
                deleteClubSelect.appendChild(delOpt);
            }
        });
        if (selectedClub) {
            select.value = selectedClub;
        }
        if (addOwnerClubSelect && selectedAddOwnerClub) {
            addOwnerClubSelect.value = selectedAddOwnerClub;
        }
        if (deleteClubSelect && selectedDeleteClub) {
            deleteClubSelect.value = selectedDeleteClub;
        }
        setSelectReady(select);
        setSelectReady(addOwnerClubSelect);
        setSelectReady(deleteClubSelect);
    }
}

async function fetchMembers() {
    const deleteMemberSelect = document.getElementById('deleteMemberSelect');
    setSelectLoading(deleteMemberSelect, 'Loading members...');
    const res = await fetch(`${API_URL}/admin/members`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
        const selectedDeleteMember = deleteMemberSelect?.value || '';
        if (deleteMemberSelect) {
            deleteMemberSelect.innerHTML = '<option value="">Select Member</option>';
        }
        data.members.forEach(m => {
            if (deleteMemberSelect) {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = `${m.username} (#${m.id})`;
                deleteMemberSelect.appendChild(opt);
            }
        });
        if (deleteMemberSelect && selectedDeleteMember) {
            deleteMemberSelect.value = selectedDeleteMember;
        }
        setSelectReady(deleteMemberSelect);
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
        await fetchMembers();
    } else {
        notify(data.message || 'Member create failed', 'error');
    }
}

async function deleteOwner() {
    const ownerId = document.getElementById('deleteOwnerSelect').value;
    if (!ownerId) {
        notify('Select an owner to delete', 'error');
        return;
    }
    const ok = window.confirm('Delete this owner and all their clubs and related data?');
    if (!ok) return;
    const res = await fetch(`${API_URL}/admin/owners/${ownerId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
        notify('Owner deleted');
        await fetchOwners();
        await fetchClubs();
        await fetchMembers();
    } else {
        notify(data.message || 'Owner delete failed', 'error');
    }
}

async function deleteClub() {
    const clubId = document.getElementById('deleteClubSelect').value;
    if (!clubId) {
        notify('Select a club to delete', 'error');
        return;
    }
    const ok = window.confirm('Delete this club and all related data?');
    if (!ok) return;
    const res = await fetch(`${API_URL}/admin/clubs/${clubId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
        notify('Club deleted');
        await fetchClubs();
    } else {
        notify(data.message || 'Club delete failed', 'error');
    }
}

async function deleteMember() {
    const memberId = document.getElementById('deleteMemberSelect').value;
    if (!memberId) {
        notify('Select a member to delete', 'error');
        return;
    }
    const ok = window.confirm('Delete this member and all related data?');
    if (!ok) return;
    const res = await fetch(`${API_URL}/admin/members/${memberId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
        notify('Member deleted');
        await fetchMembers();
        await fetchClubs();
    } else {
        notify(data.message || 'Member delete failed', 'error');
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
document.getElementById('deleteOwnerBtn').addEventListener('click', deleteOwner);
document.getElementById('deleteClubBtn').addEventListener('click', deleteClub);
document.getElementById('deleteMemberBtn').addEventListener('click', deleteMember);

window.addEventListener('load', async () => {
    await ensureAdmin();
    await fetchOwners();
    await fetchClubs();
    await fetchMembers();
    const ownerSelect = document.getElementById('clubOwnerSelect');
    const addOwnerSelect = document.getElementById('addOwnerSelect');
    const addOwnerClubSelect = document.getElementById('addOwnerClubSelect');
    const memberClubSelect = document.getElementById('memberClubSelect');
    const deleteMemberSelect = document.getElementById('deleteMemberSelect');
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
    if (deleteMemberSelect) {
        deleteMemberSelect.addEventListener('focus', () => {
            if (deleteMemberSelect.options.length <= 1) fetchMembers();
        });
    }
});
