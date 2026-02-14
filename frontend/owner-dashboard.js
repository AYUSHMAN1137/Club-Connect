// Debug logging
console.log('=== Owner Dashboard JavaScript Loading ===');

// Global error handler for debugging
window.addEventListener('error', function (e) {
    console.error('❌ Global error caught:', e.error, e.message, e.filename, e.lineno);
    alert('JavaScript Error: ' + e.message + '\n\nCheck console (F12) for details.');
});

// Unhandled promise rejection handler
window.addEventListener('unhandledrejection', function (e) {
    console.error('❌ Unhandled promise rejection:', e.reason);
});

// API Configuration - API_URL is defined in utils.js, use it from window
// Don't redeclare to avoid SyntaxError - use helper function instead
function getApiUrl() {
    return window.API_URL || 'http://localhost:4000';
}

function getFullImageUrl(path) {
    if (!path) return '';
    const normalized = String(path).replace(/\\/g, '/').trim();
    if (!normalized) return '';
    if (normalized.startsWith('http')) return normalized;
    if (normalized.startsWith('/')) return `${getApiUrl()}${normalized}`;
    return `${getApiUrl()}/${normalized}`;
}

// Build participation stats from events for a given member
async function computeMemberEventStats(memberId) {
    try {
        const resp = await fetch(`${getApiUrl()}/owner/events`, {
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-cache'
        });
        const data = await resp.json();
        if (!data.success) return { rsvpCount: 0, attendedCount: 0, recent: [] };
        const idNum = Number(memberId);
        let rsvpCount = 0;
        let attendedCount = 0;
        const recent = [];
        (data.events || []).forEach(ev => {
            const rsvp = Array.isArray(ev.rsvpList) && ev.rsvpList.map(Number).includes(idNum);
            const attended = Array.isArray(ev.attendanceList) && ev.attendanceList.map(Number).includes(idNum);
            if (rsvp) rsvpCount++;
            if (attended) attendedCount++;
            if (rsvp || attended) {
                recent.push({
                    title: ev.title,
                    date: ev.date,
                    status: attended ? 'Attended' : 'RSVP'
                });
            }
        });
        // sort recent by date desc and keep last 5
        recent.sort((a, b) => new Date(b.date) - new Date(a.date));
        return { rsvpCount, attendedCount, recent: recent.slice(0, 5) };
    } catch (e) {
        console.warn('computeMemberEventStats error:', e);
        return { rsvpCount: 0, attendedCount: 0, recent: [] };
    }
}

// ===== All Events Modal =====
function renderAllEventsTable(events) {
    const tbody = document.querySelector('#eventsTableBody');
    if (!tbody) return;
    if (!events || events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">No events found</td></tr>';
        return;
    }

    tbody.innerHTML = events.map(ev => {
        const eventDate = new Date(ev.date);
        const formattedDate = eventDate.toLocaleDateString('en-GB'); // DD/MM/YYYY format
        const rsvpCount = ev.rsvpList ? ev.rsvpList.length : 0;
        const attendedCount = ev.attendanceList ? ev.attendanceList.length : 0;

        return `
        <tr class="events-table-row">
            <td class="events-table-cell events-table-title">${ev.title}</td>
            <td class="events-table-cell events-table-date">${formattedDate}</td>
            <td class="events-table-cell events-table-venue">${ev.venue}</td>
            <td class="events-table-cell events-table-number events-table-rsvp">${rsvpCount}</td>
            <td class="events-table-cell events-table-number events-table-attended">${attendedCount}</td>
        </tr>
    `}).join('');
}

async function openAllEventsModal() {
    try {
        const modal = document.getElementById('allEventsModal');
        const tbody = document.querySelector('#eventsTableBody');
        if (!modal || !tbody) return switchPage('events');
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading events...</td></tr>';
        const resp = await fetch(`${getApiUrl()}/owner/events`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await resp.json();
        const list = data.success ? (data.events || []) : [];
        renderAllEventsTable(list);
        modal.classList.add('active');

        // Wire search
        const input = document.getElementById('eventsSearchInput');
        if (input && !input.hasAttribute('data-listener-added')) {
            input.setAttribute('data-listener-added', 'true');
            input.addEventListener('input', (e) => {
                const q = e.target.value.toLowerCase();
                const filtered = list.filter(ev => (ev.title || '').toLowerCase().includes(q) || (ev.venue || '').toLowerCase().includes(q));
                renderAllEventsTable(filtered);
            });
        }
    } catch (err) {
        console.error('openAllEventsModal error:', err);
        switchPage('events');
    }
}

// expose for safety
window.openAllEventsModal = openAllEventsModal;

// Make brand clickable to return to Dashboard smoothly
document.addEventListener('DOMContentLoaded', () => {
    try {
        const brand = document.querySelector('.navbar-brand');
        if (brand) {
            brand.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof window.switchPage === 'function') {
                    window.switchPage('home');
                }
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }
    } catch (err) {
        console.warn('Brand click init failed:', err);
    }
});

// Click-throughs for stat cards and common shortcuts
function initClickThroughs() {
    try {
        const totalEventsCard = document.getElementById('totalEventsCard');
        if (totalEventsCard && !totalEventsCard.hasAttribute('data-listener-added')) {
            totalEventsCard.setAttribute('data-listener-added', 'true');
            totalEventsCard.addEventListener('click', () => {
                if (typeof openAllEventsModal === 'function') {
                    openAllEventsModal();
                } else {
                    // Fallback: go to Events page
                    switchPage('events');
                }
            });
        }
    } catch (err) { console.warn('initClickThroughs failed:', err); }
}

function getOwnerChecklistStorageKey() {
    const userKey = currentUserId ? `user:${currentUserId}` : 'user:unknown';
    const clubKey = currentClubId ? `club:${currentClubId}` : 'club:unknown';
    return `ownerChecklist:${userKey}:${clubKey}`;
}

function loadOwnerChecklistState() {
    try {
        const raw = localStorage.getItem(getOwnerChecklistStorageKey());
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        return {};
    }
}

function saveOwnerChecklistState(state) {
    try {
        localStorage.setItem(getOwnerChecklistStorageKey(), JSON.stringify(state || {}));
    } catch (e) { }
}

function applyOwnerChecklistState(items, state) {
    items.forEach((item, index) => {
        const id = item.getAttribute('data-check-id') || String(index);
        const completed = !!state[id];
        item.classList.toggle('is-complete', completed);
        item.setAttribute('aria-checked', completed ? 'true' : 'false');
    });
}

function initOwnerChecklist(options = {}) {
    try {
        const checklist = document.querySelector('.owner-checklist');
        if (!checklist) return;
        const alreadyInit = checklist.hasAttribute('data-init');
        if (!alreadyInit) checklist.setAttribute('data-init', 'true');
        const items = Array.from(checklist.querySelectorAll('.owner-check-item'));
        const progressText = document.querySelector('.owner-checklist-progress span');
        const progressFill = document.querySelector('.owner-checklist-fill');

        const updateProgress = () => {
            const total = items.length;
            const completed = items.filter((item) => item.classList.contains('is-complete')).length;
            if (progressText) {
                progressText.textContent = `${completed} of ${total} tasks completed`;
            }
            if (progressFill) {
                const width = total > 0 ? Math.round((completed / total) * 100) : 0;
                progressFill.style.width = `${width}%`;
            }
        };

        const restore = () => {
            const state = loadOwnerChecklistState();
            applyOwnerChecklistState(items, state);
            updateProgress();
        };

        if (!alreadyInit) {
            items.forEach((item, index) => {
                if (!item.getAttribute('data-check-id')) item.setAttribute('data-check-id', String(index));
                item.addEventListener('click', () => {
                    item.classList.toggle('is-complete');
                    const id = item.getAttribute('data-check-id') || String(index);
                    const state = loadOwnerChecklistState();
                    state[id] = item.classList.contains('is-complete');
                    saveOwnerChecklistState(state);
                    item.setAttribute('aria-checked', state[id] ? 'true' : 'false');
                    updateProgress();
                });
            });
        }

        if (options.forceRestore || !alreadyInit) {
            restore();
        } else {
            updateProgress();
        }
    } catch (err) {
        console.warn('initOwnerChecklist failed:', err);
    }
}

// ========== CLUB-SPECIFIC DATA MANAGEMENT ==========
// IMPORTANT: All data is club-specific. When an owner logs in:
// - Club name shows their club name (from dashboard-stats)
// - Members show ONLY their club's members (filtered by club.members array)
// - Events, announcements, etc. are filtered by clubId
// - Data is cleared on login to prevent showing wrong club's data

let currentMemberId = null;
let topMembersChart = null;
let socket = null;
let currentChatRecipientId = null;
let currentUserId = null;
let currentClubId = null; // Stores the logged-in owner's club ID
let allLoadedMembers = [];
window.allLoadedMembers = allLoadedMembers;
let ownerWorkshops = [];
let activeWorkshopId = null;
let activeWorkshopSessionId = null;
let activeWorkshopSections = [];
let activeWorkshopBundle = null;
let workshopPreviewEnabled = false;
let workshopSocketBound = false;

// Get token from localStorage
const token = localStorage.getItem('token');

console.log('Token exists:', !!token);

// Check authentication
if (!token) {
    console.log('No token found, redirecting to login');
    // Don't redirect immediately - let user see what's happening
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 2000);
}

// Verify token and role
async function verifyAuth() {
    console.log('verifyAuth() called');
    try {
        console.log('Fetching user data from API...');
        const response = await fetch(`${getApiUrl()}/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        console.log('Auth response:', data);

        if (!data.success || data.user.role !== 'owner') {
            console.log('Access denied - not owner or auth failed');
            showNotification('Access denied! Owner only.', 'error');
            setTimeout(() => {
                localStorage.removeItem('token');
                window.location.href = 'index.html';
            }, 2000);
            return;
        }

        console.log('Auth successful, user:', data.user.username, 'ID:', data.user.id);

        const ownerNameEl = document.getElementById('ownerName');
        if (ownerNameEl) {
            ownerNameEl.textContent = data.user.username;
        }
        const welcomeOwnerNameEl = document.getElementById('welcomeOwnerName');
        if (welcomeOwnerNameEl) {
            welcomeOwnerNameEl.textContent = data.user.username || 'Owner';
        }
        currentUserId = data.user.id;
        initOwnerChecklist({ forceRestore: true });

        // Clear any cached data when new user logs in
        allLoadedMembers = [];
        window.allLoadedMembers = [];
        currentClubId = null;

        // Initialize navigation FIRST
        console.log('Initializing navigation...');
        initializeNavigation();
        const initialPage = getPageFromUrl();
        switchPage(initialPage, { replaceHistory: true });
        initHistoryNavigation();
        initClickThroughs();
        bindModalBackdropClose();
        bindMemberProfileActions();

        console.log('Loading dashboard with fresh data...');

        // Initialize features
        console.log('Initializing features...');
        // Dark mode from utils.js
        if (typeof initDarkMode === 'function') {
            initDarkMode();
        } else {
            // Fallback dark mode initialization
            const darkMode = localStorage.getItem('darkMode') === 'true';
            if (darkMode) {
                document.body.classList.add('dark-mode');
            }
            const toggle = document.getElementById('darkModeToggle');
            if (toggle) {
                toggle.checked = darkMode;
                toggle.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        document.body.classList.add('dark-mode');
                        localStorage.setItem('darkMode', 'true');
                    } else {
                        document.body.classList.remove('dark-mode');
                        localStorage.setItem('darkMode', 'false');
                    }
                });
            }
        }
        if (typeof initSocketIO === 'function') {
            initSocketIO();
        }
        if (typeof initTooltips === 'function') {
            initTooltips();
        }
        loadNotifications();
        updateNotificationBadge();

        console.log('Dashboard initialization complete!');
    } catch (error) {
        console.error('Auth error:', error);
        showNotification('Error connecting to server. Please ensure backend is running.', 'error');
        // Don't redirect immediately on error - let user see the error
    }
}

// Logout function
function handleLogout(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    console.log('🚪 Logout clicked');

    // Clear all data
    localStorage.removeItem('token');
    localStorage.removeItem('darkMode');

    // Redirect to login
    window.location.href = 'index.html';
}

// Attach logout handler when DOM is ready
function attachLogoutHandler() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        // Remove any existing listeners
        const newBtn = logoutBtn.cloneNode(true);
        logoutBtn.parentNode.replaceChild(newBtn, logoutBtn);

        // Add click listener
        newBtn.addEventListener('click', handleLogout);
        console.log('✅ Logout handler attached');
    } else {
        console.warn('⚠️ Logout button not found, will retry...');
        setTimeout(attachLogoutHandler, 500);
    }
}

// Try to attach immediately
attachLogoutHandler();

// Also try when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachLogoutHandler);
} else {
    setTimeout(attachLogoutHandler, 100);
}

// Expose to window for onclick handler
window.handleLogout = handleLogout;

// Page Switching - Initialize after DOM is ready
let menuItems;
let pages;
let historyInitialized = false;
let navigationInitialized = false;

function initializeNavigation() {
    if (navigationInitialized) return;
    menuItems = document.querySelectorAll('.menu-item');
    pages = document.querySelectorAll('.page');

    console.log('Found menu items:', menuItems.length);
    console.log('Found pages:', pages.length);

    menuItems.forEach(item => {
        if (item.hasAttribute('data-nav-listener-added')) return;
        item.setAttribute('data-nav-listener-added', 'true');
        item.addEventListener('click', () => {
            const pageName = item.getAttribute('data-page');
            console.log('Menu item clicked:', pageName);
            if (!item.hasAttribute('onclick')) {
                switchPage(pageName);
            }

            // Close sidebar on mobile when item clicked
            const sidebar = document.querySelector('.sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (window.innerWidth <= 900) {
                sidebar.classList.remove('active');
                if (overlay) overlay.classList.remove('active');
            }
        });
    });
    navigationInitialized = true;

    // Mobile Sidebar Toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (sidebarToggle && sidebar) {
        // Remove old listener if any (clone node trick)
        const newToggle = sidebarToggle.cloneNode(true);
        sidebarToggle.parentNode.replaceChild(newToggle, sidebarToggle);

        newToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('active');
            if (overlay) overlay.classList.toggle('active');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            if (sidebar) sidebar.classList.remove('active');
            overlay.classList.remove('active');
        });
    }
}

function getActivePageName() {
    const activePage = document.querySelector('.page.active');
    if (!activePage) return null;
    const id = activePage.id || '';
    return id.endsWith('-page') ? id.replace('-page', '') : null;
}

function getPageFromUrl() {
    const hash = window.location.hash.replace('#', '').trim();
    if (!hash) return 'home';
    const pageElement = document.getElementById(`${hash}-page`);
    const menuItem = document.querySelector(`[data-page="${hash}"]`);
    if (pageElement && menuItem) return hash;
    return 'home';
}

function initHistoryNavigation() {
    if (historyInitialized) return;
    historyInitialized = true;
    const currentPage = getActivePageName() || 'home';
    history.replaceState({ page: currentPage }, '', `#${currentPage}`);
    window.addEventListener('popstate', (e) => {
        const targetPage = e.state && e.state.page ? e.state.page : 'home';
        switchPage(targetPage, { skipHistory: true });
        if (!e.state || !e.state.page) {
            history.replaceState({ page: targetPage }, '', `#${targetPage}`);
        }
    });
}

function switchPage(pageName, options = {}) {
    console.log('🚀 switchPage called with:', pageName);

    try {
        const previousPageName = getActivePageName();
        if (previousPageName === pageName && !options.force) {
            return;
        }
        // Get fresh references if not initialized
        const currentMenuItems = menuItems || document.querySelectorAll('.menu-item');
        const currentPages = pages || document.querySelectorAll('.page');

        console.log('Found menu items:', currentMenuItems.length, 'Found pages:', currentPages.length);

        // Update menu
        currentMenuItems.forEach(item => item.classList.remove('active'));
        const menuItem = document.querySelector(`[data-page="${pageName}"]`);
        if (menuItem) {
            menuItem.classList.add('active');
            console.log('✅ Menu item activated');
        } else {
            console.error('❌ Menu item not found for page:', pageName);
        }

        // Update content
        currentPages.forEach(page => page.classList.remove('active'));
        const pageElement = document.getElementById(`${pageName}-page`);
        if (pageElement) {
            pageElement.classList.add('active');
            console.log('✅ Page activated:', pageName);
        } else {
            console.error('❌ Page element not found:', `${pageName}-page`);
            // Don't show alert, just log error
            return;
        }

        // Load page data
        switch (pageName) {
            case 'home':
                loadDashboardStats(); // This will also update club name
                break;
            case 'members':
                // Reload members to ensure club-specific data
                loadMembers();
                // Also reload dashboard stats to update club name if needed
                loadDashboardStats();
                break;
            case 'events':
                loadEvents();
                break;
            case 'workshops':
                loadOwnerWorkshops();
                break;
            case 'announcements':
                loadAnnouncements();
                break;
            case 'polls':
                loadPolls();
                break;
            case 'certificates':
                loadOwnerCertificates();
                break;
            case 'project-progress':
                loadProjectProgress();
                break;
            case 'analytics':
                loadAdvancedAnalytics();
                break;
            case 'messages':
                loadMessages();
                break;
            case 'settings':
                loadSettings();
                // Ensure form listener is attached
                setTimeout(() => {
                    const form = document.getElementById('settingsForm');
                    if (form && !form.hasAttribute('data-listener-added')) {
                        form.setAttribute('data-listener-added', 'true');
                        form.addEventListener('submit', async (e) => {
                            e.preventDefault();
                            const name = document.getElementById('settingsClubName')?.value?.trim();
                            const tagline = document.getElementById('settingsTagline')?.value?.trim();
                            const themeColor = document.getElementById('settingsThemeColor')?.value || '#3b82f6';
                            if (!name) {
                                showNotification('Club name is required!', 'error');
                                return;
                            }
                            try {
                                const response = await fetch(`${getApiUrl()}/owner/update-club`, {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${token}`,
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ name, tagline, themeColor })
                                });
                                const data = await response.json();
                                if (data.success) {
                                    showNotification('Settings updated successfully!', 'success');
                                    const clubNameEl = document.getElementById('clubName');
                                    if (clubNameEl) clubNameEl.textContent = name;
                                    setTimeout(() => loadDashboardStats(), 500);
                                } else {
                                    showNotification(data.message || 'Failed to update settings', 'error');
                                }
                            } catch (error) {
                                console.error('Error updating settings:', error);
                                showNotification('Failed to update settings', 'error');
                            }
                        });
                    }
                }, 100);
                break;
            default:
                console.warn('Unknown page:', pageName);
        }

        if (!options.skipHistory) {
            if (options.replaceHistory) {
                history.replaceState({ page: pageName }, '', `#${pageName}`);
            } else if (previousPageName === pageName) {
                history.replaceState({ page: pageName }, '', `#${pageName}`);
            } else {
                history.pushState({ page: pageName }, '', `#${pageName}`);
            }
        }
    } catch (error) {
        console.error('❌ Error in switchPage:', error);
        // Don't show alert, just log error
    }
}

// IMMEDIATELY expose functions to window - don't wait!
window.switchPage = switchPage;
console.log('✅ switchPage exposed to window immediately');

// Load Dashboard Stats
async function loadDashboard() {
    await loadDashboardStats();
}

async function loadDashboardStats() {
    try {
        console.log('📊 Loading dashboard stats for current owner...');
        const [statsResponse, membersResponse, eventsResponse] = await Promise.all([
            fetch(`${getApiUrl()}/owner/dashboard-stats`, {
                headers: { 'Authorization': `Bearer ${token}` },
                cache: 'no-cache' // Ensure fresh data
            }),
            fetch(`${getApiUrl()}/owner/members`, {
                headers: { 'Authorization': `Bearer ${token}` },
                cache: 'no-cache'
            }),
            fetch(`${getApiUrl()}/owner/events`, {
                headers: { 'Authorization': `Bearer ${token}` },
                cache: 'no-cache'
            })
        ]);

        // Check if responses are ok before parsing
        if (!statsResponse.ok) {
            const errorText = await statsResponse.text();
            console.error('Dashboard stats API error:', statsResponse.status, errorText);
            showNotification('Failed to load dashboard stats. Please check if server is running.', 'error');
            return;
        }

        if (!membersResponse.ok) {
            console.error('Members API error:', membersResponse.status);
        }

        if (!eventsResponse.ok) {
            console.error('Events API error:', eventsResponse.status);
        }

        const statsData = await statsResponse.json();
        const membersData = membersResponse.ok ? await membersResponse.json() : { success: false, members: [] };
        const eventsData = eventsResponse.ok ? await eventsResponse.json() : { success: false, events: [] };

        if (statsData.success) {
            const stats = statsData.stats;

            // Update navbar club name IMMEDIATELY
            const clubNameEl = document.getElementById('clubName');
            if (clubNameEl && stats.clubName) {
                clubNameEl.textContent = stats.clubName;
                console.log('✅ Club name updated to:', stats.clubName);
            } else {
                console.error('❌ Club name element not found or stats.clubName missing');
            }
            const welcomeClubNameEl = document.getElementById('welcomeClubName');
            if (welcomeClubNameEl && stats.clubName) {
                welcomeClubNameEl.textContent = stats.clubName;
            }
            currentClubId = stats.clubId || null;
            console.log('✅ Current club ID set to:', currentClubId);
            initOwnerChecklist({ forceRestore: true });

            // Update basic stats
            document.getElementById('totalMembers').textContent = stats.totalMembers;
            document.getElementById('totalEvents').textContent = stats.totalEvents;

            // Calculate average attendance
            let avgAttendance = 0;
            if (eventsData.success && eventsData.events.length > 0) {
                const totalAttendance = eventsData.events.reduce((sum, event) => {
                    return sum + (event.attendanceList ? event.attendanceList.length : 0);
                }, 0);
                avgAttendance = eventsData.events.length > 0
                    ? Math.round((totalAttendance / (eventsData.events.length * (stats.totalMembers || 1))) * 100)
                    : 0;
            }
            document.getElementById('avgAttendance').textContent = avgAttendance + '%';

            // Get top member
            if (membersData.success && membersData.members.length > 0) {
                const sortedMembers = membersData.members.sort((a, b) => (b.points || 0) - (a.points || 0));
                const topMember = sortedMembers[0];
                document.getElementById('topMemberName').textContent = topMember.username || '-';
                document.getElementById('topMemberPoints').textContent = (topMember.points || 0) + ' points';
            } else {
                document.getElementById('topMemberName').textContent = '-';
                document.getElementById('topMemberPoints').textContent = 'No members';
            }

            const topMembersList = document.getElementById('topMembersList');
            if (topMembersList) {
                if (membersData.success && Array.isArray(membersData.members) && membersData.members.length > 0) {
                    const top = [...membersData.members]
                        .sort((a, b) => (b.points || 0) - (a.points || 0))
                        .slice(0, 5);

                    topMembersList.innerHTML = top.map((m) => {
                        const name = escapeHtml(m.username || 'Member');
                        const initials = name ? name.substring(0, 2).toUpperCase() : 'UN';
                        const points = Number(m.points) || 0;
                        const role = escapeHtml((m.clubRole || 'member').toUpperCase());
                        return `
                            <button class="owner-member-row owner-member-row-btn" type="button" onclick="openMemberProfile(${m.id})">
                                <span class="owner-member-avatar" aria-hidden="true">${initials}</span>
                                <span class="owner-member-info">
                                    <span class="owner-member-name">${name}</span>
                                    <span class="owner-member-meta">${role}</span>
                                </span>
                                <span class="owner-member-points">${points} pts</span>
                            </button>
                        `;
                    }).join('');
                } else {
                    topMembersList.innerHTML = `
                        <div class="empty-state">
                            <i class="fa-solid fa-users"></i>
                            <p>No members yet</p>
                        </div>
                    `;
                }
            }

            const upcomingBody = document.getElementById('upcomingEventBody');
            if (upcomingBody) {
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const upcoming = (eventsData.success ? (eventsData.events || []) : [])
                    .filter((ev) => {
                        const d = new Date(ev.date);
                        if (Number.isNaN(d.getTime())) return false;
                        return d >= today;
                    })
                    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

                if (upcoming) {
                    const title = escapeHtml(upcoming.title || 'Upcoming event');
                    const venue = escapeHtml(upcoming.venue || 'TBA');
                    const date = new Date(upcoming.date);
                    const dateText = date.toLocaleDateString();
                    const diffDays = Math.max(0, Math.round((date - today) / (24 * 60 * 60 * 1000)));
                    const pill = diffDays === 0 ? 'Today' : `In ${diffDays} day${diffDays === 1 ? '' : 's'}`;
                    upcomingBody.innerHTML = `
                        <div class="owner-upcoming-item">
                            <div class="owner-upcoming-icon" aria-hidden="true">
                                <i class="fa-solid fa-calendar-day"></i>
                            </div>
                            <div class="owner-upcoming-info">
                                <p class="owner-upcoming-title">${title}</p>
                                <p class="owner-upcoming-meta">${dateText} • ${venue}</p>
                            </div>
                            <span class="owner-upcoming-pill">${pill}</span>
                        </div>
                    `;
                } else {
                    upcomingBody.innerHTML = `
                        <div class="empty-state">
                            <i class="fa-solid fa-calendar-plus"></i>
                            <p>No upcoming events</p>
                        </div>
                    `;
                }
            }

            const activityList = document.getElementById('recentActivityList');
            if (activityList) {
                try {
                    const resp = await fetch(`${getApiUrl()}/notifications`, {
                        headers: { 'Authorization': `Bearer ${token}` },
                        cache: 'no-cache'
                    });
                    const json = await resp.json();
                    if (resp.ok && json && json.success && Array.isArray(json.notifications) && json.notifications.length > 0) {
                        const items = [...json.notifications]
                            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                            .slice(0, 4);

                        activityList.innerHTML = items.map((n) => {
                            const title = escapeHtml(n.title || 'Notification');
                            const message = escapeHtml(n.message || '');
                            const timeText = new Date(n.createdAt).toLocaleString();
                            const unread = !n.read;
                            const icon = unread ? 'bell' : 'bell';
                            return `
                                <button class="owner-activity-item ${unread ? 'is-unread' : ''}" type="button" onclick="markNotificationRead(${n.id})">
                                    <span class="owner-activity-icon" aria-hidden="true"><i class="fa-solid fa-${icon}"></i></span>
                                    <span class="owner-activity-info">
                                        <span class="owner-activity-title">${title}</span>
                                        <span class="owner-activity-message">${message}</span>
                                        <span class="owner-activity-time">${timeText}</span>
                                    </span>
                                </button>
                            `;
                        }).join('');
                    } else {
                        activityList.innerHTML = `
                            <div class="empty-state">
                                <i class="fa-solid fa-bell-slash"></i>
                                <p>No recent activity</p>
                            </div>
                        `;
                    }
                } catch (e) {
                    activityList.innerHTML = `
                        <div class="empty-state">
                            <i class="fa-solid fa-bell-slash"></i>
                            <p>No recent activity</p>
                        </div>
                    `;
                }
            }

            // Load recent events (last 3)
            const recentEventsList = document.getElementById('recentEventsList');
            if (eventsData.success && eventsData.events.length > 0) {
                const recentEvents = [...eventsData.events]
                    .sort((a, b) => new Date(b.date) - new Date(a.date))
                    .slice(0, 3);
                recentEventsList.innerHTML = recentEvents.map(event => {
                    const title = escapeHtml(event.title || '');
                    const venue = escapeHtml(event.venue || 'TBA');
                    const attended = event.attendanceList ? event.attendanceList.length : 0;
                    const dateText = new Date(event.date).toLocaleDateString();
                    return `
                    <div class="recent-event-item">
                        <div class="recent-event-icon">
                            <i class="fa-solid fa-calendar-day"></i>
                        </div>
                        <div class="recent-event-info">
                            <h4>${title}</h4>
                            <p><i class="fa-solid fa-calendar"></i> ${dateText} • ${venue}</p>
                        </div>
                        <a class="recent-event-meta" href="#" onclick="return false;">${attended} attended</a>
                    </div>
                `;
                }).join('');
            } else {
                recentEventsList.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-calendar-xmark"></i>
                        <p>No events created yet</p>
                    </div>
                `;
            }
        } else {
            console.error('Dashboard stats failed:', statsData);
            showNotification(statsData.message || 'Failed to load dashboard data', 'error');
        }
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            showNotification(`Cannot connect to server! Please make sure backend server is running on ${getApiUrl()}`, 'error');
        } else {
            showNotification('Failed to load dashboard stats: ' + error.message, 'error');
        }
    }
}

// Load Members - Club-specific

// ===== Actions Dropdown (Members table) =====
let actionDropdownBindingsDone = false;
let modalBackdropBindingsDone = false;
let memberProfileActionBindingsDone = false;

function closeAllActionDropdowns(except = null) {
    document.querySelectorAll('.action-dropdown.open').forEach(dd => {
        if (dd !== except) {
            dd.classList.remove('open');
            dd.classList.remove('dropup');
            const btn = dd.querySelector('.action-dropdown-btn');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        }
    });
}

function bindGlobalDropdownClosers() {
    if (actionDropdownBindingsDone) return;
    document.addEventListener('click', (e) => {
        const isInside = e.target.closest && e.target.closest('.action-dropdown');
        if (!isInside) closeAllActionDropdowns();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllActionDropdowns();
    });
    actionDropdownBindingsDone = true;
}

function closeModalById(modalId) {
    if (!modalId) return;
    if (modalId === 'awardPointsModal') return closeAwardPointsModal();
    if (modalId === 'roleModal') return closeRoleModal();
    if (modalId === 'memberProfileModal') return closeMemberProfile();
    if (modalId === 'notificationsModal' && typeof closeNotificationsModal === 'function') return closeNotificationsModal();
    if (modalId === 'attendanceModal' && typeof closeAttendanceModal === 'function') return closeAttendanceModal();
    if (modalId === 'newMessageModal' && typeof closeNewMessageModal === 'function') return closeNewMessageModal();
    if (modalId === 'qrAttendanceModal' && typeof closeQRAttendanceSession === 'function') return closeQRAttendanceSession();
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

function bindModalBackdropClose() {
    if (modalBackdropBindingsDone) return;
    document.addEventListener('click', (e) => {
        const modal = e.target.closest ? e.target.closest('.modal') : null;
        if (!modal || !modal.classList.contains('active')) return;
        if (e.target !== modal) return;
        closeModalById(modal.id);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.modal.active').forEach(m => closeModalById(m.id));
    });
    modalBackdropBindingsDone = true;
}

function bindMemberProfileActions() {
    if (memberProfileActionBindingsDone) return;
    const container = document.getElementById('memberProfileContent');
    if (!container) return;
    container.addEventListener('click', (e) => {
        const btn = e.target.closest ? e.target.closest('[data-profile-action]') : null;
        if (!btn) return;
        const action = btn.dataset.profileAction;
        const memberId = Number(btn.dataset.memberId);
        const memberName = btn.dataset.memberName || '';
        const memberRole = btn.dataset.memberRole || 'member';
        if (action === 'award') return openAwardPointsModal(memberId, memberName);
        if (action === 'role') return openRoleModal(memberId, memberName, memberRole);
        if (action === 'remove') return removeMember(memberId, memberName);
    });
    memberProfileActionBindingsDone = true;
}

function initActionDropdowns() {
    const tbody = document.getElementById('membersTableBody');
    if (!tbody) return;

    // Event delegation on tbody to avoid duplicate listeners per row
    if (!tbody.hasAttribute('data-dropdown-listener')) {
        tbody.setAttribute('data-dropdown-listener', 'true');
        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('.action-dropdown-btn');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                const wrapper = btn.closest('.action-dropdown');
                if (!wrapper) return;
                const alreadyOpen = wrapper.classList.contains('open');
                closeAllActionDropdowns();
                if (!alreadyOpen) {
                    wrapper.classList.add('open');
                    btn.setAttribute('aria-expanded', 'true');
                    // Decide drop direction after it becomes visible
                    requestAnimationFrame(() => {
                        try {
                            const menu = wrapper.querySelector('.action-dropdown-content');
                            if (!menu) return;
                            const rect = menu.getBoundingClientRect();
                            const spaceBelow = window.innerHeight - rect.top;
                            const estimatedHeight = Math.min(menu.scrollHeight || 260, 260) + 16; // include some spacing
                            if (spaceBelow < estimatedHeight) {
                                wrapper.classList.add('dropup');
                            } else {
                                wrapper.classList.remove('dropup');
                            }
                        } catch (err) { console.warn('Dropdown measure failed:', err); }
                    });
                }
            }

            const itemBtn = e.target.closest('.action-dropdown-content button');
            if (itemBtn) {
                const action = itemBtn.dataset.action;
                const memberId = Number(itemBtn.dataset.memberId);
                const memberName = itemBtn.dataset.memberName || '';
                const memberRole = itemBtn.dataset.memberRole || 'member';
                if (action === 'award') openAwardPointsModal(memberId, memberName);
                if (action === 'role') openRoleModal(memberId, memberName, memberRole);
                if (action === 'remove') removeMember(memberId, memberName);
                setTimeout(() => closeAllActionDropdowns(), 0);
            }

            const memberBtn = e.target.closest('.member-link');
            if (memberBtn) {
                const memberId = Number(memberBtn.dataset.memberId);
                if (memberId) openMemberProfile(memberId);
            }
        });
    }

    bindGlobalDropdownClosers();
}
// ===== Member Profile Modal =====
function renderMemberProfile(member, stats = null) {
    const content = document.getElementById('memberProfileContent');
    if (!content) return;
    const safeName = escapeHtml(member.username || '');
    const safeEmail = escapeHtml(member.email || '-');
    const safeStudentId = escapeHtml(member.studentId || '-');
    const roleRaw = (member.clubRole || 'member');
    const role = escapeHtml(roleRaw.toUpperCase());
    const rankRaw = member.rank || 'Rookie';
    const rank = escapeHtml(rankRaw);
    const points = member.points ?? 0;
    const rsvpCount = stats?.rsvpCount ?? 0;
    const attendedCount = stats?.attendedCount ?? 0;
    const recent = stats?.recent || [];

    const profilePicUrl = getFullImageUrl(
        member.profilePic ||
        member.profile?.pic ||
        member.profilePhoto ||
        member.avatar ||
        member.photoUrl ||
        member.photo
    );
    const hasProfilePic = Boolean(profilePicUrl);

    // Get initials for avatar
    const initials = safeName ? safeName.substring(0, 2).toUpperCase() : 'UN';

    // Determine rank color
    const rankColors = {
        'rookie': 'rank-rookie',
        'bronze': 'rank-bronze',
        'silver': 'rank-silver',
        'gold': 'rank-gold',
        'platinum': 'rank-platinum'
    };
    const rankClass = rankColors[rankRaw.toLowerCase()] || 'rank-rookie';

    // Recent activity HTML
    const recentHtml = recent.length ? recent.map(r => `
        <div class="profile-activity-item">
            <div class="profile-activity-icon ${r.status.toLowerCase() === 'attended' ? 'activity-attended' : 'activity-rsvp'}">
                <i class="fa-solid ${r.status === 'Attended' ? 'fa-check' : 'fa-user-check'}"></i>
            </div>
            <div class="profile-activity-details">
                <h4 class="profile-activity-title">${r.title}</h4>
                <p class="profile-activity-meta">
                    <i class="fa-solid fa-calendar"></i>
                    <span>${new Date(r.date).toLocaleDateString('en-GB')}</span>
                    <span class="activity-status ${r.status.toLowerCase()}">${r.status}</span>
                </p>
            </div>
        </div>
    `).join('') : `
        <div class="profile-empty-state">
            <i class="fa-solid fa-inbox"></i>
            <p>No recent activity</p>
        </div>
    `;

    content.innerHTML = `
        <!-- Profile Header -->
        <div class="profile-header-section">
            <div class="profile-avatar-wrapper">
                <div class="profile-avatar-large">
                    ${hasProfilePic ? `<img class="profile-avatar-img" src="${profilePicUrl}" alt="${safeName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
                    <span class="profile-avatar-initials" style="${hasProfilePic ? 'display: none;' : ''}">${initials}</span>
                    <div class="profile-avatar-ring"></div>
                </div>
            </div>
            <div class="profile-header-info">
                <h2 class="profile-name">${safeName}</h2>
                <div class="profile-badges">
                    <span class="profile-role-badge role-${roleRaw.toLowerCase()}">
                        <i class="fa-solid fa-user-tag"></i>
                        ${role}
                    </span>
                    <span class="profile-rank-badge ${rankClass}">
                        <i class="fa-solid fa-trophy"></i>
                        ${rank}
                    </span>
                </div>
            </div>
        </div>

        <!-- Quick Actions -->
        <div class="profile-actions-section">
            <button class="profile-action-btn action-primary" data-profile-action="award" data-member-id="${member.id}" data-member-name="${safeName}">
                <i class="fa-solid fa-star"></i>
                <span>Award Points</span>
            </button>
            <button class="profile-action-btn action-secondary" data-profile-action="role" data-member-id="${member.id}" data-member-name="${safeName}" data-member-role="${roleRaw}">
                <i class="fa-solid fa-user-tag"></i>
                <span>Assign Role</span>
            </button>
            <button class="profile-action-btn action-danger" data-profile-action="remove" data-member-id="${member.id}" data-member-name="${safeName}">
                <i class="fa-solid fa-trash"></i>
                <span>Remove</span>
            </button>
        </div>

        <!-- Info Cards Grid -->
        <div class="profile-info-grid">
            <div class="profile-info-card">
                <div class="profile-info-icon info-icon-blue">
                    <i class="fa-solid fa-id-card"></i>
                </div>
                <div class="profile-info-content">
                    <span class="profile-info-label">Student ID</span>
                    <strong class="profile-info-value">${safeStudentId}</strong>
                </div>
            </div>
            <div class="profile-info-card">
                <div class="profile-info-icon info-icon-purple">
                    <i class="fa-solid fa-envelope"></i>
                </div>
                <div class="profile-info-content">
                    <span class="profile-info-label">Email</span>
                    <strong class="profile-info-value profile-email">${safeEmail}</strong>
                </div>
            </div>
            <div class="profile-info-card">
                <div class="profile-info-icon info-icon-gold">
                    <i class="fa-solid fa-trophy"></i>
                </div>
                <div class="profile-info-content">
                    <span class="profile-info-label">Total Points</span>
                    <strong class="profile-info-value profile-points">${points}</strong>
                </div>
            </div>
            <div class="profile-info-card">
                <div class="profile-info-icon info-icon-gradient">
                    <i class="fa-solid fa-star"></i>
                </div>
                <div class="profile-info-content">
                    <span class="profile-info-label">Current Rank</span>
                    <strong class="profile-info-value">${rank}</strong>
                </div>
            </div>
        </div>

        <!-- Stats & Activity Container (Side by Side) -->
        <div class="profile-bottom-section">
            <!-- Stats Section -->
            <div class="profile-stats-section">
                <h3 class="profile-section-title">
                    <i class="fa-solid fa-chart-line"></i>
                    Event Participation
                </h3>
                <div class="profile-stats-grid">
                    <div class="profile-stat-card stat-green">
                        <div class="profile-stat-icon">
                            <i class="fa-solid fa-user-check"></i>
                        </div>
                        <div class="profile-stat-content">
                            <span class="profile-stat-label">RSVPs</span>
                            <div class="profile-stat-value">${rsvpCount}</div>
                        </div>
                        <div class="profile-stat-accent"></div>
                    </div>
                    <div class="profile-stat-card stat-blue">
                        <div class="profile-stat-icon">
                            <i class="fa-solid fa-check-circle"></i>
                        </div>
                        <div class="profile-stat-content">
                            <span class="profile-stat-label">Attended</span>
                            <div class="profile-stat-value">${attendedCount}</div>
                        </div>
                        <div class="profile-stat-accent"></div>
                    </div>
                </div>
            </div>

            <!-- Recent Activity -->
            <div class="profile-activity-section">
                <h3 class="profile-section-title">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    Recent Activity
                </h3>
                <div class="profile-activity-list">
                    ${recentHtml}
                </div>
            </div>
        </div>
    `;
}

async function openMemberProfile(memberId) {
    try {
        const modal = document.getElementById('memberProfileModal');
        const content = document.getElementById('memberProfileContent');
        if (!modal || !content) return;
        content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Loading profile...</p></div>';
        let list = Array.isArray(window.allLoadedMembers) ? window.allLoadedMembers : (Array.isArray(allLoadedMembers) ? allLoadedMembers : []);
        const mid = Number(memberId);
        let member = list.find(m => Number(m.id) === mid);
        if (!member) {
            // Fallback: refetch members quickly and retry
            try {
                const resp = await fetch(`${getApiUrl()}/owner/members`, { headers: { 'Authorization': `Bearer ${token}` }, cache: 'no-cache' });
                const data = await resp.json();
                if (data.success) {
                    window.allLoadedMembers = data.members || [];
                    list = window.allLoadedMembers;
                    member = list.find(m => Number(m.id) === mid);
                }
            } catch { }
        }
        if (!member) {
            content.innerHTML = '<p class="loading">Member details not found.</p>';
        } else {
            const stats = await computeMemberEventStats(memberId);
            renderMemberProfile(member, stats);
        }
        modal.classList.add('active');
    } catch (err) {
        console.error('openMemberProfile error:', err);
    }
}

function closeMemberProfile() {
    const modal = document.getElementById('memberProfileModal');
    if (modal) modal.classList.remove('active');
}

// Expose to window
window.openMemberProfile = openMemberProfile;
window.closeMemberProfile = closeMemberProfile;

async function loadMembers() {
    try {
        console.log('🔄 Loading members for current club...');
        const response = await fetch(`${getApiUrl()}/owner/members`, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            cache: 'no-cache' // Ensure fresh data
        });

        if (!response.ok) {
            console.error('Members API error:', response.status);
            const errorText = await response.text();
            showNotification('Failed to load members. ' + (errorText || ''), 'error');
            return;
        }

        const data = await response.json();

        if (data.success) {
            // Clear previous members and store new ones for current club ONLY
            allLoadedMembers = data.members || [];
            window.allLoadedMembers = allLoadedMembers;
            console.log(`✅ Loaded ${allLoadedMembers.length} members for current club`);
            console.log('Members:', allLoadedMembers.map(m => m.username).join(', '));

            const tbody = document.getElementById('membersTableBody');

            if (data.members.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="loading">No members yet. Add members using Student ID above.</td></tr>';
                return;
            }

            tbody.innerHTML = data.members.map(member => {
                const safeName = escapeHtml(member.username || '');
                const safeEmail = escapeHtml(member.email || '');
                const safeStudentId = escapeHtml(member.studentId || '');
                const safeRole = escapeHtml((member.clubRole || 'member'));
                return `
                <tr data-member-id="${member.id}">
                    <td><button type="button" class="link-btn member-link" data-member-id="${member.id}" onclick="openMemberProfile(${member.id})">${safeName}</button></td>
                    <td>${safeEmail}</td>
                    <td>${safeStudentId}</td>
                    <td><span class="role-badge ${(member.clubRole || 'member').toLowerCase()}">${safeRole.toUpperCase()}</span></td>
                    <td>${member.points}</td>
                    <td><span class="rank-badge ${member.rank.toLowerCase()}">${member.rank}</span></td>
                    <td>
                        <div class="action-dropdown">
                            <button type="button" class="action-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                                Actions <i class="fa-solid fa-chevron-down"></i>
                            </button>
                            <div class="action-dropdown-content">
                                <button type="button" data-action="award" data-member-id="${member.id}" data-member-name="${safeName}">
                                    <i class="fa-solid fa-star"></i> Award Points
                                </button>
                                <button type="button" data-action="role" data-member-id="${member.id}" data-member-name="${safeName}" data-member-role="${safeRole}">
                                    <i class="fa-solid fa-user-tag"></i> Assign Role
                                </button>
                                <button type="button" class="danger" data-action="remove" data-member-id="${member.id}" data-member-name="${safeName}">
                                    <i class="fa-solid fa-trash"></i> Remove
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            `}).join('');

            // Initialize dropdown interactions after rendering
            initActionDropdowns();
        } else {
            showNotification(data.message || 'Failed to load members', 'error');
        }
    } catch (error) {
        console.error('Error loading members:', error);
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            showNotification('Cannot connect to server! Please make sure backend server is running.', 'error');
        } else {
            showNotification('Failed to load members: ' + error.message, 'error');
        }
    }
}

// Award Points Modal
function openAwardPointsModal(memberId, memberName) {
    currentMemberId = memberId;
    document.getElementById('awardMemberName').textContent = memberName;
    document.getElementById('awardPointsModal').classList.add('active');
}

function closeAwardPointsModal() {
    document.getElementById('awardPointsModal').classList.remove('active');
    currentMemberId = null;
}

async function awardPoints(points) {
    if (!currentMemberId) return;

    try {
        const response = await fetch(`${getApiUrl()}/owner/award-points`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                memberId: currentMemberId,
                points: points
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            closeAwardPointsModal();
            loadMembers();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error awarding points:', error);
        showNotification('Failed to award points', 'error');
    }
}

// Remove Member
async function removeMember(memberId, memberName) {
    if (!confirm(`Are you sure you want to remove ${memberName}?`)) return;

    try {
        const response = await fetch(`${getApiUrl()}/owner/remove-member`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ memberId })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            loadMembers();
            loadDashboardStats();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error removing member:', error);
        showNotification('Failed to remove member', 'error');
    }
}

// Load Events
let eventsLoadInFlight = false;
async function loadEvents() {
    if (eventsLoadInFlight) return;
    eventsLoadInFlight = true;
    try {
        const response = await fetch(`${getApiUrl()}/owner/events`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            console.error('Events API error:', response.status);
            const errorText = await response.text();
            showNotification('Failed to load events. ' + (errorText || ''), 'error');
            return;
        }

        const data = await response.json();

        if (data.success) {
            const grid = document.getElementById('eventsGrid');

            if (data.events.length === 0) {
                grid.innerHTML = '<p class="loading">No events yet. Create one!</p>';
                return;
            }

            grid.innerHTML = data.events.map(event => {
                const d = new Date(event.date);
                const day = d.getDate();
                const month = d.toLocaleString('default', { month: 'short' });
                const isPast = new Date(event.date) < new Date(Date.now() - 86400000);
                const attendedCount = event.attendedCount || (event.attendanceList ? event.attendanceList.length : 0);

                return `
                <div class="event-card">
                    <div class="event-card-header">
                        <div class="event-date-badge">
                            <div class="event-date-day">${day}</div>
                            <div class="event-date-month">${month}</div>
                        </div>
                        <div>
                            <h3>${event.title}</h3>
                            <p><i class="fa-solid fa-location-dot"></i> ${event.venue}</p>
                        </div>
                    </div>
                    <div class="event-card-body">
                        <p><i class="fa-solid fa-users"></i> <strong>${attendedCount}</strong> Attended</p>
                    </div>
                    <div class="event-card-footer ${isPast ? 'is-past' : ''}">
                        ${isPast ? `
                        <button class="btn-qr btn-qr--muted is-disabled" disabled>
                            <i class="fa-solid fa-lock"></i> Past Event
                        </button>
                        <button class="btn-qr btn-qr--accent" onclick="showGalleryUpload(${event.id}, '${event.title.replace(/'/g, "\\'")}')">
                            <i class="fa-solid fa-images"></i> Gallery
                        </button>
                        <button class="btn-qr btn-qr--danger" onclick="deleteEventOwner(${event.id}, '${event.title.replace(/'/g, "\\'")}')">
                            <i class="fa-solid fa-trash"></i> Delete
                        </button>` : `
                        <button class="btn-qr btn-qr--primary" onclick="startQRAttendance(${event.id}, '${event.title.replace(/'/g, "\\'")}')">
                            <i class="fa-solid fa-qrcode"></i> QR Attendance
                        </button>
                        <button class="btn-qr btn-qr--secondary" onclick="openAttendanceModal(${event.id})">
                            <i class="fa-solid fa-clipboard-check"></i> Manual
                        </button>
                        <button class="btn-qr btn-qr--accent" onclick="showGalleryUpload(${event.id}, '${event.title.replace(/'/g, "\\'")}')">
                            <i class="fa-solid fa-images"></i> Gallery
                        </button>
                        <button class="btn-qr btn-qr--danger" onclick="deleteEventOwner(${event.id}, '${event.title.replace(/'/g, "\\'")}')">
                            <i class="fa-solid fa-trash"></i> Delete
                        </button>`}
                    </div>
                </div>`;
            }).join('');
        } else {
            showNotification(data.message || 'Failed to load events', 'error');
        }
    } catch (error) {
        console.error('Error loading events:', error);
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            showNotification('Cannot connect to server! Please make sure backend server is running.', 'error');
        } else {
            showNotification('Failed to load events: ' + error.message, 'error');
        }
    } finally {
        eventsLoadInFlight = false;
    }
}

function closeConfirmDialog() {
    document.getElementById('confirmDialog')?.classList.remove('active');
}

function openConfirmDialog({ title, message, icon, iconClass, onConfirm }) {
    const dialog = document.getElementById('confirmDialog');
    const confirmBtn = document.getElementById('confirmBtn');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmIcon = document.getElementById('confirmIcon');
    if (!dialog || !confirmBtn || !confirmTitle || !confirmMessage || !confirmIcon) {
        return;
    }
    confirmTitle.textContent = title || 'Confirm Action';
    confirmMessage.textContent = message || 'Are you sure you want to proceed?';
    confirmIcon.innerHTML = `<i class="${icon || 'fa-solid fa-question-circle'}"></i>`;
    confirmIcon.className = `confirm-icon ${iconClass || ''}`.trim();
    confirmBtn.onclick = async () => {
        closeConfirmDialog();
        if (typeof onConfirm === 'function') {
            await onConfirm();
        }
    };
    dialog.classList.add('active');
    dialog.onclick = (e) => {
        if (e.target === dialog) {
            closeConfirmDialog();
        }
    };
}

async function deleteEventOwner(eventId, eventTitle) {
    const label = eventTitle || 'this event';
    openConfirmDialog({
        title: `Delete ${label}?`,
        message: 'Attendance, gallery photos, and certificates will be removed.',
        icon: 'fa-solid fa-trash',
        iconClass: 'danger',
        onConfirm: async () => {
            try {
                const response = await fetch(`${getApiUrl()}/owner/events/${eventId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();
                if (data.success) {
                    showNotification('Event deleted!', 'success');
                    loadEvents();
                    loadDashboardStats();
                } else {
                    showNotification(data.message || 'Failed to delete event', 'error');
                }
            } catch (error) {
                console.error('Error deleting event:', error);
                showNotification('Failed to delete event', 'error');
            }
        }
    });
}

// Show/Hide Create Event Form
function showCreateEventForm() {
    document.getElementById('createEventForm').style.display = 'block';
}

function hideCreateEventForm() {
    document.getElementById('createEventForm').style.display = 'none';
    document.getElementById('eventForm').reset();
}

function setFormSubmittingState(form, isSubmitting, label) {
    if (!form) return;
    form.dataset.submitting = isSubmitting ? 'true' : 'false';
    const submitBtn = form.querySelector('button[type="submit"]');
    if (!submitBtn) return;
    if (isSubmitting) {
        submitBtn.dataset.originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        if (label) submitBtn.innerHTML = label;
    } else {
        submitBtn.disabled = false;
        if (submitBtn.dataset.originalText) {
            submitBtn.innerHTML = submitBtn.dataset.originalText;
            delete submitBtn.dataset.originalText;
        }
    }
}

// Create Event
document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (form.dataset.submitting === 'true') return;
    setFormSubmittingState(form, true, 'Creating...');

    const title = document.getElementById('eventTitle').value;
    const date = document.getElementById('eventDate').value;
    const venue = document.getElementById('eventVenue').value;
    const description = document.getElementById('eventDescription').value;

    try {
        const response = await fetch(`${getApiUrl()}/owner/create-event`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, date, venue, description })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Event created successfully!', 'success');
            hideCreateEventForm();
            loadEvents();
            loadDashboardStats();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error creating event:', error);
        showNotification('Failed to create event', 'error');
    } finally {
        setFormSubmittingState(form, false);
    }
});

// Show QR Code
function showQRCode(eventId, qrCode, eventTitle) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>QR Code - ${eventTitle}</h3>
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body" style="text-align: center;">
                <img src="${qrCode}" alt="QR Code" style="width: 300px; height: 300px;">
                <p style="margin-top: 20px; color: #6b7280;">Members can scan this QR code to mark attendance</p>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Load Announcements
async function loadAnnouncements() {
    try {
        const response = await fetch(`${getApiUrl()}/owner/announcements`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const list = document.getElementById('announcementsList');

            if (data.announcements.length === 0) {
                list.innerHTML = '<p class="loading">No announcements yet</p>';
                return;
            }

            list.innerHTML = data.announcements.map(announcement => `
                <div class="announcement-item">
                    <div class="announcement-item-header">
                        <div class="announcement-item-body">
                            <h4>${announcement.title}</h4>
                            <p>${announcement.message}</p>
                        </div>
                        <button class="announcement-delete-btn" onclick="deleteAnnouncementOwner(${announcement.id}, '${String(announcement.title || 'Announcement').replace(/'/g, "\\'")}')">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                    <div class="date">
                        <i class="fa-solid fa-clock"></i>
                        ${new Date(announcement.date).toLocaleString()}
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading announcements:', error);
        showNotification('Failed to load announcements', 'error');
    }
}

async function deleteAnnouncementOwner(announcementId, title) {
    const label = title || 'this announcement';
    if (!confirm(`Delete ${label}?`)) return;
    try {
        const response = await fetch(`${getApiUrl()}/owner/announcements/${announcementId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Announcement deleted!', 'success');
            loadAnnouncements();
        } else {
            showNotification(data.message || 'Failed to delete announcement', 'error');
        }
    } catch (error) {
        console.error('Error deleting announcement:', error);
        showNotification('Failed to delete announcement', 'error');
    }
}

// Send Announcement
document.getElementById('announcementForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (form.dataset.submitting === 'true') return;
    setFormSubmittingState(form, true, 'Sending...');

    const title = document.getElementById('announcementTitle').value || 'Announcement';
    const message = document.getElementById('announcementMessage').value;

    try {
        const response = await fetch(`${getApiUrl()}/owner/send-announcement`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, message })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Announcement sent successfully!', 'success');
            document.getElementById('announcementForm').reset();
            loadAnnouncements();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error sending announcement:', error);
        showNotification('Failed to send announcement', 'error');
    } finally {
        setFormSubmittingState(form, false);
    }
});

// ========== POLLS ==========
const pollOptionsState = [
    { id: 1, value: '' },
    { id: 2, value: '' },
    { id: 3, value: '' }
];
let lastAddedOptionId = null;

function renderPollOptions() {
    const list = document.getElementById('pollOptionsList');
    if (!list) return;
    list.innerHTML = pollOptionsState.map((option, index) => {
        const isRequired = index < 2;
        const optionalLabel = index === 2 ? ' (optional)' : '';
        const canDelete = index >= 2;
        const isNew = option.id === lastAddedOptionId ? ' is-new' : '';
        return `
            <div class="poll-option-row${isNew}" data-option-id="${option.id}">
                <div class="poll-option-input">
                    <label>Option ${index + 1}${isRequired ? ' *' : optionalLabel}</label>
                    <input type="text" class="poll-option-input-field" data-option-id="${option.id}"
                        value="${escapeHtml(option.value)}" placeholder="Option (e.g. Technical Workshop)">
                </div>
                ${canDelete ? `<button type="button" class="poll-option-remove" data-option-id="${option.id}"><i class="fa-solid fa-xmark"></i></button>` : ''}
            </div>`;
    }).join('');
    updatePollFormState();
    if (lastAddedOptionId) {
        const addedRow = list.querySelector(`[data-option-id="${lastAddedOptionId}"]`);
        if (addedRow) {
            setTimeout(() => addedRow.classList.remove('is-new'), 220);
        }
        lastAddedOptionId = null;
    }
}

function addPollOption() {
    if (pollOptionsState.length >= 6) return;
    const nextId = Math.max(...pollOptionsState.map(o => o.id)) + 1;
    pollOptionsState.push({ id: nextId, value: '' });
    lastAddedOptionId = nextId;
    renderPollOptions();
}

function removePollOption(optionId) {
    if (pollOptionsState.length <= 2) return;
    const index = pollOptionsState.findIndex(o => o.id === optionId);
    if (index <= 1) return;
    pollOptionsState.splice(index, 1);
    renderPollOptions();
}

function animateRemovePollOption(optionId) {
    const row = document.querySelector(`.poll-option-row[data-option-id="${optionId}"]`);
    if (!row) {
        removePollOption(optionId);
        return;
    }
    row.classList.add('is-removing');
    setTimeout(() => removePollOption(optionId), 180);
}

function getFilledPollOptions() {
    return pollOptionsState.map(o => o.value.trim()).filter(Boolean);
}

function validatePollForm(showErrors = false) {
    const question = document.getElementById('pollQuestion')?.value?.trim() || '';
    const questionError = document.getElementById('pollQuestionError');
    const optionsError = document.getElementById('pollOptionsError');
    const filledOptions = getFilledPollOptions();
    let isValid = true;

    if (!question) {
        isValid = false;
        if (showErrors && questionError) questionError.textContent = 'Poll question is required.';
    } else if (questionError) {
        questionError.textContent = '';
    }

    if (filledOptions.length < 2) {
        isValid = false;
        if (showErrors && optionsError) optionsError.textContent = 'Please enter at least two options.';
    } else if (optionsError) {
        optionsError.textContent = '';
    }

    return isValid;
}

function updatePollFormState() {
    const createBtn = document.getElementById('pollCreateBtn');
    const addBtn = document.getElementById('addPollOptionBtn');
    const isValid = validatePollForm(false);
    if (createBtn) createBtn.disabled = !isValid;
    if (addBtn) addBtn.disabled = pollOptionsState.length >= 6;
}

async function loadPolls() {
    const list = document.getElementById('pollsList');
    if (!list) return;
    list.innerHTML = '<p class="loading">Loading polls...</p>';
    try {
        const response = await fetch(`${getApiUrl()}/owner/polls`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) {
            list.innerHTML = '<p class="loading">Failed to load polls.</p>';
            return;
        }
        const polls = data.polls || [];
        if (polls.length === 0) {
            list.innerHTML = `
                <div class="poll-empty">
                    <div class="poll-empty-icon"><i class="fa-solid fa-chart-column"></i></div>
                    <h4>No polls yet</h4>
                    <p>Create your first poll using the form above.</p>
                </div>`;
            return;
        }
        list.innerHTML = polls.map(poll => {
            const total = poll.totalVotes || 0;
            const optionCount = (poll.options || []).length;
            const optionsHtml = (poll.options || []).map(opt => {
                const pct = total > 0 ? Math.round((opt.voteCount / total) * 100) : 0;
                return `
                    <div class="poll-option">
                        <div class="poll-option-top">
                            <span class="poll-option-label">${escapeHtml(opt.text)}</span>
                            <span class="poll-option-stats">${opt.voteCount} votes (${pct}%)</span>
                        </div>
                        <div class="poll-option-bar">
                            <div class="poll-option-bar-fill" data-pct="${pct}"></div>
                        </div>
                    </div>`;
            }).join('');
            const statusBadge = poll.status === 'closed' ? '<span class="poll-status poll-status--closed">Closed</span>' : '<span class="poll-status poll-status--active">Active</span>';
            const closeBtn = poll.status === 'active' ? `<button type="button" class="btn-secondary btn-sm poll-close-btn" onclick="closePollOwner(${poll.id})">Close Poll</button>` : '';
            const deleteBtn = `<button type="button" class="btn-secondary btn-sm poll-delete-btn" onclick="deletePollOwner(${poll.id})"><i class="fa-solid fa-trash"></i> Delete</button>`;
            return `
                <div class="poll-card">
                    <div class="poll-card-header">
                        <h4 class="poll-title">${escapeHtml(poll.question)}</h4>
                        <div class="poll-badges">${statusBadge}${closeBtn}${deleteBtn}</div>
                    </div>
                    <div class="poll-card-meta">
                        <span class="poll-chip"><i class="fa-solid fa-chart-simple"></i> ${total} votes</span>
                        <span class="poll-chip"><i class="fa-solid fa-list"></i> ${optionCount} options</span>
                        ${poll.endDate ? `<span class="poll-chip poll-chip--muted"><i class="fa-solid fa-calendar"></i> Ends ${poll.endDate}</span>` : ''}
                    </div>
                    <div class="poll-results">${optionsHtml}</div>
                </div>`;
        }).join('');
        requestAnimationFrame(() => {
            document.querySelectorAll('.poll-option-bar-fill').forEach((bar) => {
                const pct = Number(bar.dataset.pct || 0);
                bar.style.width = `${pct}%`;
            });
        });
    } catch (error) {
        console.error('Error loading polls:', error);
        list.innerHTML = '<p class="loading">Failed to load polls.</p>';
        showNotification('Failed to load polls', 'error');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function closePollOwner(pollId) {
    try {
        const response = await fetch(`${getApiUrl()}/owner/polls/${pollId}/close`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Poll closed!', 'success');
            loadPolls();
        } else {
            showNotification(data.message || 'Failed to close poll', 'error');
        }
    } catch (error) {
        console.error('Error closing poll:', error);
        showNotification('Failed to close poll', 'error');
    }
}

async function deletePollOwner(pollId) {
    if (!confirm('Delete this poll? Votes will be removed.')) return;
    try {
        const response = await fetch(`${getApiUrl()}/owner/polls/${pollId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Poll deleted!', 'success');
            loadPolls();
        } else {
            showNotification(data.message || 'Failed to delete poll', 'error');
        }
    } catch (error) {
        console.error('Error deleting poll:', error);
        showNotification('Failed to delete poll', 'error');
    }
}

document.getElementById('pollOptionsList')?.addEventListener('input', (event) => {
    const input = event.target.closest('.poll-option-input-field');
    if (!input) return;
    const optionId = Number(input.dataset.optionId);
    const option = pollOptionsState.find(o => o.id === optionId);
    if (option) option.value = input.value;
    updatePollFormState();
});

document.getElementById('pollOptionsList')?.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.poll-option-remove');
    if (!removeBtn) return;
    const optionId = Number(removeBtn.dataset.optionId);
    animateRemovePollOption(optionId);
});

document.getElementById('addPollOptionBtn')?.addEventListener('click', () => {
    addPollOption();
});

document.getElementById('pollQuestion')?.addEventListener('input', () => {
    updatePollFormState();
});

document.getElementById('pollEndDateToggle')?.addEventListener('change', (event) => {
    const field = document.getElementById('pollEndDateField');
    const dateInput = document.getElementById('pollEndDate');
    if (!field || !dateInput) return;
    if (event.target.checked) {
        field.classList.add('is-visible');
    } else {
        field.classList.remove('is-visible');
        dateInput.value = '';
    }
});

document.getElementById('pollForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (form.dataset.submitting === 'true') return;
    const isValid = validatePollForm(true);
    if (!isValid) return;
    form.dataset.submitting = 'true';
    const createBtn = document.getElementById('pollCreateBtn');
    if (createBtn) {
        createBtn.dataset.originalText = createBtn.innerHTML;
        createBtn.innerHTML = 'Creating...';
        createBtn.disabled = true;
    }
    const question = document.getElementById('pollQuestion').value?.trim();
    const options = getFilledPollOptions();
    const endDateToggle = document.getElementById('pollEndDateToggle')?.checked;
    const endDate = endDateToggle ? (document.getElementById('pollEndDate').value || null) : null;
    try {
        const response = await fetch(`${getApiUrl()}/owner/polls`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ question, options, endDate })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Poll created!', 'success');
            const successBanner = document.getElementById('pollSuccessBanner');
            if (successBanner) {
                successBanner.innerHTML = `
                    <div class="poll-success-text">Poll created successfully. Share this poll with your club members.</div>
                    <div class="poll-success-meta">
                        <span class="poll-status poll-status--active">Active</span>
                        <span class="poll-chip"><i class="fa-solid fa-chart-simple"></i> 0 votes</span>
                    </div>`;
                successBanner.classList.add('show');
            }
            document.getElementById('pollForm').reset();
            pollOptionsState.splice(0, pollOptionsState.length, { id: 1, value: '' }, { id: 2, value: '' }, { id: 3, value: '' });
            const endDateField = document.getElementById('pollEndDateField');
            if (endDateField) endDateField.classList.remove('is-visible');
            renderPollOptions();
            loadPolls();
        } else {
            showNotification(data.message || 'Failed to create poll', 'error');
        }
    } catch (error) {
        console.error('Error creating poll:', error);
        showNotification('Failed to create poll', 'error');
    } finally {
        form.dataset.submitting = 'false';
        if (createBtn && createBtn.dataset.originalText) {
            createBtn.innerHTML = createBtn.dataset.originalText;
            delete createBtn.dataset.originalText;
        }
        updatePollFormState();
    }
});

renderPollOptions();

async function loadOwnerCertificates() {
    const grid = document.getElementById('ownerCertificatesGrid');
    if (!grid) return;
    grid.innerHTML = '<p class="loading">Loading certificates...</p>';
    try {
        const response = await fetch(`${getApiUrl()}/owner/certificates`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) {
            grid.innerHTML = '<p class="loading">Failed to load certificates.</p>';
            return;
        }
        const certificates = data.certificates || [];
        if (!certificates.length) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-certificate"></i>
                    <p>No certificates uploaded yet</p>
                </div>
            `;
            return;
        }
        grid.innerHTML = certificates.map(cert => {
            const title = escapeHtml(cert.title || 'Certificate');
            const memberName = escapeHtml(cert.member?.username || 'Member');
            const eventTitle = cert.event?.title ? escapeHtml(cert.event.title) : '';
            const description = cert.description ? escapeHtml(cert.description) : '';
            const uploadedAt = new Date(cert.uploadedAt).toLocaleDateString();
            const issueDate = cert.issueDate ? new Date(cert.issueDate).toLocaleDateString() : '';
            const fileType = (cert.fileType || '').toLowerCase();
            return `
                <div class="certificate-card" data-title="${title}" data-file="${cert.filepath}" data-type="${fileType}">
                    <button class="certificate-delete-btn" data-cert-id="${cert.id}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                    <div class="certificate-preview">
                        ${fileType === 'pdf'
                    ? `<i class="fa-solid fa-file-pdf"></i>`
                    : `<img src="${cert.filepath}" alt="${title}">`
                }
                    </div>
                    <div class="certificate-info">
                        <h3>${title}</h3>
                        <div class="certificate-meta">
                            <span><i class="fa-solid fa-user"></i> ${memberName}</span>
                            ${eventTitle ? `<span><i class="fa-solid fa-calendar"></i> ${eventTitle}</span>` : ''}
                            ${issueDate ? `<span><i class="fa-solid fa-calendar-day"></i> Issued: ${issueDate}</span>` : ''}
                        </div>
                        ${description ? `<p class="cert-description">${description}</p>` : ''}
                        <div class="certificate-footer">
                            <span>Uploaded ${uploadedAt}</span>
                            <span>Tap to view</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        grid.querySelectorAll('.certificate-card').forEach(card => {
            card.addEventListener('click', () => {
                const fileUrl = card.getAttribute('data-file') || '';
                if (fileUrl) window.open(fileUrl, '_blank', 'noopener');
            });
        });
        grid.querySelectorAll('.certificate-delete-btn').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const certId = btn.getAttribute('data-cert-id');
                if (certId) deleteOwnerCertificate(certId);
            });
        });
    } catch (error) {
        console.error('Error loading certificates:', error);
        grid.innerHTML = '<p class="loading">Failed to load certificates.</p>';
        showNotification('Failed to load certificates', 'error');
    }
}

async function deleteOwnerCertificate(certId) {
    if (!confirm('Delete this certificate?')) return;
    try {
        const response = await fetch(`${getApiUrl()}/owner/certificates/${certId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Certificate deleted!', 'success');
            loadOwnerCertificates();
        } else {
            showNotification(data.message || 'Failed to delete certificate', 'error');
        }
    } catch (error) {
        console.error('Error deleting certificate:', error);
        showNotification('Failed to delete certificate', 'error');
    }
}

// ========== PROJECT PROGRESS ==========
async function loadProjectProgress() {
    const grid = document.getElementById('projectProgressMembersGrid');
    const banner = document.getElementById('projectProgressBanner');
    if (!grid) return;
    grid.innerHTML = '<p class="loading">Loading...</p>';
    try {
        const response = await fetch(`${getApiUrl()}/owner/project-progress`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        if (!data.success) {
            grid.innerHTML = '<p class="loading">Failed to load.</p>';
            return;
        }
        const club = data.club || {};
        const summary = data.summary || {};
        const members = data.members || [];
        document.getElementById('projectProgressClubName').textContent = club.name || 'Club';
        document.getElementById('projectProgressClubDesc').textContent = club.tagline || club.description || '';
        document.getElementById('projectProgressMembersPill').innerHTML = '<i class="fa-solid fa-users"></i> ' + (summary.totalMembers || 0) + ' Members';
        const ideasResp = await fetch(`${getApiUrl()}/owner/project-ideas`, { headers: { 'Authorization': `Bearer ${token}` } });
        const ideasData = await ideasResp.json();
        const ideasCount = ideasData.projectIdeas ? ideasData.projectIdeas.length : 0;
        document.getElementById('projectProgressIdeasPill').innerHTML = '<i class="fa-solid fa-lightbulb"></i> ' + ideasCount + ' Projects';
        document.getElementById('metricTotalMembers').textContent = summary.totalMembers || 0;
        document.getElementById('metricCompleted').textContent = summary.completed || 0;
        document.getElementById('metricInProgress').textContent = summary.inProgress || 0;
        document.getElementById('metricAvgProgress').textContent = (summary.avgProgress || 0) + '%';
        const pending = summary.pendingApproval || 0;
        const pendingBadge = document.getElementById('projectProgressPendingBadge');
        if (pending > 0) {
            pendingBadge.style.display = 'inline-flex';
            document.getElementById('pendingCount').textContent = pending;
        } else pendingBadge.style.display = 'none';
        if (members.length === 0) {
            grid.innerHTML = '<p class="loading">No members yet.</p>';
        } else {
            grid.innerHTML = members.map(m => {
                const mp = m.memberProject;
                const title = mp ? (mp.projectTitle || 'No project') : 'No project chosen';
                const desc = mp ? (mp.projectDescription || '') : '';
                const status = mp ? mp.status : 'not_started';
                const pct = mp ? (mp.progressPercent || 0) : 0;
                const approvalStatus = mp ? mp.approvalStatus : null;
                const changeCount = mp ? (mp.changeCount || 0) : 0;
                const startedAt = mp && mp.startedAt ? new Date(mp.startedAt).toLocaleDateString() : '-';
                let statusBadge = '<span style="background:#9ca3af;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;">Not Started</span>';
                if (status === 'in_progress') statusBadge = '<span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;">In Progress</span>';
                else if (status === 'completed') {
                    if (approvalStatus === 'approved') statusBadge = '<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;">Completed</span>';
                    else if (approvalStatus === 'pending') statusBadge = '<span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;">Pending</span>';
                    else statusBadge = '<span style="background:#6b7280;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;">Rejected</span>';
                }
                const barColor = status === 'completed' && approvalStatus === 'approved' ? '#10b981' : (status === 'in_progress' ? '#6366f1' : '#e5e7eb');
                let approveBtns = '';
                if (status === 'completed' && approvalStatus === 'pending' && mp) {
                    approveBtns = '<div style="margin-top:8px;"><button type="button" class="btn-primary btn-sm" onclick="approveProject(' + mp.id + ', \'approved\')">Approve</button> <button type="button" class="btn-secondary btn-sm" onclick="approveProject(' + mp.id + ', \'rejected\')">Reject</button></div>';
                }
                return '<div class="project-member-card" style="background:#f9fafb;border-radius:12px;padding:16px;border:1px solid #e5e7eb;">' +
                    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
                    '<div style="width:40px;height:40px;border-radius:50%;background:#e5e7eb;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-user"></i></div>' +
                    '<div style="flex:1;"><strong>' + escapeHtml(m.username) + '</strong>' + (changeCount > 0 ? ' <span style="color:#6b7280;font-size:12px;">(' + changeCount + ' change(s))</span>' : '') + '</div>' + statusBadge + '</div>' +
                    '<div style="font-weight:600;margin-bottom:4px;">' + escapeHtml(title) + '</div>' +
                    '<div style="font-size:13px;color:#6b7280;margin-bottom:8px;">' + escapeHtml(desc).substring(0, 80) + (desc.length > 80 ? '...' : '') + '</div>' +
                    '<div style="height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-bottom:4px;"><div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:4px;"></div></div>' +
                    '<div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280;">' +
                    '<span>' + pct + '%</span><span><i class="fa-solid fa-calendar"></i> ' + startedAt + '</span></div>' + approveBtns + '</div>';
            }).join('');
        }
        loadProjectIdeasList();
    } catch (error) {
        console.error('Error loading project progress:', error);
        grid.innerHTML = '<p class="loading">Failed to load.</p>';
        showNotification('Failed to load project progress', 'error');
    }
}

async function approveProject(memberProjectId, approvalStatus) {
    try {
        const response = await fetch(`${getApiUrl()}/owner/approve-project`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ memberProjectId, approvalStatus })
        });
        const data = await response.json();
        if (data.success) {
            showNotification(approvalStatus === 'approved' ? 'Approved!' : 'Rejected.', 'success');
            loadProjectProgress();
        } else showNotification(data.message || 'Failed', 'error');
    } catch (error) {
        console.error('Error approving:', error);
        showNotification('Failed', 'error');
    }
}

async function loadProjectIdeasList() {
    const list = document.getElementById('projectIdeasList');
    if (!list) return;
    try {
        const response = await fetch(`${getApiUrl()}/owner/project-ideas`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        if (!data.success || !data.projectIdeas || data.projectIdeas.length === 0) {
            list.innerHTML = '<p style="color:#6b7280;">No project ideas yet. Add one above.</p>';
            return;
        }
        list.innerHTML = data.projectIdeas.map(idea => '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;">' +
            '<div><strong>' + escapeHtml(idea.title) + '</strong>' + (idea.description ? '<br><span style="font-size:13px;color:#6b7280;">' + escapeHtml(idea.description).substring(0, 60) + '...</span>' : '') + '</div>' +
            '<button type="button" class="btn-secondary btn-sm" onclick="deleteProjectIdea(' + idea.id + ')"><i class="fa-solid fa-trash"></i></button></div>').join('');
    } catch (e) {
        list.innerHTML = '<p class="loading">Failed to load.</p>';
    }
}

let projectIdeaSubmitting = false;
function showAddProjectIdeaForm() {
    if (projectIdeaSubmitting) return;
    const title = prompt('Project idea title:');
    if (title == null || !title.trim()) return;
    const description = prompt('Short description (optional):') || '';
    projectIdeaSubmitting = true;
    (async () => {
        try {
            const response = await fetch(`${getApiUrl()}/owner/project-ideas`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title.trim(), description: description.trim() })
            });
            const data = await response.json();
            if (data.success) {
                showNotification('Project idea added!', 'success');
                loadProjectProgress();
            } else showNotification(data.message || 'Failed', 'error');
        } catch (e) {
            showNotification('Failed to add', 'error');
        } finally {
            projectIdeaSubmitting = false;
        }
    })();
}

async function deleteProjectIdea(id) {
    if (!confirm('Delete this project idea? Members who chose it will keep their snapshot.')) return;
    try {
        const response = await fetch(`${getApiUrl()}/owner/project-ideas/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        if (data.success) {
            showNotification('Deleted!', 'success');
            loadProjectProgress();
        } else showNotification(data.message || 'Cannot delete (in use?)', 'error');
    } catch (e) {
        showNotification('Failed', 'error');
    }
}

// Load Advanced Analytics
async function loadAdvancedAnalytics() {
    const period = document.getElementById('analyticsPeriod')?.value || '30';
    const content = document.getElementById('analyticsContent');

    try {
        showLoading('analyticsContent');

        const response = await fetch(`${getApiUrl()}/owner/advanced-analytics?period=${period}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const analytics = data.analytics;

            content.innerHTML = `
                <!-- Summary Cards -->
                <div class="modern-stats-grid" style="margin-bottom: 30px;">
                    <div class="modern-stat-card gradient-blue">
                        <div class="stat-card-top">
                            <div class="stat-icon-modern">
                                <i class="fa-solid fa-users"></i>
                            </div>
                            <span class="stat-label">Total Members</span>
                        </div>
                        <div class="stat-value">${analytics.summary.totalMembers}</div>
                    </div>
                    <div class="modern-stat-card gradient-green">
                        <div class="stat-card-top">
                            <div class="stat-icon-modern">
                                <i class="fa-solid fa-calendar-check"></i>
                            </div>
                            <span class="stat-label">Events</span>
                        </div>
                        <div class="stat-value">${analytics.summary.totalEvents}</div>
                    </div>
                    <div class="modern-stat-card gradient-purple">
                        <div class="stat-card-top">
                            <div class="stat-icon-modern">
                                <i class="fa-solid fa-chart-line"></i>
                            </div>
                            <span class="stat-label">Avg Participation</span>
                        </div>
                        <div class="stat-value">${analytics.summary.avgParticipationRate}%</div>
                    </div>
                    <div class="modern-stat-card gradient-orange">
                        <div class="stat-card-top">
                            <div class="stat-icon-modern">
                                <i class="fa-solid fa-trophy"></i>
                            </div>
                            <span class="stat-label">Avg Points</span>
                        </div>
                        <div class="stat-value">${analytics.summary.avgPoints}</div>
                    </div>
                </div>

                <!-- Member Growth Chart -->
                <div class="analytics-chart-container">
                    <h3>Member Growth Over Time</h3>
                    <canvas id="memberGrowthChart"></canvas>
                </div>

                <!-- Participation Trends -->
                <div class="analytics-chart-container">
                    <h3>Event Participation Trends</h3>
                    <canvas id="participationChart"></canvas>
                </div>

                <!-- Points Distribution -->
                <div class="analytics-chart-container">
                    <h3>Points Distribution</h3>
                    <canvas id="pointsDistributionChart"></canvas>
                </div>

                <!-- Top Engaged Members -->
                <div class="analytics-chart-container">
                    <h3>Top Engaged Members</h3>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Member</th>
                                <th>Engagement Score</th>
                                <th>Attendance Rate</th>
                                <th>Points</th>
                                <th>Badges</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${analytics.engagementScores.slice(0, 10).map((member, index) => `
                                <tr>
                                    <td>#${index + 1}</td>
                                    <td>${member.username}</td>
                                    <td><strong>${member.score}</strong></td>
                                    <td>${member.attendanceRate}%</td>
                                    <td>${member.points}</td>
                                    <td>${member.badges}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            // Create charts
            createMemberGrowthChart(analytics.memberGrowth);
            createParticipationChart(analytics.participationTrends);
            createPointsDistributionChart(analytics.pointsDistribution);
        }
    } catch (error) {
        console.error('Error loading analytics:', error);
        showNotification('Failed to load analytics', 'error');
        content.innerHTML = '<p class="loading">Error loading analytics</p>';
    }
}

function createMemberGrowthChart(data) {
    const ctx = document.getElementById('memberGrowthChart').getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.date),
            datasets: [{
                label: 'Members',
                data: data.map(d => d.count),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function createParticipationChart(data) {
    const ctx = document.getElementById('participationChart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.eventTitle),
            datasets: [{
                label: 'Participation Rate %',
                data: data.map(d => d.participationRate),
                backgroundColor: '#10b981',
                borderColor: '#059669'
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

function createPointsDistributionChart(data) {
    const ctx = document.getElementById('pointsDistributionChart').getContext('2d');
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.ranges.map(r => r.label),
            datasets: [{
                data: data.ranges.map(r => r.count),
                backgroundColor: ['#e5e7eb', '#fde68a', '#fbbf24', '#f59e0b', '#8b5cf6']
            }]
        },
        options: {
            responsive: true
        }
    });
}

// Load Settings
async function loadSettings() {
    try {
        // Get club data directly
        const response = await fetch(`${getApiUrl()}/owner/dashboard-stats`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success && data.stats) {
            const stats = data.stats;
            const clubNameEl = document.getElementById('settingsClubName');
            const taglineEl = document.getElementById('settingsTagline');
            const themeColorEl = document.getElementById('settingsThemeColor');

            if (clubNameEl) clubNameEl.value = stats.clubName || '';
            if (taglineEl) taglineEl.value = stats.clubTagline || '';
            if (themeColorEl) themeColorEl.value = stats.themeColor || '#3b82f6';
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showNotification('Failed to load settings', 'error');
    }
}

// Update Settings - Fix form submission
const settingsForm = document.getElementById('settingsForm');
if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('settingsClubName')?.value?.trim();
        const tagline = document.getElementById('settingsTagline')?.value?.trim();
        const themeColor = document.getElementById('settingsThemeColor')?.value || '#3b82f6';

        if (!name) {
            showNotification('Club name is required!', 'error');
            return;
        }

        try {
            const response = await fetch(`${getApiUrl()}/owner/update-club`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, tagline, themeColor })
            });

            const data = await response.json();

            if (data.success) {
                showNotification('Settings updated successfully!', 'success');
                // Update navbar club name
                const clubNameEl = document.getElementById('clubName');
                if (clubNameEl) {
                    clubNameEl.textContent = name;
                }
                // Reload dashboard stats
                setTimeout(() => {
                    loadDashboardStats();
                }, 500);
            } else {
                showNotification(data.message || 'Failed to update settings', 'error');
            }
        } catch (error) {
            console.error('Error updating settings:', error);
            showNotification('Failed to update settings. Please check backend server.', 'error');
        }
    });
} else {
    // Form might not exist yet, add listener when settings page loads
    console.warn('Settings form not found, will add listener when page loads');
}

// Notification System
function showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';

    notification.innerHTML = `
        <i class="fa-solid fa-${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 4000);
}

// Show Gallery Upload Modal with existing photos
async function showGalleryUpload(eventId, eventTitle) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'galleryUploadModal';
    modal.innerHTML = `
        <div class="modal-content modal-lg">
            <div class="modal-header">
                <h3><i class="fa-solid fa-images" style="margin-right: 8px;"></i>Gallery - ${eventTitle}</h3>
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <!-- Upload Section -->
                <div class="gallery-upload-section" style="padding: 20px; background: linear-gradient(135deg, #f0f4ff 0%, #f5f3ff 100%); border-radius: 12px; margin-bottom: 24px; border: 2px dashed #8b5cf6;">
                    <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 200px;">
                            <label for="galleryPhotos" class="btn-secondary" style="cursor: pointer; display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px;">
                                <i class="fa-solid fa-folder-open"></i> Choose Files
                            </label>
                            <input type="file" id="galleryPhotos" accept="image/*,video/*" multiple style="display: none;">
                            <span id="selectedFilesText" style="margin-left: 12px; color: #6b7280; font-size: 14px;">No files selected</span>
                        </div>
                        <button type="button" onclick="uploadGalleryPhotos(${eventId})" class="btn-primary" style="display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-cloud-upload-alt"></i> Upload
                        </button>
                    </div>
                </div>

                <!-- Gallery Section -->
                <div class="gallery-display-section">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <h4 style="margin: 0; color: #1f2937; font-size: 16px;">
                            <i class="fa-solid fa-photo-film" style="margin-right: 8px; color: #8b5cf6;"></i>Uploaded Photos
                        </h4>
                        <span id="galleryPhotoCount" style="background: #8b5cf6; color: white; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600;">
                            Loading...
                        </span>
                    </div>
                    <div id="galleryPhotosGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; max-height: 400px; overflow-y: auto; padding: 4px;">
                        <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px;">
                            <div class="spinner" style="margin: 0 auto 16px;"></div>
                            <p style="color: #9ca3af; margin: 0;">Loading gallery...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Add file input change listener to show selected files count
    const fileInput = document.getElementById('galleryPhotos');
    const selectedFilesText = document.getElementById('selectedFilesText');
    if (fileInput && selectedFilesText) {
        fileInput.addEventListener('change', () => {
            const count = fileInput.files.length;
            if (count === 0) {
                selectedFilesText.textContent = 'No files selected';
                selectedFilesText.style.color = '#6b7280';
            } else {
                selectedFilesText.textContent = `${count} file${count > 1 ? 's' : ''} selected`;
                selectedFilesText.style.color = '#10b981';
            }
        });
    }

    // Load existing photos
    await loadGalleryPhotos(eventId);
}

// Load gallery photos for the modal
async function loadGalleryPhotos(eventId) {
    const grid = document.getElementById('galleryPhotosGrid');
    const countEl = document.getElementById('galleryPhotoCount');

    if (!grid) return;

    try {
        const response = await fetch(`${getApiUrl()}/gallery/${eventId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success && data.photos && data.photos.length > 0) {
            // Update count
            if (countEl) {
                countEl.textContent = `${data.photos.length} File${data.photos.length > 1 ? 's' : ''}`;
            }

            // Render photos and videos
            grid.innerHTML = data.photos.map(photo => {
                const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(photo.filename);
                const deleteBtn = `
                    <button onclick="event.stopPropagation(); deleteGalleryPhoto(${photo.id}, ${photo.eventId})" 
                            style="position: absolute; top: 8px; left: 8px; width: 28px; height: 28px; border-radius: 50%; background: rgba(239, 68, 68, 0.9); border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; transition: all 0.2s; z-index: 10;"
                            onmouseover="this.style.background='#dc2626'; this.style.transform='scale(1.1)'"
                            onmouseout="this.style.background='rgba(239, 68, 68, 0.9)'; this.style.transform='scale(1)'"
                            title="Delete">
                        <i class="fa-solid fa-times"></i>
                    </button>
                `;

                if (isVideo) {
                    return `
                        <div class="gallery-photo-item" data-photo-id="${photo.id}" data-event-id="${photo.eventId}" style="position: relative; border-radius: 12px; overflow: hidden; aspect-ratio: 1; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; background: #000;" 
                             onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 4px 16px rgba(0,0,0,0.15)';"
                             onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)';"
                             onclick="openGalleryLightbox('${photo.fullUrl}', true, ${photo.id}, ${photo.eventId})">
                            ${deleteBtn}
                            <video src="${photo.fullUrl}" style="width: 100%; height: 100%; object-fit: cover;" muted></video>
                            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 50px; height: 50px; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                                <i class="fa-solid fa-play" style="color: white; font-size: 20px; margin-left: 3px;"></i>
                            </div>
                            <div style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.7); color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px;">
                                <i class="fa-solid fa-video"></i> VIDEO
                            </div>
                        </div>
                    `;
                } else {
                    return `
                        <div class="gallery-photo-item" data-photo-id="${photo.id}" data-event-id="${photo.eventId}" style="position: relative; border-radius: 12px; overflow: hidden; aspect-ratio: 1; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transition: transform 0.2s, box-shadow 0.2s; cursor: pointer;" 
                             onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 4px 16px rgba(0,0,0,0.15)';"
                             onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)';"
                             onclick="openGalleryLightbox('${photo.fullUrl}', false, ${photo.id}, ${photo.eventId})">
                            ${deleteBtn}
                            <img src="${photo.fullUrl}" alt="Gallery photo" 
                                 style="width: 100%; height: 100%; object-fit: cover;"
                                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23e5e7eb%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 font-size=%2214%22 fill=%22%239ca3af%22 text-anchor=%22middle%22>No Image</text></svg>'">
                        </div>
                    `;
                }
            }).join('');

            // Add hover effects for overlays
            grid.querySelectorAll('.gallery-photo-item').forEach(item => {
                const overlay = item.querySelector('.photo-overlay');
                if (overlay) {
                    item.addEventListener('mouseover', () => overlay.style.opacity = '1');
                    item.addEventListener('mouseout', () => overlay.style.opacity = '0');
                }
            });
        } else {
            // Empty state
            if (countEl) {
                countEl.textContent = '0 Files';
                countEl.style.background = '#9ca3af';
            }

            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%); border-radius: 12px; border: 2px dashed #e5e7eb;">
                    <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: linear-gradient(135deg, #e5e7eb 0%, #d1d5db 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                        <i class="fa-solid fa-photo-film" style="font-size: 32px; color: #9ca3af;"></i>
                    </div>
                    <h4 style="margin: 0 0 8px; color: #6b7280; font-size: 16px; font-weight: 600;">No Media Yet</h4>
                    <p style="margin: 0; color: #9ca3af; font-size: 14px;">Upload photos or videos to see them here</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading gallery photos:', error);
        if (countEl) {
            countEl.textContent = 'Error';
            countEl.style.background = '#ef4444';
        }
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: #ef4444;">
                <i class="fa-solid fa-exclamation-triangle" style="font-size: 32px; margin-bottom: 12px;"></i>
                <p style="margin: 0;">Failed to load gallery. Please try again.</p>
            </div>
        `;
    }
}

// Gallery lightbox state
let galleryLightboxItems = [];
let galleryLightboxIndex = 0;

// Open lightbox for gallery photos/videos with navigation
function openGalleryLightbox(url, isVideo = false) {
    // Get all media from the gallery grid
    const grid = document.getElementById('galleryPhotosGrid');
    if (grid) {
        const items = Array.from(grid.querySelectorAll('.gallery-photo-item')).map(item => {
            const video = item.querySelector('video');
            const img = item.querySelector('img');
            const id = item.dataset.photoId;
            const eventId = item.dataset.eventId;

            if (video) {
                return { url: video.src, isVideo: true, id, eventId };
            } else if (img) {
                return { url: img.src, isVideo: false, id, eventId };
            }
            return null;
        }).filter(Boolean);

        if (items.length > 0) {
            galleryLightboxItems = items;
            galleryLightboxIndex = items.findIndex(item => item.url === url);
            if (galleryLightboxIndex === -1) galleryLightboxIndex = 0;
        } else {
            // Fallback if grid parsing fails (shouldn't happen with correct usage)
            galleryLightboxItems = [{ url, isVideo, id: null, eventId: null }];
            galleryLightboxIndex = 0;
        }
    } else {
        galleryLightboxItems = [{ url, isVideo, id: null, eventId: null }];
        galleryLightboxIndex = 0;
    }

    renderLightbox();
}

// Render lightbox content
function renderLightbox() {
    // Remove existing lightbox if any
    const existingLightbox = document.getElementById('galleryLightbox');
    if (existingLightbox) existingLightbox.remove();

    const currentItem = galleryLightboxItems[galleryLightboxIndex];
    const showNavButtons = galleryLightboxItems.length > 1;

    const lightbox = document.createElement('div');
    lightbox.id = 'galleryLightbox';
    lightbox.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.95);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const mediaContent = currentItem.isVideo
        ? `<video id="lightboxMedia" src="${currentItem.url}" controls autoplay style="max-width: 100%; max-height: calc(100vh - 150px); border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);"></video>`
        : `<img id="lightboxMedia" src="${currentItem.url}" style="max-width: 100%; max-height: calc(100vh - 150px); object-fit: contain; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">`;

    // Add delete button ONLY if we have an ID
    const deleteButtonHtml = currentItem.id ? `
        <button onclick="closeLightbox(); deleteGalleryPhoto(${currentItem.id}, ${currentItem.eventId})" 
                style="position: absolute; top: 20px; left: 20px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); color: #fca5a5; padding: 10px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; transition: all 0.2s; z-index: 10001; display: flex; align-items: center; gap: 8px;"
                onmouseover="this.style.background='rgba(239, 68, 68, 0.8)'; this.style.color='white'" 
                onmouseout="this.style.background='rgba(239, 68, 68, 0.2)'; this.style.color='#fca5a5'">
            <i class="fa-solid fa-trash"></i> Delete
        </button>
    ` : '';

    lightbox.innerHTML = `
        ${deleteButtonHtml}

        <button id="lightboxClose" style="position: absolute; top: 20px; right: 20px; background: rgba(255,255,255,0.15); border: none; color: white; width: 50px; height: 50px; border-radius: 50%; font-size: 24px; cursor: pointer; transition: all 0.2s; z-index: 10001;"
                onmouseover="this.style.background='rgba(255,255,255,0.3)'" 
                onmouseout="this.style.background='rgba(255,255,255,0.15)'">
            <i class="fa-solid fa-times"></i>
        </button>

        ${showNavButtons ? `
        <button id="lightboxPrev" style="position: absolute; left: 20px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.15); border: none; color: white; width: 60px; height: 60px; border-radius: 50%; font-size: 28px; cursor: pointer; transition: all 0.2s; z-index: 10001;"
                onmouseover="this.style.background='rgba(255,255,255,0.3)'; this.style.transform='translateY(-50%) scale(1.1)'" 
                onmouseout="this.style.background='rgba(255,255,255,0.15)'; this.style.transform='translateY(-50%) scale(1)'">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
        ` : ''}

        ${showNavButtons ? `
        <button id="lightboxNext" style="position: absolute; right: 20px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.15); border: none; color: white; width: 60px; height: 60px; border-radius: 50%; font-size: 28px; cursor: pointer; transition: all 0.2s; z-index: 10001;"
                onmouseover="this.style.background='rgba(255,255,255,0.3)'; this.style.transform='translateY(-50%) scale(1.1)'" 
                onmouseout="this.style.background='rgba(255,255,255,0.15)'; this.style.transform='translateY(-50%) scale(1)'">
            <i class="fa-solid fa-chevron-right"></i>
        </button>
        ` : ''}

        <div style="display: flex; flex-direction: column; align-items: center; max-width: 85%; max-height: 85%;">
            ${mediaContent}
            ${showNavButtons ? `
            <div id="lightboxCounter" style="margin-top: 16px; color: rgba(255,255,255,0.8); font-size: 14px; font-weight: 500; background: rgba(0,0,0,0.5); padding: 6px 16px; border-radius: 20px;">
                ${galleryLightboxIndex + 1} / ${galleryLightboxItems.length}
            </div>
            ` : ''}
        </div>
    `;

    document.body.appendChild(lightbox);

    // Close button handler
    document.getElementById('lightboxClose').addEventListener('click', closeLightbox);

    // Previous button handler
    const prevBtn = document.getElementById('lightboxPrev');
    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateLightbox(-1);
        });
    }

    // Next button handler
    const nextBtn = document.getElementById('lightboxNext');
    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateLightbox(1);
        });
    }

    // Click on background to close
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });

    // Keyboard navigation
    document.removeEventListener('keydown', handleLightboxKeydown);
    document.addEventListener('keydown', handleLightboxKeydown);
}

// Navigate lightbox items
function navigateLightbox(direction) {
    if (galleryLightboxItems.length <= 1) return;

    // Pause current video if any
    const currentMedia = document.getElementById('lightboxMedia');
    if (currentMedia && currentMedia.tagName === 'VIDEO') {
        currentMedia.pause();
    }

    galleryLightboxIndex = (galleryLightboxIndex + direction + galleryLightboxItems.length) % galleryLightboxItems.length;
    renderLightbox();
}

// Close lightbox
function closeLightbox() {
    const lightbox = document.getElementById('galleryLightbox');
    if (lightbox) {
        // Pause video if playing
        const video = lightbox.querySelector('video');
        if (video) video.pause();
        lightbox.remove();
    }
    document.removeEventListener('keydown', handleLightboxKeydown);
    galleryLightboxItems = [];
    galleryLightboxIndex = 0;
}

// Keyboard handler for lightbox
function handleLightboxKeydown(e) {
    switch (e.key) {
        case 'Escape':
            closeLightbox();
            break;
        case 'ArrowLeft':
            navigateLightbox(-1);
            break;
        case 'ArrowRight':
            navigateLightbox(1);
            break;
    }
}

// Delete gallery photo
async function deleteGalleryPhoto(photoId, eventId) {
    if (!confirm('Are you sure you want to delete this photo?')) {
        return;
    }

    try {
        const response = await fetch(`${getApiUrl()}/owner/gallery/${photoId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Photo deleted successfully!', 'success');
            // Refresh gallery
            await loadGalleryPhotos(eventId);
        } else {
            showNotification(data.message || 'Failed to delete photo', 'error');
        }
    } catch (error) {
        console.error('Error deleting photo:', error);
        showNotification('Failed to delete photo', 'error');
    }
}

// Upload Gallery Photos
async function uploadGalleryPhotos(eventId) {
    const fileInput = document.getElementById('galleryPhotos');
    const files = fileInput.files;

    if (files.length === 0) {
        showNotification('Please select photos to upload', 'error');
        return;
    }

    // Show loading state on button
    const uploadBtn = document.querySelector('#galleryUploadModal .btn-primary');
    const originalBtnText = uploadBtn ? uploadBtn.innerHTML : '';
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
    }

    const formData = new FormData();
    formData.append('eventId', eventId);

    for (let i = 0; i < files.length; i++) {
        formData.append('photos', files[i]);
    }

    try {
        const response = await fetch(`${getApiUrl()}/owner/upload-gallery`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');

            // Clear file input and reset text
            fileInput.value = '';
            const selectedFilesText = document.getElementById('selectedFilesText');
            if (selectedFilesText) {
                selectedFilesText.textContent = 'No files selected';
                selectedFilesText.style.color = '#6b7280';
            }

            // Refresh gallery to show new photos
            await loadGalleryPhotos(eventId);
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error uploading photos:', error);
        showNotification('Failed to upload photos', 'error');
    } finally {
        // Restore button state
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = originalBtnText || '<i class="fa-solid fa-cloud-upload-alt"></i> Upload Photos';
        }
    }
}

// Show Add Member Modal (scrolls to add member section) - Not needed anymore, but keeping for compatibility
function showAddMemberModal() {
    switchPage('members');
    setTimeout(() => {
        const input = document.getElementById('quickAddStudentId');
        if (input) {
            input.focus();
        }
    }, 300);
}

// Add Member by Student ID
async function addMemberByStudentId() {
    const inputElement = document.getElementById('quickAddStudentId');
    if (!inputElement) {
        showNotification('Error: Input field not found', 'error');
        return;
    }

    const studentId = inputElement.value.trim();

    if (!studentId) {
        showNotification('Please enter a Student ID', 'error');
        inputElement.focus();
        return;
    }

    // Show loading state
    const addButton = document.querySelector('button[onclick*="addMemberByStudentId"]');
    const originalText = addButton?.innerHTML || '';
    if (addButton) {
        addButton.disabled = true;
        addButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding...';
    }

    try {
        const response = await fetch(`${getApiUrl()}/owner/add-member`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ studentId })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message || 'Member added successfully!', 'success');
            inputElement.value = '';
            // Reload members list
            setTimeout(() => {
                loadMembers();
                loadDashboardStats();
            }, 500);
        } else {
            showNotification(data.message || 'Failed to add member', 'error');
        }
    } catch (error) {
        console.error('Error adding member:', error);
        showNotification('Failed to add member. Please check if backend server is running.', 'error');
    } finally {
        // Restore button state
        if (addButton) {
            addButton.disabled = false;
            addButton.innerHTML = originalText || '<i class="fa-solid fa-plus"></i> Add Member';
        }
    }
}

// IMMEDIATELY expose addMemberByStudentId to window
window.addMemberByStudentId = addMemberByStudentId;
console.log('✅ addMemberByStudentId exposed to window immediately');

// Initialize - Ensure DOM is loaded
console.log('✅ Owner dashboard script loaded!');
console.log('📋 Document ready state:', document.readyState);
console.log('🔑 Token exists:', !!token);

// Always try to initialize
function initializeDashboard() {
    try {
        if (window.__ownerDashboardInitialized) return;
        window.__ownerDashboardInitialized = true;
        console.log('🚀 Initializing dashboard...');
        initOwnerChecklist();
        verifyAuth();
    } catch (error) {
        console.error('❌ Error initializing dashboard:', error);
        alert('Error loading dashboard: ' + error.message + '\n\nCheck console (F12) for details.');
    }
}

if (document.readyState === 'loading') {
    console.log('⏳ Waiting for DOM to load...');
    document.addEventListener('DOMContentLoaded', initializeDashboard, { once: true });
} else {
    console.log('✅ DOM already loaded, initializing now...');
    initializeDashboard();
}

// ========== SOCKET.IO ==========
function initSocketIO() {
    socket = io(getApiUrl(), {
        auth: {
            token: token
        },
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 20000
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        if (currentUserId) {
            socket.emit('join-user', currentUserId);
        }
        if (currentClubId) {
            socket.emit('join-club', currentClubId);
        }
    });

    socket.on('new-notification', (notification) => {
        updateNotificationBadge();
        if (notification.userId === currentUserId) {
            showNotification(notification.title + ': ' + notification.message, 'info');
        }
    });

    socket.on('new-message', (message) => {
        if (message.recipientId === currentUserId) {
            updateMessageBadge();
            if (currentChatRecipientId === message.senderId) {
                loadChatMessages(message.senderId);
            }
        }
    });

    socket.on('attendance-updated', (data) => {
        if (document.getElementById('attendanceContent')) {
            loadAttendanceData(data.eventId);
        }
    });

    bindWorkshopSocketHandlers();
}

// Tooltips are initialized via utils.js

// ========== MEMBER SEARCH ==========
let searchTimeout = null;

// Store loaded members for search (reuse global window.allLoadedMembers)
async function searchMembers() {
    const query = document.getElementById('memberSearchInput').value.trim().toLowerCase();
    const resultsDiv = document.getElementById('searchResults');

    if (query.length < 1) {
        resultsDiv.innerHTML = '';
        loadMembers(); // Reload all members
        return;
    }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            // Always reload members to ensure we have current club's members
            // This ensures club-specific search
            const response = await fetch(`${getApiUrl()}/owner/members`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();

            if (data.success) {
                // Store current club's members only
                window.allLoadedMembers = data.members || [];
                console.log(`🔍 Searching in ${window.allLoadedMembers.length} members of current club`);
            } else {
                window.allLoadedMembers = [];
            }

            // Search ONLY in current club's members
            const filteredMembers = (window.allLoadedMembers || []).filter(member => {
                const username = (member.username || '').toLowerCase();
                const email = (member.email || '').toLowerCase();
                const studentId = (member.studentId || '').toLowerCase();
                return username.includes(query) || email.includes(query) || studentId.includes(query);
            });

            if (filteredMembers.length === 0) {
                resultsDiv.innerHTML = '<p style="color: #6b7280; padding: 10px;">No members found</p>';
                return;
            }

            resultsDiv.innerHTML = `
                <div style="background: #f9fafb; padding: 15px; border-radius: 8px;">
                    <p style="margin: 0 0 10px 0; font-weight: 600; color: #374151;">Search Results (${filteredMembers.length})</p>
                    ${filteredMembers.map(member => `
                        <div class="search-result-item" onclick="selectMemberFromSearch(${member.id})" style="cursor: pointer; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 8px; transition: all 0.2s;" onmouseover="this.style.background='#eff6ff'; this.style.borderColor='#3b82f6';" onmouseout="this.style.background=''; this.style.borderColor='#e5e7eb';">
                            <strong>${member.username || 'N/A'}</strong> - ${member.email || 'N/A'} (${member.studentId || 'N/A'})
                            <span class="role-badge ${(member.clubRole || 'member').toLowerCase()}" style="float: right;">
                                ${(member.clubRole || 'member').toUpperCase()}
                            </span>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (error) {
            console.error('Error searching members:', error);
            resultsDiv.innerHTML = '<p style="color: #ef4444; padding: 10px;">Error searching members</p>';
        }
    }, 300);
}

function clearSearch() {
    document.getElementById('memberSearchInput').value = '';
    document.getElementById('searchResults').innerHTML = '';
    loadMembers();
}

function selectMemberFromSearch(memberId) {
    console.log('Selecting member:', memberId);
    // Clear search
    document.getElementById('memberSearchInput').value = '';
    document.getElementById('searchResults').innerHTML = '';

    // Load members and scroll to selected member
    loadMembers().then(() => {
        setTimeout(() => {
            const row = document.querySelector(`tr[data-member-id="${memberId}"]`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.style.background = '#eff6ff';
                row.style.transition = 'background 0.3s';
                setTimeout(() => {
                    row.style.background = '';
                }, 3000);
            } else {
                console.warn('Member row not found:', memberId);
            }
        }, 500);
    });
}

// ========== ROLE ASSIGNMENT ==========
let currentRoleMemberId = null;

function openRoleModal(memberId, memberName, currentRole) {
    currentRoleMemberId = memberId;
    document.getElementById('roleMemberName').textContent = memberName;
    document.getElementById('roleSelect').value = currentRole || 'member';
    document.getElementById('roleModal').classList.add('active');
}

function closeRoleModal() {
    document.getElementById('roleModal').classList.remove('active');
    currentRoleMemberId = null;
}

async function assignRole() {
    if (!currentRoleMemberId) return;

    const role = document.getElementById('roleSelect').value;

    try {
        const response = await fetch(`${getApiUrl()}/owner/assign-role`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                memberId: currentRoleMemberId,
                clubRole: role
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            closeRoleModal();
            loadMembers();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error assigning role:', error);
        showNotification('Failed to assign role', 'error');
    }
}

// ========== ATTENDANCE TAKING ==========
let currentAttendanceEventId = null;
let selectedMembers = [];

async function openAttendanceModal(eventId) {
    currentAttendanceEventId = eventId;
    selectedMembers = [];
    document.getElementById('attendanceModal').classList.add('active');
    await loadAttendanceData(eventId);
}

function closeAttendanceModal() {
    document.getElementById('attendanceModal').classList.remove('active');
    currentAttendanceEventId = null;
    selectedMembers = [];
}

async function loadAttendanceData(eventId) {
    const content = document.getElementById('attendanceContent');

    try {
        showLoading('attendanceContent');

        const response = await fetch(`${getApiUrl()}/owner/event/${eventId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const event = data.event;
            const members = event.clubMembers || [];

            content.innerHTML = `
                <div style="margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0;">${event.title}</h3>
                    <p style="color: #6b7280; margin: 0;">${event.venue} • ${new Date(event.date).toLocaleDateString()}</p>
                </div>
                
                <div style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center;">
                    <button onclick="selectAllMembers()" class="btn-secondary">
                        <i class="fa-solid fa-check-double"></i> Select All
                    </button>
                    <button onclick="deselectAllMembers()" class="btn-secondary">
                        <i class="fa-solid fa-times"></i> Deselect All
                    </button>
                    <span style="margin-left: auto; color: #6b7280;">
                        <strong>${selectedMembers.length}</strong> selected
                    </span>
                </div>

                <div style="max-height: 400px; overflow-y: auto;">
                    ${members.map(member => `
                        <div class="attendance-member-item ${member.isPresent ? 'present' : ''}" 
                             onclick="toggleMemberSelection(${member.id})"
                             data-member-id="${member.id}">
                            <input type="checkbox" 
                                   ${member.isPresent ? 'checked disabled' : ''} 
                                   ${selectedMembers.includes(member.id) ? 'checked' : ''}
                                   onchange="toggleMemberSelection(${member.id})"
                                   onclick="event.stopPropagation()">
                            <div style="flex: 1;">
                                <button type="button" class="link-btn member-link" onclick="openMemberProfile(${member.id}); event.stopPropagation();">${member.username}</button>
                                <p style="margin: 5px 0 0 0; font-size: 13px; color: #6b7280;">
                                    ${member.email} • ${member.studentId}
                                </p>
                            </div>
                            ${member.isPresent ?
                    '<span style="color: #10b981;"><i class="fa-solid fa-check-circle"></i> Already Present</span>' :
                    '<span style="color: #6b7280;">Absent</span>'
                }
                        </div>
                    `).join('')}
                </div>

                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                    <button onclick="submitAttendance()" class="btn-primary" style="width: 100%;">
                        <i class="fa-solid fa-check"></i> Mark ${selectedMembers.length} Member(s) as Present
                    </button>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading attendance data:', error);
        showNotification('Failed to load attendance data', 'error');
        content.innerHTML = '<p class="loading">Error loading data</p>';
    }
}

function toggleMemberSelection(memberId) {
    const index = selectedMembers.indexOf(memberId);
    if (index > -1) {
        selectedMembers.splice(index, 1);
    } else {
        selectedMembers.push(memberId);
    }

    // Update UI
    const item = document.querySelector(`[data-member-id="${memberId}"]`);
    const checkbox = item?.querySelector('input[type="checkbox"]');
    if (checkbox && !checkbox.disabled) {
        checkbox.checked = selectedMembers.includes(memberId);
        item.classList.toggle('selected', selectedMembers.includes(memberId));
    }

    // Update button text
    const submitBtn = document.querySelector('#attendanceContent button.btn-primary');
    if (submitBtn) {
        submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> Mark ${selectedMembers.length} Member(s) as Present`;
    }
}

function selectAllMembers() {
    const checkboxes = document.querySelectorAll('#attendanceContent input[type="checkbox"]:not([disabled])');
    selectedMembers = [];
    checkboxes.forEach(cb => {
        const memberId = parseInt(cb.closest('[data-member-id]').getAttribute('data-member-id'));
        if (!selectedMembers.includes(memberId)) {
            selectedMembers.push(memberId);
            cb.checked = true;
            cb.closest('.attendance-member-item').classList.add('selected');
        }
    });

    const submitBtn = document.querySelector('#attendanceContent button.btn-primary');
    if (submitBtn) {
        submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> Mark ${selectedMembers.length} Member(s) as Present`;
    }
}

function deselectAllMembers() {
    selectedMembers = [];
    const checkboxes = document.querySelectorAll('#attendanceContent input[type="checkbox"]:not([disabled])');
    checkboxes.forEach(cb => {
        cb.checked = false;
        cb.closest('.attendance-member-item').classList.remove('selected');
    });

    const submitBtn = document.querySelector('#attendanceContent button.btn-primary');
    if (submitBtn) {
        submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> Mark 0 Member(s) as Present`;
    }
}

async function submitAttendance() {
    if (!currentAttendanceEventId || selectedMembers.length === 0) {
        showNotification('Please select at least one member', 'error');
        return;
    }

    try {
        const response = await fetch(`${getApiUrl()}/owner/take-attendance`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                eventId: currentAttendanceEventId,
                memberIds: selectedMembers
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            closeAttendanceModal();
            loadEvents();
            loadDashboardStats();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error taking attendance:', error);
        showNotification('Failed to mark attendance', 'error');
    }
}

// ========== NOTIFICATIONS ==========
async function loadNotifications() {
    try {
        const response = await fetch(`${getApiUrl()}/notifications`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            updateNotificationBadge(data.unreadCount);

            const list = document.getElementById('notificationsList');
            if (list) {
                if (data.notifications.length === 0) {
                    list.innerHTML = '<p class="loading">No notifications</p>';
                    return;
                }

                list.innerHTML = data.notifications.map(notif => `
                    <div class="notification-item ${!notif.read ? 'unread' : ''}" 
                         onclick="markNotificationRead(${notif.id})">
                        <div style="display: flex; justify-content: space-between; align-items: start;">
                            <div style="flex: 1;">
                                <h4 style="margin: 0 0 5px 0;">${notif.title}</h4>
                                <p style="margin: 0; color: #6b7280; font-size: 14px;">${notif.message}</p>
                                <p style="margin: 5px 0 0 0; font-size: 12px; color: #9ca3af;">
                                    ${new Date(notif.createdAt).toLocaleString()}
                                </p>
                            </div>
                            ${!notif.read ? '<span style="color: #3b82f6;"><i class="fa-solid fa-circle" style="font-size: 8px;"></i></span>' : ''}
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        if (count === undefined) {
            // Fetch count
            fetch(`${getApiUrl()}/notifications`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        badge.textContent = data.unreadCount || 0;
                        badge.style.display = (data.unreadCount || 0) > 0 ? 'inline-flex' : 'none';
                    }
                });
        } else {
            badge.textContent = count || 0;
            badge.style.display = (count || 0) > 0 ? 'inline-flex' : 'none';
        }
    }
}

function markNotificationRead(notifId) {
    fetch(`${getApiUrl()}/notifications/${notifId}/read`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
        .then(() => {
            loadNotifications();
        });
}

function markAllNotificationsRead() {
    fetch(`${getApiUrl()}/notifications/read-all`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
        .then(() => {
            loadNotifications();
        });
}

function closeNotificationsModal() {
    document.getElementById('notificationsModal').classList.remove('active');
}

// Notification bell click - Fix with proper event handling
document.addEventListener('DOMContentLoaded', () => {
    const notificationBell = document.getElementById('notificationBell');
    if (notificationBell) {
        notificationBell.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Notification bell clicked');
            const modal = document.getElementById('notificationsModal');
            if (modal) {
                modal.classList.add('active');
                loadNotifications();
            } else {
                console.error('Notifications modal not found');
            }
        });
    }
});

// Also add click handler immediately if element exists
const notificationBell = document.getElementById('notificationBell');
if (notificationBell && !notificationBell.hasAttribute('data-listener-added')) {
    notificationBell.setAttribute('data-listener-added', 'true');
    notificationBell.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const modal = document.getElementById('notificationsModal');
        if (modal) {
            modal.classList.add('active');
            loadNotifications();
        }
    });
}

// ========== MESSAGING SYSTEM (OWNER-ONLY) ==========
async function loadMessages() {
    try {
        // Use contacts API for Owner-Only Messaging
        const response = await fetch(`${getApiUrl()}/messages/contacts`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const messageList = document.getElementById('messageList');
            if (messageList) {
                if (data.contacts.length === 0) {
                    messageList.innerHTML = `
                        <div style="padding: 20px; text-align: center; color: #6b7280;">
                            <i class="fa-solid fa-users" style="font-size: 32px; margin-bottom: 10px; opacity: 0.5;"></i>
                            <p style="font-size: 14px;">No members yet</p>
                            <p style="font-size: 12px; color: #9ca3af; margin-top: 5px;">Add members to your club to start messaging</p>
                        </div>
                    `;
                    return;
                }

                messageList.innerHTML = data.contacts.map(contact => `
                    <div class="message-item ${currentChatRecipientId === contact.id ? 'active' : ''}" 
                         onclick="openChat(${contact.id}, '${contact.username}')">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #2563eb); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; flex-shrink: 0;">
                                ${contact.username.charAt(0).toUpperCase()}
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <strong style="display: block;">${contact.username}</strong>
                                ${contact.lastMessage ? `
                                    <p style="margin: 5px 0 0 0; font-size: 13px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                        ${contact.lastMessage.message.substring(0, 50)}${contact.lastMessage.message.length > 50 ? '...' : ''}
                                    </p>
                                    <p style="margin: 5px 0 0 0; font-size: 11px; color: #9ca3af;">
                                        ${new Date(contact.lastMessage.createdAt).toLocaleString()}
                                    </p>
                                ` : '<p style="margin: 5px 0 0 0; font-size: 13px; color: #9ca3af;">No messages yet</p>'}
                            </div>
                            ${contact.unreadCount > 0 ? `
                                <span style="background: #ef4444; color: white; border-radius: 50%; min-width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; padding: 0 6px;">
                                    ${contact.unreadCount}
                                </span>
                            ` : ''}
                        </div>
                    </div>
                `).join('');

                // Update message badge with total unread count
                const totalUnread = data.contacts.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
                updateMessageBadge(totalUnread);
            }
        }
    } catch (error) {
        console.error('Error loading messages:', error);
        showNotification('Failed to load messages', 'error');
    }
}

async function openChat(recipientId) {
    currentChatRecipientId = recipientId;

    // Update UI - mark active conversation
    document.querySelectorAll('.message-item').forEach(item => {
        item.classList.remove('active');
        if (item.onclick && item.onclick.toString().includes(recipientId)) {
            item.classList.add('active');
        }
    });

    // Load chat messages
    await loadChatMessages(recipientId);

    // Show chat input
    document.getElementById('chatInput').style.display = 'block';

    // Get recipient name
    const membersResponse = await fetch(`${getApiUrl()}/owner/members`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const membersData = await membersResponse.json();
    const member = membersData.success ? membersData.members.find(m => m.id === recipientId) : null;

    document.getElementById('chatHeader').innerHTML = `
        <h3 style="margin: 0;">${member ? member.username : 'Member'}</h3>
        <p style="margin: 5px 0 0 0; color: #6b7280; font-size: 14px;">${member ? member.email : ''}</p>
    `;
}

async function loadChatMessages(recipientId) {
    try {
        const response = await fetch(`${getApiUrl()}/messages?recipientId=${recipientId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const chatMessages = document.getElementById('chatMessages');
            chatMessages.innerHTML = data.messages.map(msg => `
                <div class="chat-message ${msg.senderId === currentUserId ? 'sent' : ''}">
                    <div class="chat-message-content">
                        <p style="margin: 0;">${msg.message}</p>
                        <div class="chat-message-time">
                            ${new Date(msg.createdAt).toLocaleTimeString()}
                        </div>
                    </div>
                </div>
            `).join('');

            chatMessages.scrollTop = chatMessages.scrollHeight;

            // Mark messages as read
            data.messages.forEach(msg => {
                if (msg.recipientId === currentUserId && !msg.read) {
                    fetch(`${getApiUrl()}/messages/${msg.id}/read`, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error loading chat messages:', error);
    }
}

async function sendMessage(e) {
    e.preventDefault();

    if (!currentChatRecipientId) {
        showNotification('Please select a recipient', 'error');
        return;
    }

    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();

    if (!message) return;

    try {
        const response = await fetch(`${getApiUrl()}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipientId: currentChatRecipientId,
                message: message,
                type: 'direct'
            })
        });

        const data = await response.json();

        if (data.success) {
            messageInput.value = '';
            await loadChatMessages(currentChatRecipientId);
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showNotification('Failed to send message', 'error');
    }
}

function openNewMessageModal() {
    console.log('Opening new message modal');
    const modal = document.getElementById('newMessageModal');
    if (modal) {
        modal.classList.add('active');
        loadMembersForMessage();
    } else {
        console.error('New message modal not found');
        showNotification('Error: Message modal not found', 'error');
    }
}

function closeNewMessageModal() {
    document.getElementById('newMessageModal').classList.remove('active');
    document.getElementById('newMessageForm').reset();
}

async function loadMembersForMessage() {
    try {
        const response = await fetch(`${getApiUrl()}/owner/members`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const select = document.getElementById('recipientSelect');
            select.innerHTML = '<option value="">Choose a member...</option>' +
                data.members.map(m => `<option value="${m.id}">${m.username} (${m.email})</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading members:', error);
    }
}

document.getElementById('newMessageForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const recipientId = parseInt(document.getElementById('recipientSelect').value);
    const message = document.getElementById('newMessageText').value.trim();

    if (!recipientId || !message) {
        showNotification('Please select recipient and enter message', 'error');
        return;
    }

    try {
        const response = await fetch(`${getApiUrl()}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipientId: recipientId,
                message: message,
                type: 'direct'
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Message sent successfully!', 'success');
            closeNewMessageModal();
            loadMessages();
            if (currentChatRecipientId === recipientId) {
                await loadChatMessages(recipientId);
            }
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showNotification('Failed to send message', 'error');
    }
});

// Messages icon click - Fix with proper event handling
document.addEventListener('DOMContentLoaded', () => {
    const messagesIcon = document.getElementById('messagesIcon');
    if (messagesIcon) {
        if (!messagesIcon.hasAttribute('data-listener-added')) {
            messagesIcon.setAttribute('data-listener-added', 'true');
            messagesIcon.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Messages icon clicked');
                switchPage('messages');
            });
        }
    }
});

// Also add click handler immediately if element exists
const messagesIcon = document.getElementById('messagesIcon');
if (messagesIcon && !messagesIcon.hasAttribute('data-listener-added')) {
    messagesIcon.setAttribute('data-listener-added', 'true');
    messagesIcon.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        switchPage('messages');
    });
}

function updateMessageBadge(count) {
    const badge = document.getElementById('messageBadge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

// Loading helpers are defined in utils.js

// Get club ID on dashboard load
async function getClubId() {
    try {
        const response = await fetch(`${getApiUrl()}/owner/dashboard-stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success && data.stats) {
            // Get club ID from clubs
            const clubsResponse = await fetch(`${getApiUrl()}/owner/members`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            // We'll get club ID from members or events
        }
    } catch (error) {
        console.error('Error getting club ID:', error);
    }
}

function openWorkshopCreateModal() {
    const modal = document.getElementById('workshopCreateModal');
    if (modal) modal.classList.add('active');
    const form = document.getElementById('workshopCreateForm');
    if (form && !form.hasAttribute('data-listener-added')) {
        form.setAttribute('data-listener-added', 'true');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await createWorkshop();
        });
    }
}

function closeWorkshopCreateModal() {
    const modal = document.getElementById('workshopCreateModal');
    if (modal) modal.classList.remove('active');
}

function addToolRow() {
    const container = document.getElementById('workshopToolsBuilder');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'tool-row';
    row.innerHTML = `
        <input type="text" class="tool-name" placeholder="Tool name">
        <input type="text" class="tool-version" placeholder="Version">
        <input type="url" class="tool-link" placeholder="Download link">
        <input type="text" class="tool-icon" placeholder="Icon class (optional)">
    `;
    container.appendChild(row);
}

function collectToolRows() {
    const rows = document.querySelectorAll('#workshopToolsBuilder .tool-row');
    const tools = [];
    rows.forEach(row => {
        const name = row.querySelector('.tool-name')?.value?.trim();
        const version = row.querySelector('.tool-version')?.value?.trim();
        const link = row.querySelector('.tool-link')?.value?.trim();
        const icon = row.querySelector('.tool-icon')?.value?.trim();
        if (name) {
            tools.push({ name, version, link, icon });
        }
    });
    return tools;
}

async function createWorkshop() {
    const title = document.getElementById('workshopTitleInput')?.value?.trim();
    const description = document.getElementById('workshopDescriptionInput')?.value?.trim();
    const startTime = document.getElementById('workshopStartInput')?.value;
    const endTime = document.getElementById('workshopEndInput')?.value;
    if (!title) {
        showNotification('Workshop title is required', 'error');
        return;
    }
    const parsedStart = startTime ? new Date(startTime) : null;
    if (startTime && isNaN(parsedStart.getTime())) {
        showNotification('Invalid start time', 'error');
        return;
    }
    const parsedEnd = endTime ? new Date(endTime) : null;
    if (endTime && isNaN(parsedEnd.getTime())) {
        showNotification('Invalid end time', 'error');
        return;
    }
    if (parsedStart && parsedEnd && parsedEnd < parsedStart) {
        showNotification('End time must be after start time', 'error');
        return;
    }
    try {
        const response = await fetch(`${getApiUrl()}/workshops`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title,
                description,
                startTime: parsedStart ? parsedStart.toISOString() : null,
                endTime: parsedEnd ? parsedEnd.toISOString() : null,
                requiredTools: collectToolRows()
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Workshop created', 'success');
            closeWorkshopCreateModal();
            loadOwnerWorkshops();
        } else {
            showNotification(data.message || 'Failed to create workshop', 'error');
        }
    } catch (error) {
        console.error('Error creating workshop:', error);
        showNotification('Failed to create workshop', 'error');
    }
}

async function loadOwnerWorkshops() {
    const container = document.getElementById('ownerWorkshopCards');
    if (container) {
        container.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Loading workshops...</p>
            </div>
        `;
    }
    try {
        const response = await fetch(`${getApiUrl()}/workshops`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            ownerWorkshops = data.workshops || [];
            renderOwnerWorkshopCards();
        } else {
            if (container) container.innerHTML = '<p class="loading">No workshops available</p>';
        }
    } catch (error) {
        console.error('Error loading workshops:', error);
        if (container) container.innerHTML = '<p class="loading">Failed to load workshops</p>';
    }
}

function handleOwnerWorkshopAction(workshopId, status, liveSessionId) {
    activeWorkshopId = workshopId;
    activeWorkshopSessionId = liveSessionId || null;
    if (status === 'live' && liveSessionId) {
        openWorkshopInterface();
        return;
    }
    openWorkshopDetails(workshopId);
}

function renderOwnerWorkshopCards() {
    const container = document.getElementById('ownerWorkshopCards');
    if (!container) return;
    if (!ownerWorkshops.length) {
        container.innerHTML = `<div class="ws-empty-state"><i class="fa-solid fa-chalkboard-user"></i><p>No workshops yet — create your first one!</p></div>`;
        return;
    }
    container.innerHTML = ownerWorkshops.map(workshop => {
        const statusClass = `status-${workshop.status}`;
        const status = String(workshop.status || 'upcoming').toLowerCase();
        const ctaLabel = status === 'live' ? 'Enter Workshop' : status === 'ended' ? 'View Recording' : 'View Details';
        const start = workshop.startTime ? new Date(workshop.startTime).toLocaleString() : 'TBD';
        const desc = workshop.description || 'No description';
        const toolCount = (workshop.requiredTools || []).length;
        const safeTitle = String(workshop.title || 'Workshop').replace(/'/g, "\\'");
        return `
            <div class="workshop-card" id="ws-card-${workshop.id}">
                <div class="ws-card-top">
                    <h3 class="ws-card-title">${escapeHtml(workshop.title)}</h3>
                    <span class="workshop-status-badge ${statusClass}">${workshop.status}</span>
                </div>
                <div class="ws-card-body">
                    <p class="ws-card-desc">${escapeHtml(desc)}</p>
                    <div class="ws-card-meta">
                        <span><i class="fa-regular fa-clock"></i> ${start}</span>
                        ${toolCount ? `<span><i class="fa-solid fa-toolbox"></i> ${toolCount} tool${toolCount > 1 ? 's' : ''}</span>` : ''}
                    </div>
                </div>
                <div class="ws-card-footer">
                    <button class="ws-card-open-btn" onclick="handleOwnerWorkshopAction(${workshop.id}, '${status}', ${workshop.liveSessionId || 'null'})">
                        ${ctaLabel} <i class="fa-solid fa-arrow-right"></i>
                    </button>
                    <button class="ws-card-delete-btn" onclick="deleteOwnerWorkshop(${workshop.id}, '${safeTitle}')">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function deleteOwnerWorkshop(workshopId, title) {
    const label = title || 'this workshop';
    if (!confirm(`Delete ${label}? Sessions and resources will be removed.`)) return;
    try {
        const response = await fetch(`${getApiUrl()}/workshops/${workshopId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Workshop deleted!', 'success');
            loadOwnerWorkshops();
        } else {
            showNotification(data.message || 'Failed to delete workshop', 'error');
        }
    } catch (error) {
        console.error('Error deleting workshop:', error);
        showNotification('Failed to delete workshop', 'error');
    }
}

function closeWorkshopDetail() {
    const overlay = document.getElementById('ownerWorkshopDetail');
    if (overlay) overlay.classList.remove('active');
    document.querySelectorAll('.workshop-card.ws-card-active').forEach(c => c.classList.remove('ws-card-active'));
}

function closeWorkshopInterface() {
    const iface = document.getElementById('ownerWorkshopInterface');
    if (iface) iface.style.display = 'none';
}

async function openWorkshopDetails(workshopId) {
    activeWorkshopId = workshopId;
    // highlight the active card
    document.querySelectorAll('.workshop-card.ws-card-active').forEach(c => c.classList.remove('ws-card-active'));
    const activeCard = document.getElementById(`ws-card-${workshopId}`);
    if (activeCard) activeCard.classList.add('ws-card-active');

    try {
        const response = await fetch(`${getApiUrl()}/workshops/${workshopId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) {
            showNotification(data.message || 'Failed to load workshop', 'error');
            return;
        }
        const workshop = data.workshop;
        const overlay = document.getElementById('ownerWorkshopDetail');
        const detail = document.getElementById('ownerWorkshopDetailContent');
        const empty = document.getElementById('wsDetailEmpty');
        if (overlay) overlay.classList.add('active');
        if (detail) detail.style.display = 'block';
        if (empty) empty.style.display = 'none';
        document.getElementById('ownerWorkshopTitle').textContent = workshop.title;
        document.getElementById('ownerWorkshopDescription').textContent = workshop.description || '';
        const statusBadge = document.getElementById('ownerWorkshopStatus');
        if (statusBadge) {
            statusBadge.textContent = workshop.status;
            statusBadge.className = `workshop-status-badge status-${workshop.status}`;
        }
        const timeLabel = workshop.startTime ? new Date(workshop.startTime).toLocaleString() : 'TBD';
        document.getElementById('ownerWorkshopTime').textContent = timeLabel;
        document.getElementById('ownerWorkshopInstructor').textContent = workshop.instructor ? workshop.instructor.username : 'Owner';
        const tools = document.getElementById('ownerWorkshopTools');
        if (tools) {
            const toolList = (workshop.requiredTools || []).map(tool => `
                <div class="ws-tool-item">
                    <div class="ws-tool-icon">
                        <i class="${escapeHtml(tool.icon || 'fa-solid fa-screwdriver-wrench')}"></i>
                    </div>
                    <div class="ws-tool-info">
                        <p class="ws-tool-name">${escapeHtml(tool.name)}</p>
                        <p class="ws-tool-version">${escapeHtml(tool.version || '')}</p>
                    </div>
                    ${tool.link ? `<a href="${escapeHtml(tool.link)}" target="_blank" rel="noopener noreferrer" class="ws-tool-link"><i class="fa-solid fa-download"></i> Get</a>` : ''}
                </div>
            `).join('');
            tools.innerHTML = toolList || '<p style="color:var(--text-3);font-size:13px;text-align:center;padding:16px;">No tools listed</p>';
        }

        activeWorkshopSessionId = workshop.liveSessionId || null;
        const nextBtn = document.getElementById('ownerWorkshopNextBtn');
        const startBtn = document.getElementById('ownerWorkshopStartBtn');
        if (nextBtn) nextBtn.disabled = !activeWorkshopSessionId;
        if (startBtn) {
            const isPaused = String(workshop.status || '').toLowerCase() === 'paused';
            startBtn.disabled = !!activeWorkshopSessionId && !isPaused;
            startBtn.innerHTML = isPaused ? '<i class="fa-solid fa-broadcast-tower"></i> Resume' : '<i class="fa-solid fa-broadcast-tower"></i> Go Live';
        }
    } catch (error) {
        console.error('Error loading workshop details:', error);
        showNotification('Failed to load workshop', 'error');
    }
}

async function startWorkshopSession() {
    if (!activeWorkshopId) return;
    try {
        const response = await fetch(`${getApiUrl()}/workshops/${activeWorkshopId}/session/start`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            activeWorkshopSessionId = data.session.id;
            const nextBtn = document.getElementById('ownerWorkshopNextBtn');
            const startBtn = document.getElementById('ownerWorkshopStartBtn');
            if (nextBtn) nextBtn.disabled = false;
            if (startBtn) startBtn.disabled = true;
            showNotification('Workshop is live', 'success');
        } else {
            showNotification(data.message || 'Failed to start session', 'error');
        }
    } catch (error) {
        console.error('Error starting session:', error);
        showNotification('Failed to start session', 'error');
    }
}

async function openWorkshopInterface() {
    if (!activeWorkshopId) return;
    if (!activeWorkshopSessionId) {
        await startWorkshopSession();
    }
    if (!activeWorkshopSessionId) return;
    // close the detail overlay
    closeWorkshopDetail();
    const container = document.getElementById('ownerWorkshopInterface');
    if (container) container.style.display = 'block';
    const title = document.getElementById('ownerInterfaceTitle');
    if (title) {
        const workshop = ownerWorkshops.find(w => w.id === activeWorkshopId);
        title.textContent = workshop ? workshop.title : 'Live Workshop';
    }
    await loadWorkshopSessionState(activeWorkshopSessionId);
    if (socket) {
        socket.emit('join-workshop-session', activeWorkshopSessionId);
    }
    bindWorkshopSocketHandlers();
}

function updateOwnerSessionBadge(status) {
    const badge = document.querySelector('.ws-live-badge');
    if (!badge) return;
    const normalized = String(status || 'LIVE').toUpperCase();
    const label = normalized === 'PAUSED' ? 'Session Paused' : normalized === 'ENDED' ? 'Session Ended' : 'Live Session';
    badge.innerHTML = `<span class="ws-live-dot"></span> ${label}`;
}

async function loadWorkshopSessionState(sessionId) {
    try {
        const response = await fetch(`${getApiUrl()}/sessions/${sessionId}/state`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) {
            showNotification(data.message || 'Failed to load session', 'error');
            return;
        }
        activeWorkshopBundle = data.bundle || null;
        activeWorkshopSections = data.sections || [];
        const editor = document.getElementById('ownerWorkshopEditor');
        if (editor) editor.value = activeWorkshopBundle ? activeWorkshopBundle.rawCode : '';
        workshopPreviewEnabled = !!data.session.previewEnabled;
        updateOwnerSessionBadge(data.session.status);
        updatePreviewToggle();
        renderOwnerSections(activeWorkshopSections);
        if (workshopPreviewEnabled) updatePreviewFrame();
    } catch (error) {
        console.error('Error loading session state:', error);
        showNotification('Failed to load session', 'error');
    }
}

function renderOwnerSections(sections) {
    const list = document.getElementById('ownerSectionsList');
    if (!list) return;
    const sorted = [...sections].sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    activeWorkshopSections = sorted;
    if (!sorted.length) {
        list.innerHTML = '';
        return;
    }
    list.innerHTML = sorted.map(section => `
        <div class="section-item">
            <div>
                <strong>${escapeHtml(section.name)}</strong>
                <div style="font-size:11px;color:var(--text-3);margin-top:2px;">Lines ${section.startLine}–${section.endLine}</div>
            </div>
            <div class="section-actions">
                <input type="checkbox" ${section.visible ? 'checked' : ''} onchange="toggleSectionVisibility(${section.id}, this.checked)">
                <button class="ws-chip-btn" onclick="moveSection(${section.id}, -1)">↑</button>
                <button class="ws-chip-btn" onclick="moveSection(${section.id}, 1)">↓</button>
                <button class="ws-chip-btn" onclick="deleteSection(${section.id})">✕</button>
            </div>
        </div>
    `).join('');
}

async function saveWorkshopCode(publish) {
    if (!activeWorkshopSessionId) return;
    const editor = document.getElementById('ownerWorkshopEditor');
    const language = document.getElementById('ownerLanguageSelect')?.value || 'plaintext';
    if (!editor) return;
    const rawCode = editor.value || '';
    try {
        const response = await fetch(`${getApiUrl()}/sessions/${activeWorkshopSessionId}/code/save`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ rawCode, language, publish })
        });
        const data = await response.json();
        if (data.success) {
            activeWorkshopBundle = data.bundle;
            activeWorkshopSections = data.sections || activeWorkshopSections;
            renderOwnerSections(activeWorkshopSections);
            if (publish) updatePreviewFrame();
            if (!publish) showNotification('Draft saved', 'success');
            return data;
        } else {
            showNotification(data.message || 'Failed to save code', 'error');
        }
    } catch (error) {
        console.error('Error saving code:', error);
        showNotification('Failed to save code', 'error');
    }
}

async function publishWorkshopToStudents() {
    if (!activeWorkshopSessionId) return;
    const saved = await saveWorkshopCode(true);
    if (!saved) return;
    if (activeWorkshopSections.length) {
        const order = activeWorkshopSections.map(s => s.id);
        const visibleIds = activeWorkshopSections.filter(s => s.visible).map(s => s.id);
        await publishSections(visibleIds, order);
    }
    showNotification('Published to students', 'success');
}

function createSectionFromSelection() {
    const editor = document.getElementById('ownerWorkshopEditor');
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start === end) {
        showNotification('Select a range in the editor', 'error');
        return;
    }
    const startLine = editor.value.slice(0, start).split(/\r?\n/).length;
    const endLine = editor.value.slice(0, end).split(/\r?\n/).length;
    document.getElementById('sectionStartInput').value = startLine;
    document.getElementById('sectionEndInput').value = endLine;
    document.getElementById('sectionNameInput').value = `Section ${activeWorkshopSections.length + 1}`;
}

async function createSectionManual() {
    const name = document.getElementById('sectionNameInput')?.value?.trim() || `Section ${activeWorkshopSections.length + 1}`;
    const startLine = parseInt(document.getElementById('sectionStartInput')?.value);
    const endLine = parseInt(document.getElementById('sectionEndInput')?.value);
    if (!startLine || !endLine) {
        showNotification('Provide start and end line', 'error');
        return;
    }
    await updateSections([{ name, startLine, endLine, visible: true, orderIndex: activeWorkshopSections.length }], []);
}

async function updateSections(sections, removeIds) {
    if (!activeWorkshopSessionId) return;
    try {
        const response = await fetch(`${getApiUrl()}/sessions/${activeWorkshopSessionId}/sections`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sections, removeIds })
        });
        const data = await response.json();
        if (data.success) {
            activeWorkshopSections = data.sections || [];
            renderOwnerSections(activeWorkshopSections);
        } else {
            showNotification(data.message || 'Failed to update sections', 'error');
        }
    } catch (error) {
        console.error('Error updating sections:', error);
        showNotification('Failed to update sections', 'error');
    }
}

async function deleteSection(sectionId) {
    await updateSections([], [sectionId]);
}

async function toggleSectionVisibility(sectionId, visible) {
    activeWorkshopSections = activeWorkshopSections.map(section => ({
        ...section,
        visible: section.id === sectionId ? visible : section.visible
    }));
    renderOwnerSections(activeWorkshopSections);
}

async function moveSection(sectionId, direction) {
    const index = activeWorkshopSections.findIndex(s => s.id === sectionId);
    if (index < 0) return;
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= activeWorkshopSections.length) return;
    const reordered = [...activeWorkshopSections];
    const temp = reordered[index];
    reordered[index] = reordered[swapIndex];
    reordered[swapIndex] = temp;
    activeWorkshopSections = reordered.map((section, idx) => ({
        ...section,
        orderIndex: idx
    }));
    renderOwnerSections(activeWorkshopSections);
}

async function publishSections(visibleSectionIds, order) {
    if (!activeWorkshopSessionId) return;
    try {
        const response = await fetch(`${getApiUrl()}/sessions/${activeWorkshopSessionId}/publish-sections`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ visibleSectionIds, order })
        });
        const data = await response.json();
        if (!data.success) {
            showNotification(data.message || 'Failed to publish sections', 'error');
        } else {
            activeWorkshopSections = activeWorkshopSections.map(s => ({
                ...s,
                visible: visibleSectionIds.includes(s.id),
                orderIndex: order.length ? order.indexOf(s.id) : s.orderIndex
            })).sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
            renderOwnerSections(activeWorkshopSections);
        }
    } catch (error) {
        console.error('Error publishing sections:', error);
        showNotification('Failed to publish sections', 'error');
    }
}

function updatePreviewToggle() {
    const toggleBtn = document.getElementById('ownerPreviewToggle');
    const container = document.getElementById('ownerPreviewContainer');
    if (toggleBtn) toggleBtn.textContent = workshopPreviewEnabled ? 'Disable Preview' : 'Enable Preview';
    if (container) container.style.display = workshopPreviewEnabled ? 'block' : 'none';
}

async function togglePreview() {
    if (!activeWorkshopSessionId) return;
    try {
        const response = await fetch(`${getApiUrl()}/sessions/${activeWorkshopSessionId}/preview`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled: !workshopPreviewEnabled })
        });
        const data = await response.json();
        if (data.success) {
            workshopPreviewEnabled = data.previewEnabled;
            updatePreviewToggle();
            if (workshopPreviewEnabled) updatePreviewFrame();
        } else {
            showNotification(data.message || 'Failed to update preview', 'error');
        }
    } catch (error) {
        console.error('Error toggling preview:', error);
        showNotification('Failed to update preview', 'error');
    }
}

async function pauseWorkshopSession() {
    if (!activeWorkshopSessionId) return;
    try {
        const response = await fetch(`${getApiUrl()}/sessions/${activeWorkshopSessionId}/pause`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();
        if (data.success) {
            updateOwnerSessionBadge('PAUSED');
            showNotification('Session paused', 'info');
        } else {
            showNotification(data.message || 'Failed to pause session', 'error');
        }
    } catch (error) {
        console.error('Error pausing session:', error);
        showNotification('Failed to pause session', 'error');
    }
}

async function endWorkshopSession() {
    if (!activeWorkshopSessionId) return;
    try {
        const response = await fetch(`${getApiUrl()}/sessions/${activeWorkshopSessionId}/end`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();
        if (data.success) {
            updateOwnerSessionBadge('ENDED');
            showNotification('Session ended', 'success');
        } else {
            showNotification(data.message || 'Failed to end session', 'error');
        }
    } catch (error) {
        console.error('Error ending session:', error);
        showNotification('Failed to end session', 'error');
    }
}

function updatePreviewFrame() {
    const frame = document.getElementById('ownerPreviewFrame');
    if (!frame || !activeWorkshopBundle) return;
    const rawCode = activeWorkshopBundle.rawCode || '';
    if (activeWorkshopBundle.language === 'html') {
        frame.srcdoc = rawCode;
    } else {
        const escaped = rawCode.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        frame.srcdoc = `<pre style="font-family: monospace; padding: 16px; white-space: pre-wrap;">${escaped}</pre>`;
    }
}

function bindWorkshopSocketHandlers() {
    if (!socket || workshopSocketBound) return;
    workshopSocketBound = true;

    socket.on('PARTICIPANT_COUNT_UPDATED', (payload) => {
        if (!activeWorkshopSessionId) return;
        if (payload.session_id && payload.session_id !== activeWorkshopSessionId) return;
        const countEl = document.getElementById('ownerParticipantsCount');
        if (countEl) countEl.textContent = `${payload.count} connected`;
    });

    socket.on('CODE_UPDATED', (payload) => {
        if (!activeWorkshopSessionId || !payload) return;
        if (payload.session_id && payload.session_id !== activeWorkshopSessionId) return;
        activeWorkshopBundle = {
            id: payload.bundle_id,
            rawCode: payload.raw_code,
            language: payload.language,
            versionNumber: payload.version
        };
        if (payload.sections) {
            activeWorkshopSections = payload.sections.map(section => ({
                id: section.id,
                startLine: section.start,
                endLine: section.end,
                content: section.content,
                visible: section.visible,
                orderIndex: section.order,
                name: section.name,
                language: section.language
            }));
            renderOwnerSections(activeWorkshopSections);
        }
        const editor = document.getElementById('ownerWorkshopEditor');
        if (editor) editor.value = payload.raw_code || '';
        if (workshopPreviewEnabled) updatePreviewFrame();
        if (payload.author_id && typeof currentUserId !== 'undefined' && payload.author_id !== currentUserId) {
            showNotification('Code updated', 'info');
        }
    });

    socket.on('SECTIONS_PUBLISHED', (payload) => {
        if (!payload || !payload.visible_section_ids) return;
        if (payload.session_id && payload.session_id !== activeWorkshopSessionId) return;
        if (payload.sections && payload.sections.length) {
            activeWorkshopSections = payload.sections.map(section => ({
                id: section.id,
                startLine: section.start,
                endLine: section.end,
                content: section.content,
                visible: section.visible,
                orderIndex: section.order,
                name: section.name,
                language: section.language
            }));
        } else {
            activeWorkshopSections = activeWorkshopSections.map(section => ({
                ...section,
                visible: payload.visible_section_ids.includes(section.id)
            }));
        }
        renderOwnerSections(activeWorkshopSections);
        showNotification('Sections published', 'success');
    });

    socket.on('PREVIEW_TOGGLED', (payload) => {
        if (!payload) return;
        if (payload.session_id && payload.session_id !== activeWorkshopSessionId) return;
        workshopPreviewEnabled = !!payload.enabled;
        updatePreviewToggle();
        if (workshopPreviewEnabled) updatePreviewFrame();
        showNotification(workshopPreviewEnabled ? 'Preview enabled' : 'Preview disabled', 'info');
    });

    socket.on('SESSION_STARTED', (payload) => {
        if (!payload) return;
        if (payload.session_id && payload.session_id !== activeWorkshopSessionId) return;
        updateOwnerSessionBadge('LIVE');
        showNotification('Session started', 'success');
    });

    socket.on('SESSION_ENDED', (payload) => {
        if (!payload) return;
        if (payload.session_id && payload.session_id !== activeWorkshopSessionId) return;
        updateOwnerSessionBadge('ENDED');
        showNotification('Session ended', 'info');
    });
}

// ========== EXPOSE FUNCTIONS TO WINDOW FOR ONCLICK HANDLERS ==========
// This ensures onclick attributes in HTML can find these functions
// Note: switchPage and addMemberByStudentId are already exposed above
window.showAddMemberModal = showAddMemberModal;
window.clearSearch = clearSearch;
window.searchMembers = searchMembers;
window.showCreateEventForm = showCreateEventForm;
window.hideCreateEventForm = hideCreateEventForm;
window.openAwardPointsModal = openAwardPointsModal;
window.closeAwardPointsModal = closeAwardPointsModal;
window.awardPoints = awardPoints;
window.removeMember = removeMember;
window.openRoleModal = openRoleModal;
window.closeRoleModal = closeRoleModal;
window.assignRole = assignRole;
window.openAttendanceModal = openAttendanceModal;
window.closeAttendanceModal = closeAttendanceModal;
window.toggleMemberSelection = toggleMemberSelection;
window.selectAllMembers = selectAllMembers;
window.deselectAllMembers = deselectAllMembers;
window.submitAttendance = submitAttendance;
window.showQRCode = showQRCode;
window.showGalleryUpload = showGalleryUpload;
window.uploadGalleryPhotos = uploadGalleryPhotos;
window.loadGalleryPhotos = loadGalleryPhotos;
window.openGalleryLightbox = openGalleryLightbox;
window.renderLightbox = renderLightbox;
window.navigateLightbox = navigateLightbox;
window.closeLightbox = closeLightbox;
window.deleteGalleryPhoto = deleteGalleryPhoto;
window.openNewMessageModal = openNewMessageModal;
window.closeNewMessageModal = closeNewMessageModal;
window.sendMessage = sendMessage;
window.markAllNotificationsRead = markAllNotificationsRead;
window.closeNotificationsModal = closeNotificationsModal;
window.selectMemberFromSearch = selectMemberFromSearch;
window.openChat = openChat;
window.loadChatMessages = loadChatMessages;
window.markNotificationRead = markNotificationRead;
window.loadNotifications = loadNotifications;
window.clearSearch = clearSearch;
window.searchMembers = searchMembers;
window.openWorkshopCreateModal = openWorkshopCreateModal;
window.closeWorkshopCreateModal = closeWorkshopCreateModal;
window.addToolRow = addToolRow;
window.handleOwnerWorkshopAction = handleOwnerWorkshopAction;
window.openWorkshopDetails = openWorkshopDetails;
window.startWorkshopSession = startWorkshopSession;
window.openWorkshopInterface = openWorkshopInterface;
window.saveWorkshopCode = saveWorkshopCode;
window.publishWorkshopToStudents = publishWorkshopToStudents;
window.createSectionFromSelection = createSectionFromSelection;
window.createSectionManual = createSectionManual;
window.toggleSectionVisibility = toggleSectionVisibility;
window.moveSection = moveSection;
window.deleteSection = deleteSection;
window.togglePreview = togglePreview;
window.pauseWorkshopSession = pauseWorkshopSession;
window.endWorkshopSession = endWorkshopSession;

// ========== QR ATTENDANCE SESSION SYSTEM ==========
let qrSessionId = null;
let qrEventId = null;
let qrRefreshInterval = null;
let qrCountdownInterval = null;
let qrPollingInterval = null;
const QR_REFRESH_SECONDS = 25;

/**
 * Start a QR Attendance Session for an event
 */
async function startQRAttendance(eventId, eventTitle) {
    try {
        showNotification('Starting QR attendance session...', 'info');

        const response = await fetch(`${getApiUrl()}/attendance/session/start`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ eventId })
        });

        const data = await response.json();

        if (data.success) {
            qrSessionId = data.session.id;
            qrEventId = eventId;

            // Update UI with event info
            document.getElementById('qrEventTitle').textContent = eventTitle;

            const expiresEl = document.getElementById('qrExpiresAt');
            if (expiresEl) {
                expiresEl.textContent = new Date(data.session.expiresAt).toLocaleTimeString();
            }

            // Display initial code
            if (data.session.code) {
                const codeDisplay = document.getElementById('attendanceCodeDisplay');
                if (codeDisplay) {
                    const formattedCode = data.session.code.substring(0, 3) + ' ' + data.session.code.substring(3);
                    codeDisplay.textContent = formattedCode;
                }
            }

            // Show modal
            document.getElementById('qrAttendanceModal').classList.add('active');

            // Generate initial QR code
            await refreshQRCode();

            // Start refresh timer
            startQRRefreshTimer();

            // Start polling for attendance updates
            startAttendancePolling();

            showNotification('QR attendance session started!', 'success');
        } else {
            showNotification(data.message || 'Failed to start session', 'error');
        }
    } catch (error) {
        console.error('Error starting QR attendance:', error);
        showNotification('Failed to start QR attendance session', 'error');
    }
}

/**
 * Refresh the QR code with a new token
 */
async function refreshQRCode() {
    if (!qrSessionId) return;

    try {
        const response = await fetch(`${getApiUrl()}/attendance/session/${qrSessionId}/token`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            // Generate QR code on canvas
            const canvas = document.getElementById('qrCanvas');
            await generateQRToCanvas(canvas, data.token, 200);

            // Update 7-digit code display
            if (data.code) {
                const codeDisplay = document.getElementById('attendanceCodeDisplay');
                if (codeDisplay) {
                    // Format code with space in middle for readability (ABC XYZK)
                    const formattedCode = data.code.substring(0, 3) + ' ' + data.code.substring(3);
                    codeDisplay.textContent = formattedCode;
                }
            }

            // Update expiry time
            if (data.expiresAt) {
                const expiresEl = document.getElementById('qrExpiresAt');
                if (expiresEl) {
                    expiresEl.textContent = new Date(data.expiresAt).toLocaleTimeString();
                }
            }
        } else {
            // Session might be expired or closed
            if (data.message && (data.message.includes('expired') || data.message.includes('closed'))) {
                showNotification('Session has expired', 'info');
                closeQRAttendanceSession();
            }
        }
    } catch (error) {
        console.error('Error refreshing QR code:', error);
    }
}

/**
 * Generate QR code to canvas using available QR library
 * Supports both qrcode npm package and qrcodejs library
 */
async function generateQRToCanvas(canvas, text, size) {
    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, size, size);

    // Try qrcode npm package first (uses toCanvas)
    if (typeof QRCode !== 'undefined' && typeof QRCode.toCanvas === 'function') {
        try {
            await QRCode.toCanvas(canvas, text, {
                width: size,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });
            return;
        } catch (e) {
            console.warn('qrcode npm package error:', e);
        }
    }

    // Try qrcodejs library (uses constructor with div)
    if (typeof QRCode !== 'undefined' && typeof QRCode.CorrectLevel !== 'undefined') {
        try {
            const tempDiv = document.createElement('div');
            tempDiv.style.display = 'none';
            document.body.appendChild(tempDiv);

            new QRCode(tempDiv, {
                text: text,
                width: size,
                height: size,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });

            // Wait for QR to render
            await new Promise(resolve => setTimeout(resolve, 150));

            const qrCanvas = tempDiv.querySelector('canvas');
            const qrImg = tempDiv.querySelector('img');

            if (qrCanvas) {
                ctx.drawImage(qrCanvas, 0, 0, size, size);
            } else if (qrImg && qrImg.complete) {
                ctx.drawImage(qrImg, 0, 0, size, size);
            } else if (qrImg) {
                await new Promise((resolve) => {
                    qrImg.onload = () => {
                        ctx.drawImage(qrImg, 0, 0, size, size);
                        resolve();
                    };
                    setTimeout(resolve, 500); // Timeout fallback
                });
            }

            document.body.removeChild(tempDiv);
            return;
        } catch (e) {
            console.warn('qrcodejs library error:', e);
        }
    }

    // Fallback: draw placeholder
    drawFallbackQR(ctx, text, size);
}

function drawFallbackQR(ctx, text, size) {
    // Simple fallback: draw a placeholder with the token
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, size, size);

    // Draw border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, size - 20, size - 20);

    // Draw QR placeholder pattern
    ctx.fillStyle = '#1e293b';
    const cellSize = 8;
    const margin = 30;
    for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
            if ((i + j) % 2 === 0) {
                ctx.fillRect(margin + i * cellSize, margin + j * cellSize, cellSize, cellSize);
                ctx.fillRect(size - margin - (i + 1) * cellSize, margin + j * cellSize, cellSize, cellSize);
                ctx.fillRect(margin + i * cellSize, size - margin - (j + 1) * cellSize, cellSize, cellSize);
            }
        }
    }

    ctx.fillStyle = '#334155';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('📱 Scan QR Code', size / 2, size / 2 - 15);

    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = '#64748b';
    const shortToken = text.length > 30 ? text.substring(0, 15) + '...' + text.substring(text.length - 10) : text;
    ctx.fillText(shortToken, size / 2, size / 2 + 10);
    ctx.fillText('Loading QR library...', size / 2, size / 2 + 30);
}

/**
 * Start the countdown timer for QR refresh
 */
function startQRRefreshTimer() {
    let countdown = QR_REFRESH_SECONDS;

    // Clear existing intervals
    if (qrCountdownInterval) clearInterval(qrCountdownInterval);
    if (qrRefreshInterval) clearInterval(qrRefreshInterval);

    // Update countdown every second
    qrCountdownInterval = setInterval(() => {
        countdown--;
        const countdownEl = document.getElementById('qrCountdown');
        const progressBar = document.getElementById('qrProgressBar');

        if (countdownEl) countdownEl.textContent = countdown;
        if (progressBar) progressBar.style.width = `${(countdown / QR_REFRESH_SECONDS) * 100}%`;

        if (countdown <= 0) {
            countdown = QR_REFRESH_SECONDS;
        }
    }, 1000);

    // Refresh QR code every 25 seconds
    qrRefreshInterval = setInterval(async () => {
        await refreshQRCode();
    }, QR_REFRESH_SECONDS * 1000);
}

/**
 * Start polling for attendance updates
 */
function startAttendancePolling() {
    if (qrPollingInterval) clearInterval(qrPollingInterval);

    // Poll every 5 seconds for live updates
    qrPollingInterval = setInterval(async () => {
        await updateAttendanceList();
    }, 5000);

    // Also update immediately
    updateAttendanceList();
}

/**
 * Update the live attendance list
 */
async function updateAttendanceList() {
    if (!qrSessionId) return;

    try {
        const response = await fetch(`${getApiUrl()}/attendance/session/${qrSessionId}/summary`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success && data.summary) {
            const attendees = data.summary.members || [];
            const presentCount = data.summary.presentCount || attendees.length;
            const lateCount = data.summary.lateCount || 0;

            // Update counts
            document.getElementById('qrPresentCount').textContent = `${presentCount} Present`;

            const lateEl = document.getElementById('qrLateCount');
            if (lateCount > 0) {
                lateEl.textContent = `${lateCount} Late`;
                lateEl.style.display = 'inline';
            } else {
                lateEl.style.display = 'none';
            }

            // Update list
            const listEl = document.getElementById('qrAttendeesList');
            if (attendees.length === 0) {
                listEl.innerHTML = `
                    <p style="padding: 40px 20px; text-align: center; color: #9ca3af;">
                        <i class="fa-solid fa-users" style="font-size: 32px; margin-bottom: 10px; display: block;"></i>
                        Waiting for members to scan...
                    </p>
                `;
            } else {
                listEl.innerHTML = attendees.map(a => `
                    <div style="display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
                        <div style="width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #2563eb); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 12px;">
                            ${(a.username || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div style="flex: 1;">
                            <button type="button" class="link-btn member-link" onclick="openMemberProfile(${a.id}); event.stopPropagation();">${a.username || 'Unknown'}</button>
                            <p style="margin: 2px 0 0 0; font-size: 12px; color: #6b7280;">
                                ${new Date(a.checkedInAt).toLocaleTimeString()}
                            </p>
                        </div>
                        <span style="padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; background: ${a.isLate ? '#fef3c7' : '#d1fae5'}; color: ${a.isLate ? '#b45309' : '#065f46'};">
                            ${a.isLate ? 'Late' : 'On Time'}
                        </span>
                    </div>
                `).join('');
            }

            // Check if session is still active
            if (data.summary.status === 'closed' || data.summary.status === 'expired') {
                showNotification('Attendance session has ended', 'info');
                if (qrRefreshInterval) {
                    clearInterval(qrRefreshInterval);
                    qrRefreshInterval = null;
                }
                if (qrCountdownInterval) {
                    clearInterval(qrCountdownInterval);
                    qrCountdownInterval = null;
                }
                if (qrPollingInterval) {
                    clearInterval(qrPollingInterval);
                    qrPollingInterval = null;
                }
            }
        }
    } catch (error) {
        console.error('Error updating attendance list:', error);
    }
}

async function exportQRAttendance() {
    if (!qrEventId) {
        showNotification('No event selected for export', 'error');
        return;
    }

    try {
        const response = await fetch(`${getApiUrl()}/owner/event/${qrEventId}/attendance-export`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            let message = 'Failed to export attendance';
            try {
                const data = await response.json();
                if (data && data.message) message = data.message;
            } catch (e) {
                message = 'Failed to export attendance';
            }
            showNotification(message, 'error');
            return;
        }

        const blob = await response.blob();
        const contentDisposition = response.headers.get('Content-Disposition') || '';
        const match = contentDisposition.match(/filename="([^"]+)"/);
        const filename = match ? match[1] : 'attendance_export.csv';

        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        showNotification('Attendance exported', 'success');
    } catch (error) {
        console.error('Error exporting attendance:', error);
        showNotification('Failed to export attendance', 'error');
    }
}

/**
 * End the QR attendance session
 */
async function endQRAttendanceSession() {
    if (!qrSessionId) {
        closeQRAttendanceSession();
        return;
    }

    try {
        const response = await fetch(`${getApiUrl()}/attendance/session/${qrSessionId}/end`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`Session ended. ${data.totalPresent || 0} members marked present.`, 'success');
        }
    } catch (error) {
        console.error('Error ending session:', error);
    }

    closeQRAttendanceSession();
    loadEvents(); // Refresh events to show updated attendance
}

/**
 * Close the QR attendance modal and clean up
 */
function closeQRAttendanceSession() {
    // Clear all intervals
    if (qrRefreshInterval) {
        clearInterval(qrRefreshInterval);
        qrRefreshInterval = null;
    }
    if (qrCountdownInterval) {
        clearInterval(qrCountdownInterval);
        qrCountdownInterval = null;
    }
    if (qrPollingInterval) {
        clearInterval(qrPollingInterval);
        qrPollingInterval = null;
    }

    qrSessionId = null;
    qrEventId = null;

    // Hide modal
    document.getElementById('qrAttendanceModal').classList.remove('active');

    // Reset UI
    document.getElementById('qrAttendeesList').innerHTML = `
        <p style="padding: 40px 20px; text-align: center; color: #9ca3af;">
            <i class="fa-solid fa-users" style="font-size: 32px; margin-bottom: 10px; display: block;"></i>
            Waiting for members to scan...
        </p>
    `;
    document.getElementById('qrPresentCount').textContent = '0 Present';
    document.getElementById('qrLateCount').style.display = 'none';
    document.getElementById('qrCountdown').textContent = QR_REFRESH_SECONDS;
    document.getElementById('qrProgressBar').style.width = '100%';
}

// Expose QR attendance functions to window
window.startQRAttendance = startQRAttendance;
window.exportQRAttendance = exportQRAttendance;
window.closeQRAttendanceSession = closeQRAttendanceSession;
window.endQRAttendanceSession = endQRAttendanceSession;

console.log('✅ All functions exposed to window object for onclick handlers!');
