// API Configuration
const API_URL = window.API_URL || 'http://localhost:4000';

// Get token from localStorage
const token = localStorage.getItem('token');

// Check authentication
if (!token) {
    window.location.href = 'index.html';
}

// Helper to get full image URL
function getFullImageUrl(path) {
    if (!path) return '';
    const normalized = String(path).replace(/\\/g, '/').trim();
    if (!normalized) return '';
    if (normalized.startsWith('http')) return normalized;
    if (normalized.startsWith('/')) return `${API_URL}${normalized}`;
    return `${API_URL}/${normalized}`;
}

// Verify token and role
async function verifyAuth() {
    try {
        const response = await fetch(`${API_URL}/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (!data.success || data.user.role !== 'member') {
            showNotification('Access denied! Members only.', 'error');
            setTimeout(() => {
                localStorage.removeItem('token');
                window.location.href = 'index.html';
            }, 2000);
            return;
        }

        document.getElementById('memberName').textContent = data.user.username;
        document.getElementById('welcomeName').textContent = data.user.username;

        // Update user dropdown details
        if (document.getElementById('dropdownUserName')) {
            document.getElementById('dropdownUserName').textContent = data.user.username;
        }
        if (document.getElementById('dropdownUserEmail')) {
            document.getElementById('dropdownUserEmail').textContent = data.user.email || 'Email not available';
        }

        // Update profile pictures
        if (data.user.profilePic) {
            const fullUrl = getFullImageUrl(data.user.profilePic);

            // Navbar Avatar
            const navImg = document.getElementById('navUserImg');
            if (navImg) {
                navImg.src = fullUrl;
                navImg.style.display = 'block';
                const icon = navImg.nextElementSibling;
                if (icon && icon.tagName === 'I') icon.style.display = 'none';
            }

            // Dropdown Large Avatar
            const dropdownImg = document.getElementById('dropdownUserImg');
            if (dropdownImg) {
                dropdownImg.src = fullUrl;
                dropdownImg.style.display = 'block';
                const icon = dropdownImg.nextElementSibling;
                if (icon && icon.tagName === 'I') icon.style.display = 'none';
            }
        }

        await loadMyClubs();
        const initialPage = getPageFromUrl();
        switchPage(initialPage, { replaceHistory: true });
        initHistoryNavigation();

        // Auth success - hide preloader
        hidePreloader();
    } catch (error) {
        console.error('Auth error:', error);
        localStorage.removeItem('token');
        window.location.href = 'index.html';
    }
}

function setClubSwitcherLoading(isLoading) {
    const switcher = document.querySelector('.club-switcher');
    const button = document.getElementById('clubSwitcherBtn');
    const nameEl = document.getElementById('currentClubName');
    if (isLoading) {
        if (switcher) switcher.classList.add('switching');
        if (button) button.disabled = true;
        if (nameEl) nameEl.innerHTML = '<span class="switching-text">Switching...</span>';
    } else {
        if (switcher) switcher.classList.remove('switching');
        if (button) button.disabled = false;
    }
}

function setDashboardLoading(isLoading) {
    const homeLoader = document.getElementById('homeLoader');
    const dashboardContent = document.getElementById('dashboard-content');
    if (!homeLoader || !dashboardContent) return;
    if (isLoading) {
        homeLoader.style.display = 'block';
        dashboardContent.style.display = 'none';
    } else {
        homeLoader.style.display = 'none';
        dashboardContent.style.display = 'block';
    }
}

// Club Switcher Functionality
async function loadMyClubs() {
    try {
        console.log('🔄 Loading clubs for member...');
        const clubList = document.getElementById('clubList');
        const clubCount = document.getElementById('clubCount');
        if (clubList) {
            clubList.innerHTML = `
                <div class="loading-spinner">
                    <div class="spinner"></div>
                    <p>Loading clubs...</p>
                </div>
            `;
        }
        if (clubCount) clubCount.textContent = '...';
        const response = await fetch(`${API_URL}/member/my-clubs`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        console.log('📦 Clubs response:', data);

        if (data.success && data.clubs && data.clubs.length > 0) {
            const activeClub = data.clubs.find(c => c.id === data.activeClub) || data.clubs.find(c => c.isActive) || data.clubs[0];
            console.log('✅ Active club found:', activeClub);
            document.getElementById('currentClubName').textContent = activeClub.name;

            clubList.innerHTML = data.clubs.map(club => `
                <div class="club-item ${(club.id === data.activeClub || club.isActive) ? 'active' : ''}" onclick="switchClub(${club.id})">
                    <i class="fa-solid fa-building"></i>
                    <div class="club-item-info">
                        <h5>${club.name}</h5>
                        <p>${club.tagline || 'No tagline'}</p>
                    </div>
                    ${(club.id === data.activeClub || club.isActive) ? '<i class="fa-solid fa-check" style="color: #10b981; margin-left: auto;"></i>' : ''}
                </div>
            `).join('');
            if (clubCount) clubCount.textContent = data.clubs.length;
            setClubSwitcherLoading(false);
        } else {
            // No clubs - show message
            console.log('⚠️ No clubs found for member');
            document.getElementById('currentClubName').textContent = 'No Club';
            clubList.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #6b7280;">
                    <i class="fa-solid fa-info-circle" style="font-size: 24px; margin-bottom: 10px;"></i>
                    <p style="margin: 0; font-size: 14px;">You are not part of any club yet.</p>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #9ca3af;">Wait for club head to add you.</p>
                </div>
            `;
            if (clubCount) clubCount.textContent = '0';
            setClubSwitcherLoading(false);
        }
    } catch (error) {
        console.error('❌ Error loading clubs:', error);
        setClubSwitcherLoading(false);
    }
}

// Toggle club dropdown
// Toggle club dropdown
document.getElementById('clubSwitcherBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const switcher = e.currentTarget.closest('.club-switcher');
    if (switcher) switcher.classList.toggle('active');

    // Close user dropdown if open
    const userDropdown = document.querySelector('.user-menu .dropdown');
    if (userDropdown) userDropdown.classList.remove('active');
});

// Toggle User Menu Dropdown (Fix for mobile touch)
const userDropdownBtn = document.querySelector('.user-menu .dropdown-btn');
if (userDropdownBtn) {
    userDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault(); // Prevent accidental navigation if it was a link
        const dropdown = e.currentTarget.closest('.dropdown');
        dropdown.classList.toggle('active');

        // Close club dropdown if open
        document.getElementById('clubDropdown').classList.remove('active');
    });
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    const clubSwitcher = document.querySelector('.club-switcher');
    const userDropdown = document.querySelector('.user-menu .dropdown');

    if (clubSwitcher && !e.target.closest('.club-switcher')) {
        clubSwitcher.classList.remove('active');
    }

    if (userDropdown && !e.target.closest('.user-menu')) {
        userDropdown.classList.remove('active');
    }
});

// Switch active club
async function switchClub(clubId) {
    try {
        setClubSwitcherLoading(true);
        setDashboardLoading(true);
        const response = await fetch(`${API_URL}/member/switch-club`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ clubId })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            document.getElementById('clubDropdown').classList.remove('active');
            loadMyClubs();
            loadDashboard(); // Reload dashboard with new club data
        } else {
            showNotification(data.message, 'error');
            setClubSwitcherLoading(false);
            setDashboardLoading(false);
        }
    } catch (error) {
        console.error('Error switching club:', error);
        showNotification('Failed to switch club', 'error');
        setClubSwitcherLoading(false);
        setDashboardLoading(false);
    }
}

// Removed: Join club feature

// Logout
document.getElementById('logoutBtn').addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('token');
    window.location.href = 'index.html';
});

// Make brand (icon + text) clickable to go Home smoothly
document.addEventListener('DOMContentLoaded', () => {
    const brand = document.querySelector('.navbar-brand');
    if (brand) {
        brand.addEventListener('click', (e) => {
            e.preventDefault();
            try {
                switchPage('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } catch (err) {
                console.error('Brand click navigation error:', err);
            }
        });
    }
});

// Page Switching
const menuItems = document.querySelectorAll('.menu-item');
const pages = document.querySelectorAll('.page');
let historyInitialized = false;

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

menuItems.forEach(item => {
    item.addEventListener('click', () => {
        const pageName = item.getAttribute('data-page');

        // If it's a regular page link
        if (pageName) {
            switchPage(pageName);
        }

        // Close sidebar on mobile when ANY item is clicked
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (window.innerWidth <= 900) {
            sidebar.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
        }
    });
});

// Messages Sidebar Button
const messagesBtn = document.getElementById('sidebarMessagesBtn');
if (messagesBtn) {
    messagesBtn.addEventListener('click', () => {
        loadMessages();
    });
}

// Mobile Sidebar Toggle
document.addEventListener('DOMContentLoaded', () => {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', (e) => {
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
});

function navigateTo(pageName) {
    switchPage(pageName);
    // Close user dropdown if open
    const userDropdown = document.querySelector('.user-menu .dropdown');
    if (userDropdown) userDropdown.classList.remove('active');
}

function switchPage(pageName, options = {}) {
    const previousPageName = getActivePageName();
    // Update menu
    menuItems.forEach(item => item.classList.remove('active'));
    document.querySelector(`[data-page="${pageName}"]`).classList.add('active');

    // Update content
    pages.forEach(page => page.classList.remove('active'));
    document.getElementById(`${pageName}-page`).classList.add('active');

    // Load page data
    switch (pageName) {
        case 'home':
            loadDashboardStats();
            break;
        case 'events':
            loadEvents();
            break;
        case 'attendance':
            loadAttendance();
            break;
        case 'leaderboard':
            loadLeaderboard();
            break;
        case 'announcements':
            loadAnnouncements();
            break;
        case 'polls':
            loadMemberPolls();
            break;
        case 'my-project':
            loadMyProject();
            break;
        case 'messages':
            loadMessages();
            break;
        case 'gallery':
            loadGallery();
            break;
        case 'certificates':
            loadCertificates();
            break;
        case 'profile':
            loadProfile();
            break;
        case 'settings':
            loadSettings();
            break;
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
}

// Load Dashboard
async function loadDashboard() {
    await loadDashboardStats();
}

async function loadDashboardStats() {
    try {
        const [dashResponse, leaderboardResponse, attendanceResponse] = await Promise.all([
            fetch(`${API_URL}/member/dashboard`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            fetch(`${API_URL}/member/leaderboard`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            fetch(`${API_URL}/member/attendance`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
        ]);

        // Check for HTTP errors
        if (!dashResponse.ok) throw new Error(`Dashboard: ${dashResponse.status} ${dashResponse.statusText}`);
        if (!leaderboardResponse.ok) throw new Error(`Leaderboard: ${leaderboardResponse.status} ${leaderboardResponse.statusText}`);
        if (!attendanceResponse.ok) throw new Error(`Attendance: ${attendanceResponse.status} ${attendanceResponse.statusText}`);

        const dashData = await dashResponse.json();
        const leaderData = await leaderboardResponse.json();
        const attendanceData = await attendanceResponse.json();

        if (dashData.success) {
            const dash = dashData.dashboard;

            console.log('🔍 Dashboard data:', dash);
            console.log('📋 hasNoClub:', dash.hasNoClub, 'status:', dash.status);

            // Check if member has no club
            if (dash.hasNoClub === true || dash.status === 'unassigned') {
                console.log('⚠️ Member has no club - showing empty state');

                // Hide dashboard content and show no-club message
                const homePage = document.getElementById('home-page');
                const dashboardContent = document.getElementById('dashboard-content');

                if (homePage) {
                    homePage.innerHTML = `
                            <div style="text-align: center; padding: 60px 20px; color: #6b7280;">
                                <i class="fa-solid fa-users-slash" style="font-size: 64px; margin-bottom: 20px; color: #d1d5db;"></i>
                                <h2 style="color: #374151; margin-bottom: 10px;">No Club Assigned</h2>
                                <p style="font-size: 16px; margin-bottom: 5px;">Your profile has been created successfully!</p>
                                <p style="font-size: 14px;">Wait for the club owner to add you to a club using your Student ID.</p>
                                <div style="margin-top: 30px; padding: 20px; background: #f9fafb; border-radius: 12px; max-width: 500px; margin-left: auto; margin-right: auto;">
                                    <p style="margin: 0; font-size: 14px; color: #6b7280;">
                                        <strong>Your Student ID:</strong> <span id="yourStudentId" style="color: #374151; font-family: monospace; font-size: 18px; font-weight: bold;"></span>
                                    </p>
                                    <p style="margin: 10px 0 0 0; font-size: 13px; color: #9ca3af;">
                                        Share this Student ID with your club owner to get added.
                                    </p>
                                </div>
                            </div>
                        `;
                    // Load student ID
                    loadStudentId();
                }
                setDashboardLoading(false);
                return;
            }

            console.log('✅ Member has club - showing dashboard');

            // Member has a club - show dashboard content
            const dashboardContent = document.getElementById('dashboard-content');
            if (dashboardContent) {
                dashboardContent.style.display = 'block';
            }

            // Member has a club - ensure home-page has proper structure
            const homePage = document.getElementById('home-page');
            if (homePage && homePage.innerHTML.includes('Loading your dashboard')) {
                // Remove loading state - find the first div that contains the spinner
                const loadingDivs = homePage.querySelectorAll('div');
                loadingDivs.forEach(div => {
                    if (div.innerHTML.includes('fa-spinner') || div.innerHTML.includes('Loading your dashboard')) {
                        div.remove();
                    }
                });
            }

            if (homePage && homePage.innerHTML.includes('No Club Assigned')) {
                // Reload the page structure if it was replaced
                location.reload();
                return;
            }

            // Update modern stats cards
            if (dash.totalPoints !== undefined) {
                document.getElementById('memberPoints').textContent = dash.totalPoints;
            } else {
                document.getElementById('memberPoints').textContent = dash.points;
            }

            document.getElementById('memberRank').textContent = dash.rank;
            document.getElementById('attendancePercent').textContent = dash.attendancePercentage + '%';

            // Sidebar mini stats
            if (document.getElementById('sidebarPoints')) {
                document.getElementById('sidebarPoints').textContent = dash.totalPoints !== undefined ? dash.totalPoints : dash.points;
            }
            document.getElementById('sidebarRank').textContent = dash.rank;

            // Attendance breakdown
            if (attendanceData.success) {
                const attendedCount = attendanceData.attendance.length;
                const totalEvents = dash.totalEvents || 0;
                document.getElementById('attendedEvents').textContent = attendedCount;
                document.getElementById('totalEventsCount').textContent = totalEvents > 0 ? totalEvents : attendedCount;
            }

            // Rank progress bar
            const rankProgress = {
                'Rookie': 20,
                'Bronze': 40,
                'Silver': 60,
                'Gold': 80,
                'Platinum': 100
            };
            document.getElementById('rankProgress').style.width = (rankProgress[dash.rank] || 20) + '%';

            // Leaderboard position
            if (leaderData.success) {
                const userPosition = leaderData.leaderboard.findIndex(u => u.isCurrentUser) + 1;
                document.getElementById('leaderboardPosition').textContent = userPosition || '-';
            }

            // Update upcoming event (modern card)
            const upcomingCard = document.getElementById('upcomingEventsList');
            if (dash.upcomingEvent) {
                const event = dash.upcomingEvent;
                upcomingCard.innerHTML = `
                        <div class="event-card-modern">
                            <div class="event-card-header">
                                <div class="event-date-badge">
                                    <div class="event-date-day">${new Date(event.date).getDate()}</div>
                                    <div class="event-date-month">${new Date(event.date).toLocaleString('default', { month: 'short' })}</div>
                                </div>
                                <div class="event-card-info">
                                    <h3 style="margin: 0 0 8px 0; font-size: 18px; color: #1f2937;">${event.title}</h3>
                                    <p style="margin: 0; color: #6b7280; font-size: 14px;">
                                        <i class="fa-solid fa-location-dot"></i> ${event.venue}
                                    </p>
                                </div>
                            </div>
                            <button onclick="navigateTo('events')" class="btn-primary" style="width: 100%; margin-top: 15px;">
                                <i class="fa-solid fa-calendar-check"></i> View Event Details
                            </button>
                        </div>
                    `;
            } else {
                upcomingCard.innerHTML = `
                        <div class="empty-state">
                            <i class="fa-solid fa-calendar-xmark"></i>
                            <p>No upcoming events</p>
                        </div>
                    `;
            }

            // Recent Activity (last 3 attendance records)
            const recentActivity = document.getElementById('recentActivity');
            if (attendanceData.success && attendanceData.attendance.length > 0) {
                const recent = attendanceData.attendance.slice(0, 3);
                recentActivity.innerHTML = recent.map(att => `
                        <div class="activity-item">
                            <div class="activity-icon">
                                <i class="fa-solid fa-check"></i>
                            </div>
                            <div class="activity-content">
                                <h4>Attended: ${att.eventTitle}</h4>
                                <p>${new Date(att.timestamp).toLocaleDateString()} at ${new Date(att.timestamp).toLocaleTimeString()}</p>
                            </div>
                        </div>
                    `).join('');
            } else {
                recentActivity.innerHTML = `
                        <div class="empty-state">
                            <i class="fa-solid fa-inbox"></i>
                            <p>No recent activity</p>
                        </div>
                    `;
            }
            setDashboardLoading(false);
        } else {
            throw new Error(dashData.message || 'Failed to load dashboard data');
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}

// Load Events
async function loadEvents() {
    try {
        const response = await fetch(`${API_URL}/member/events`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const grid = document.getElementById('eventsGrid');

            if (data.events.length === 0) {
                grid.innerHTML = '<p class="loading">No events yet</p>';
                return;
            }

            grid.innerHTML = data.events.map(event => {
                const d = new Date(event.date);
                const day = d.getDate();
                const month = d.toLocaleString('default', { month: 'short' });
                const isPast = d < new Date(Date.now() - 86400000);

                // Determine RSVP button state
                let rsvpButton;
                if (event.hasRsvped) {
                    rsvpButton = `<button class="btn-event-action btn-rsvped" disabled>
                        <i class="fa-solid fa-check-circle"></i> RSVP'd
                    </button>`;
                } else if (isPast) {
                    rsvpButton = `<button class="btn-event-action btn-past" disabled>
                        <i class="fa-solid fa-clock"></i> Closed
                    </button>`;
                } else {
                    rsvpButton = `<button class="btn-event-action btn-rsvp" onclick="rsvpEvent(${event.id})">
                        <i class="fa-solid fa-calendar-check"></i> RSVP
                    </button>`;
                }

                // Determine Attendance button state
                let attendanceButton;
                if (event.hasAttended) {
                    attendanceButton = `<button class="btn-event-action btn-attended" disabled>
                        <i class="fa-solid fa-check-double"></i> Attended
                    </button>`;
                } else if (isPast) {
                    attendanceButton = `<button class="btn-event-action btn-past" disabled>
                        <i class="fa-solid fa-ban"></i> Missed
                    </button>`;
                } else {
                    attendanceButton = `<button class="btn-event-action btn-scan" onclick="openQRScanner()">
                        <i class="fa-solid fa-qrcode"></i> Mark Attendance
                    </button>`;
                }

                return `
                <div class="event-card">
                    <div class="event-card-header">
                        <div class="event-date-badge ${isPast ? 'past' : ''}">
                            <div class="event-date-day">${day}</div>
                            <div class="event-date-month">${month}</div>
                        </div>
                        <div>
                            <h3>${event.title}</h3>
                            <p><i class="fa-solid fa-location-dot"></i> ${event.venue}</p>
                        </div>
                    </div>
                    <div class="event-card-body">
                        <p><i class="fa-solid fa-align-left"></i> ${event.description || 'No description'}</p>
                        <p><i class="fa-solid fa-users"></i> ${event.attendedCount || 0} Attended</p>
                    </div>
                    <div class="event-card-footer">
                        ${rsvpButton}
                        ${attendanceButton}
                    </div>
                </div>`;
            }).join('');
        }
    } catch (error) {
        console.error('Error loading events:', error);
        showNotification('Failed to load events', 'error');
    }
}

// RSVP for Event
async function rsvpEvent(eventId) {
    try {
        const response = await fetch(`${API_URL}/member/rsvp`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ eventId })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            loadEvents();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error RSVPing:', error);
        showNotification('Failed to RSVP', 'error');
    }
}

// QR Scanner with Camera
let html5QrCode = null;

function openQRScanner() {
    const modal = document.getElementById('qrScannerModal');
    modal.classList.add('active');

    // Start camera scanner using existing HTML structure
    setTimeout(() => {
        const qrReaderElement = document.getElementById('qrReader');
        if (!qrReaderElement) {
            console.error('qrReader element not found');
            return;
        }

        // Clear any previous content
        qrReaderElement.innerHTML = '';

        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("qrReader");
        }

        html5QrCode.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            (decodedText) => {
                // Check if it's a new token format (contains a dot separator for signature)
                if (decodedText && decodedText.includes('.')) {
                    showNotification('QR Code detected!', 'success');
                    markAttendanceWithToken(decodedText);
                } else {
                    // Try legacy format - JSON with eventId
                    try {
                        const qrData = JSON.parse(decodedText);
                        if (qrData.eventId) {
                            showNotification('QR Code detected!', 'success');
                            markAttendanceLegacy(qrData.eventId);
                        }
                    } catch (e) {
                        // Try as plain event ID (very old format)
                        if (!isNaN(decodedText)) {
                            markAttendanceLegacy(parseInt(decodedText));
                        } else {
                            showNotification('Invalid QR code format', 'error');
                        }
                    }
                }
            },
            (errorMessage) => {
                // Silent - scanning
            }
        ).catch(err => {
            console.error('Camera error:', err);
            // Show code-only mode if camera fails
            const qrReader = document.getElementById('qrReader');
            if (qrReader) {
                qrReader.innerHTML = `
                    <div style="padding: 40px; text-align: center; background: #f9fafb; border-radius: 12px;">
                        <i class="fa-solid fa-camera-slash" style="font-size: 48px; color: #d1d5db; margin-bottom: 15px;"></i>
                        <p style="color: #6b7280; margin: 0;">Camera not available</p>
                        <p style="color: #9ca3af; font-size: 14px; margin-top: 5px;">Use the code entry below</p>
                    </div>
                `;
            }
        });
    }, 100);
}

function closeQRScanner() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode = null;
        }).catch(err => {
            console.error('Error stopping scanner:', err);
            html5QrCode = null;
        });
    }
    document.getElementById('qrScannerModal').classList.remove('active');
}

/**
 * Generate a device hash for anti-cheat (simple device fingerprint)
 */
function generateDeviceHash() {
    try {
        const userId = localStorage.getItem('userId') || 'unknown';
        const userAgent = navigator.userAgent || '';
        const screenWidth = window.screen.width || 0;
        const screenHeight = window.screen.height || 0;
        const fingerprint = `${userId}|${userAgent}|${screenWidth}|${screenHeight}`;

        // Simple hash using btoa (base64) - for production, use proper SHA256
        return btoa(fingerprint).substring(0, 32);
    } catch (e) {
        console.warn('Could not generate device hash:', e);
        return null;
    }
}

/**
 * Mark attendance using new token-based system
 */
async function markAttendanceWithToken(qrToken) {
    const statusEl = document.getElementById('scanningStatus');
    if (statusEl) statusEl.style.display = 'block';

    try {
        const deviceHash = generateDeviceHash();

        const response = await fetch(`${API_URL}/attendance/scan`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token: qrToken, deviceHash })
        });

        const data = await response.json();

        if (data.success) {
            const timeStr = data.checkedInAt ? new Date(data.checkedInAt).toLocaleTimeString() : '';
            const lateMsg = data.isLate ? ' (Late)' : '';
            showNotification(`${data.message}${lateMsg} at ${timeStr}`, 'success');
            closeQRScanner();
            loadDashboardStats();
            loadAttendance();
        } else {
            showNotification(data.message || 'Failed to mark attendance', 'error');
            if (statusEl) statusEl.style.display = 'none';
        }
    } catch (error) {
        console.error('Error marking attendance:', error);
        showNotification('Failed to mark attendance. Please try again.', 'error');
        if (statusEl) statusEl.style.display = 'none';
    }
}

/**
 * Format code input - add space after 3rd character for readability
 */
function formatCodeInput(input) {
    let value = input.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (value.length > 3) {
        value = value.substring(0, 3) + ' ' + value.substring(3, 7);
    }
    input.value = value;
}

// Flag to prevent double submission
let isSubmittingCode = false;

/**
 * Submit 7-digit attendance code
 */
async function submitAttendanceCode() {
    // Prevent double submission
    if (isSubmittingCode) return;

    const input = document.getElementById('attendanceCodeInput');
    if (!input) return;

    // Remove space and get clean code
    const code = input.value.replace(/\s/g, '').toUpperCase();

    if (code.length !== 7) {
        showNotification('Please enter a valid 7-character code', 'error');
        return;
    }

    isSubmittingCode = true;
    const statusEl = document.getElementById('scanningStatus');
    if (statusEl) statusEl.style.display = 'block';

    try {
        const deviceHash = generateDeviceHash();

        const response = await fetch(`${API_URL}/attendance/scan-code`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code, deviceHash })
        });

        const data = await response.json();

        if (data.success) {
            const timeStr = data.checkedInAt ? new Date(data.checkedInAt).toLocaleTimeString() : '';
            const lateMsg = data.isLate ? ' (Late)' : '';
            showNotification(`${data.message}${lateMsg}${timeStr ? ' at ' + timeStr : ''}`, 'success');
            isSubmittingCode = false;
            closeQRScanner();
            loadDashboardStats();
            loadAttendance();
            loadEvents(); // Refresh events to update button states
        } else {
            showNotification(data.message || 'Invalid code', 'error');
            if (statusEl) statusEl.style.display = 'none';
            isSubmittingCode = false;
        }
    } catch (error) {
        console.error('Error submitting code:', error);
        showNotification('Failed to submit code. Please try again.', 'error');
        if (statusEl) statusEl.style.display = 'none';
        isSubmittingCode = false;
    }
}

/**
 * Legacy attendance marking (for old event ID based QR codes)
 */
async function markAttendanceLegacy(eventId) {
    if (!eventId) {
        showNotification('Please enter Event ID', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/member/scan-attendance`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ eventId })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            closeQRScanner();
            loadDashboardStats();
            loadAttendance();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error marking attendance:', error);
        showNotification('Failed to mark attendance', 'error');
    }
}

// Keep old function for backward compatibility
async function markAttendanceFromScanner(eventIdParam) {
    const eventId = eventIdParam || parseInt(document.getElementById('manualEventId')?.value);
    markAttendanceLegacy(eventId);
}

// Removed - using markAttendanceFromScanner instead

// Load Attendance
async function loadAttendance() {
    try {
        const response = await fetch(`${API_URL}/member/attendance`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'Failed to load attendance');
        }

        const attendance = Array.isArray(data.attendance) ? data.attendance : [];

        const totalAttendedEl = document.getElementById('totalAttended');
        if (totalAttendedEl) {
            totalAttendedEl.textContent = attendance.length;
        }

        const totalEvents = typeof data.totalEvents === 'number' ? data.totalEvents : attendance.length;
        const rate = totalEvents > 0 ? Math.round((attendance.length / totalEvents) * 100) : 0;

        const percentTextEl = document.getElementById('attendancePercentText');
        if (percentTextEl) {
            percentTextEl.textContent = `${rate}%`;
        }

        const circleFill = document.getElementById('attendanceCircleFill');
        if (circleFill) {
            circleFill.setAttribute('stroke-dasharray', `${rate}, 100`);
        }

        const totalMissedEl = document.getElementById('totalMissed');
        if (totalMissedEl) {
            const missed = typeof data.missedCount === 'number'
                ? data.missedCount
                : Math.max(totalEvents - attendance.length, 0);
            totalMissedEl.textContent = missed;
        }

        const currentStreakEl = document.getElementById('currentStreak');
        if (currentStreakEl) {
            currentStreakEl.textContent = typeof data.currentStreak === 'number' ? data.currentStreak : 0;
        }

        const historyBody = document.getElementById('attendanceHistory');
        if (!historyBody) return;

        if (attendance.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="5" class="loading">No attendance records yet</td></tr>';
            return;
        }

        historyBody.innerHTML = attendance.map(record => {
            const eventDate = record.eventDate ? new Date(record.eventDate) : null;
            const checkIn = record.timestamp ? new Date(record.timestamp) : null;
            const statusText = record.status ? record.status : 'present';
            return `
                <tr>
                    <td>${record.eventTitle || 'Unknown Event'}</td>
                    <td>${eventDate ? eventDate.toLocaleDateString() : '-'}</td>
                    <td>${checkIn ? checkIn.toLocaleTimeString() : '-'}</td>
                    <td>${statusText}</td>
                    <td>-</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading attendance:', error);
        showNotification('Failed to load attendance', 'error');
    }
}

// Load Leaderboard
async function loadLeaderboard() {
    try {
        const response = await fetch(`${API_URL}/member/leaderboard`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const leaderboard = data.leaderboard;

            // 1. Update Podium (Top 3)
            updatePodium(leaderboard);

            // 2. Update Your Position Card
            updateYourPositionCard(leaderboard);

            // 3. Update Table
            const tbody = document.getElementById('leaderboardTable');
            if (leaderboard.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="loading">No members yet</td></tr>';
                return;
            }

            tbody.innerHTML = leaderboard.map(member => `
                <tr ${member.isCurrentUser ? 'style="background: var(--primary-light); font-weight: 600;"' : ''}>
                    <td>${member.rank}</td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div class="table-avatar" style="width: 32px; height: 32px; border-radius: 50%; background: var(--gray-200); display: flex; align-items: center; justify-content: center; overflow: hidden;">
                                ${member.profilePic
                    ? `<img src="${member.profilePic}" style="width: 100%; height: 100%; object-fit: cover;">`
                    : `<i class="fa-solid fa-user" style="color: var(--gray-500); font-size: 14px;"></i>`}
                            </div>
                            <span>${member.username} ${member.isCurrentUser ? '(You)' : ''}</span>
                        </div>
                    </td>
                    <td style="font-weight: 600; color: var(--primary-color);">${member.points} pts</td>
                    <td>${member.eventsAttended || 0}</td>
                    <td><span class="rank-badge ${member.rankTitle.toLowerCase()}">${member.rankTitle}</span></td>
                </tr>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading leaderboard:', error);
        showNotification('Failed to load leaderboard', 'error');
    }
}

function updatePodium(leaderboard) {
    const podium1 = document.getElementById('podium1');
    const podium2 = document.getElementById('podium2');
    const podium3 = document.getElementById('podium3');

    // Helper to fill podium slot
    const fillSlot = (element, member) => {
        if (!element) return;
        if (member) {
            element.querySelector('.podium-name').textContent = member.username;
            element.querySelector('.podium-points').textContent = `${member.points} pts`;
            const img = element.querySelector('img');
            if (member.profilePic) {
                img.src = member.profilePic;
                img.style.display = 'block';
            } else {
                // Determine color based on rank for fallback avatar background
                const colors = ['#f59e0b', '#6366f1', '#10b981']; // Gold, Purple, Green
                const rankIdx = member.rank - 1;

                // Use a colored placeholder if no image
                img.style.display = 'none';
                let avatarDiv = element.querySelector('.podium-avatar-placeholder');
                if (!avatarDiv) {
                    avatarDiv = document.createElement('div');
                    avatarDiv.className = 'podium-avatar-placeholder';
                    avatarDiv.style.width = '100%';
                    avatarDiv.style.height = '100%';
                    avatarDiv.style.display = 'flex'; // Ensure flex
                    avatarDiv.style.alignItems = 'center';
                    avatarDiv.style.justifyContent = 'center';
                    avatarDiv.style.borderRadius = '50%';
                    avatarDiv.style.background = `var(--gradient-${rankIdx === 0 ? 'orange' : rankIdx === 1 ? 'purple' : 'green'})`;
                    avatarDiv.innerHTML = `<i class="fa-solid fa-user" style="color: white; font-size: 20px;"></i>`;
                    element.querySelector('.podium-avatar').appendChild(avatarDiv);
                    // Hide the img tag so it doesn't take space/show broken icon
                    element.querySelector('.podium-avatar img').style.display = 'none';
                }
            }
        } else {
            element.querySelector('.podium-name').textContent = '-';
            element.querySelector('.podium-points').textContent = '-';
        }
    };

    fillSlot(podium1, leaderboard[0]);
    fillSlot(podium2, leaderboard[1]);
    fillSlot(podium3, leaderboard[2]);
}

function updateYourPositionCard(leaderboard) {
    const currentUser = leaderboard.find(m => m.isCurrentUser);
    const container = document.getElementById('yourPositionCard');

    if (currentUser && container) {
        document.getElementById('yourRankPosition').textContent = currentUser.rank;
        document.getElementById('yourTotalPoints').textContent = currentUser.points;
        document.getElementById('yourRankTitle').textContent = currentUser.rankTitle;

        // Calculate points to next user
        const currentIndex = leaderboard.indexOf(currentUser);
        let pointsNeed = 0;
        if (currentIndex > 0) {
            const nextUser = leaderboard[currentIndex - 1];
            pointsNeed = nextUser.points - currentUser.points;
        }
        document.getElementById('pointsBehind').textContent = pointsNeed > 0 ? pointsNeed : 'Leader!';
    } else if (container) {
        container.style.display = 'none';
    }
}

// Load Announcements
async function loadAnnouncements() {
    try {
        const response = await fetch(`${API_URL}/member/announcements`, {
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

            list.innerHTML = '<div style="background: #fff; padding: 25px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.08);">' +
                data.announcements.map(announcement => `
                    <div class="announcement-item">
                        <h4>${announcement.title}</h4>
                        <p>${announcement.message}</p>
                        <div class="date">
                            <i class="fa-solid fa-clock"></i>
                            ${new Date(announcement.date).toLocaleString()}
                        </div>
                    </div>
                `).join('') + '</div>';
        }
    } catch (error) {
        console.error('Error loading announcements:', error);
        showNotification('Failed to load announcements', 'error');
    }
}

// Load Polls (Member)
async function loadMemberPolls() {
    const list = document.getElementById('memberPollsList');
    if (!list) return;
    list.innerHTML = '<p class="loading">Loading polls...</p>';
    try {
        const response = await fetch(`${API_URL}/member/polls`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) {
            list.innerHTML = '<p class="loading">Failed to load polls.</p>';
            return;
        }
        const polls = data.polls || [];
        if (polls.length === 0) {
            list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-pie"></i><p>No polls yet. Check back later!</p></div>';
            return;
        }
        list.innerHTML = polls.map(poll => renderMemberPollCard(poll)).join('');
    } catch (error) {
        console.error('Error loading polls:', error);
        list.innerHTML = '<p class="loading">Failed to load polls.</p>';
        showNotification('Failed to load polls', 'error');
    }
}

function escapeHtmlPoll(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderMemberPollCard(poll) {
    const total = poll.totalVotes || 0;
    const canVote = poll.status === 'active' && poll.userVotedOptionId == null;
    const options = poll.options || [];

    if (canVote) {
        const optionsHtml = options.map(opt => `
            <label class="poll-option-label" style="display: flex; align-items: center; gap: 10px; padding: 12px; border: 2px solid #e5e7eb; border-radius: 8px; margin-bottom: 8px; cursor: pointer;">
                <input type="radio" name="poll_${poll.id}" value="${opt.id}">
                <span>${escapeHtmlPoll(opt.text)}</span>
            </label>
        `).join('');
        return `
            <div class="poll-card member-poll" data-poll-id="${poll.id}" style="background: #fff; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); padding: 20px; margin-bottom: 16px;">
                <h4 style="margin: 0 0 12px 0;">${escapeHtmlPoll(poll.question)}</h4>
                <span style="background: #10b981; color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 12px;">Active</span>
                <div class="poll-options" style="margin: 16px 0;">${optionsHtml}</div>
                <button type="button" class="btn-primary" onclick="submitMemberVote(${poll.id})">
                    <i class="fa-solid fa-check"></i> Submit Vote
                </button>
            </div>`;
    }

    const optionsResultsHtml = options.map(opt => {
        const pct = total > 0 ? Math.round((opt.voteCount / total) * 100) : 0;
        const isUserChoice = opt.id === poll.userVotedOptionId;
        return `
            <div class="poll-option-result" style="margin: 8px 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span>${escapeHtmlPoll(opt.text)} ${isUserChoice ? '<i class="fa-solid fa-check" style="color: #10b981;"></i>' : ''}</span>
                    <span>${opt.voteCount} (${pct}%)</span>
                </div>
                <div style="height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: ${pct}%; background: ${isUserChoice ? '#10b981' : '#3b82f6'}; border-radius: 4px;"></div>
                </div>
            </div>`;
    }).join('');
    const statusBadge = poll.status === 'closed' ? '<span style="background: #6b7280; color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 12px;">Closed</span>' : '<span style="background: #10b981; color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 12px;">Active</span>';
    return `
        <div class="poll-card member-poll" data-poll-id="${poll.id}" style="background: #fff; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); padding: 20px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h4 style="margin: 0;">${escapeHtmlPoll(poll.question)}</h4>
                ${statusBadge}
            </div>
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 12px 0;"><i class="fa-solid fa-chart-pie"></i> ${total} total vote(s)</p>
            <div class="poll-results">${optionsResultsHtml}</div>
        </div>`;
}

async function submitMemberVote(pollId) {
    const container = document.querySelector(`.member-poll[data-poll-id="${pollId}"]`);
    const radio = container ? container.querySelector(`input[name="poll_${pollId}"]:checked`) : null;
    if (!radio) {
        showNotification('Please select an option first!', 'error');
        return;
    }
    const optionId = parseInt(radio.value, 10);
    try {
        const response = await fetch(`${API_URL}/member/polls/${pollId}/vote`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ optionId })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Vote recorded!', 'success');
            loadMemberPolls();
        } else {
            showNotification(data.message || 'Could not submit vote', 'error');
        }
    } catch (error) {
        console.error('Error voting:', error);
        showNotification('Failed to submit vote', 'error');
    }
}

// ========== MY PROJECT - MODERN REDESIGN ==========
let allProjectIdeas = [];
let activeProjects = []; // Changed from single to array
let currentPage = 1;
const projectsPerPage = 6;
const MAX_PROJECTS = 3; // Maximum projects a member can select

async function loadMyProject() {
    const content = document.getElementById('myProjectContent');
    const browseSection = document.getElementById('browseProjectIdeasSection');
    const ideasList = document.getElementById('projectIdeasListMember');

    if (!content) return;

    content.innerHTML = '<p class="loading">Loading...</p>';
    if (browseSection) browseSection.style.display = 'none';

    try {
        const [myResp, ideasResp] = await Promise.all([
            fetch(`${API_URL}/member/my-projects`, { headers: { 'Authorization': `Bearer ${token}` }, cache: 'no-store' }),
            fetch(`${API_URL}/member/project-ideas`, { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        const myData = await myResp.json();
        const ideasData = await ideasResp.json();

        // Handle both old single project and new multiple projects format
        if (myData.memberProjects && Array.isArray(myData.memberProjects)) {
            activeProjects = myData.memberProjects;
        } else if (myData.memberProject) {
            // Fallback for old single project format
            activeProjects = [myData.memberProject];
        } else {
            activeProjects = [];
        }

        allProjectIdeas = ideasData.projectIdeas || [];

        // Render active projects section
        renderActiveProjects(content);

        // Render browse section with search and filters
        if (allProjectIdeas.length > 0) {
            browseSection.style.display = 'block';
            renderProjectBrowser(ideasList);
        }

    } catch (error) {
        console.error('Error loading my project:', error);
        content.innerHTML = '<p class="loading">Failed to load.</p>';
        showNotification('Failed to load', 'error');
    }
}

function renderActiveProjects(content) {
    if (activeProjects.length === 0) {
        content.innerHTML = `
            <div class="project-empty-state">
                <div class="empty-icon-wrapper">
                    <i class="fa-solid fa-rocket"></i>
                </div>
                <h3>Start Your Journey!</h3>
                <p>Browse project ideas below to add your first project.</p>
            </div>
        `;
        return;
    }

    const slotsRemaining = MAX_PROJECTS - activeProjects.length;

    content.innerHTML = `
        <div class="active-projects-header">
            <div class="header-info">
                <h2><i class="fa-solid fa-diagram-project"></i> My Active Projects</h2>
                <span class="projects-count">${activeProjects.length}/${MAX_PROJECTS} Projects</span>
            </div>
            ${slotsRemaining > 0 ? `<p class="slots-info"><i class="fa-solid fa-info-circle"></i> You can add ${slotsRemaining} more project${slotsRemaining > 1 ? 's' : ''}</p>` : '<p class="slots-info full"><i class="fa-solid fa-check-circle"></i> All project slots filled</p>'}
        </div>
        
        <div class="active-projects-grid">
            ${activeProjects.map(project => renderProjectCard(project)).join('')}
        </div>
    `;

    // Attach event listeners for all forms
    activeProjects.forEach(project => {
        const form = document.getElementById(`projectForm${project.id}`);
        if (form) {
            form.addEventListener('submit', (e) => submitProjectProgress(e, project.id));
        }
    });
}

function renderProjectCard(project) {
    const title = project.projectTitleSnapshot || 'My project';
    const desc = project.projectDescriptionSnapshot || '';
    const status = project.status || 'not_started';
    const pct = project.progressPercent != null ? project.progressPercent : 0;
    const approvalStatus = project.approvalStatus;
    const startedAt = project.startedAt ? new Date(project.startedAt).toLocaleDateString() : '-';

    let statusBadge = '';
    let statusColor = '#6b7280';
    let statusIcon = 'fa-circle';

    if (status === 'completed') {
        statusColor = '#10b981';
        statusIcon = 'fa-check-circle';
        statusBadge = 'Completed';
    } else if (status === 'in_progress') {
        statusColor = '#f59e0b';
        statusIcon = 'fa-spinner';
        statusBadge = 'In Progress';
    } else {
        statusBadge = 'Not Started';
    }

    let approvalBadge = '';
    if (status === 'completed') {
        if (approvalStatus === 'approved') {
            approvalBadge = '<span class="approval-badge approved"><i class="fa-solid fa-check"></i> Approved</span>';
        } else if (approvalStatus === 'pending') {
            approvalBadge = '<span class="approval-badge pending"><i class="fa-solid fa-clock"></i> Pending</span>';
        } else if (approvalStatus === 'rejected') {
            approvalBadge = '<span class="approval-badge rejected"><i class="fa-solid fa-times"></i> Rejected</span>';
        }
    }

    return `
        <div class="active-project-card">
            <div class="project-card-header">
                <div class="project-title-section">
                    <h3>${escapeHtmlPoll(title)}</h3>
                    <span class="status-badge" style="background: ${statusColor}20; color: ${statusColor};">
                        <i class="fa-solid ${statusIcon}"></i> ${statusBadge}
                    </span>
                </div>
                <button class="btn-remove-project" onclick="confirmRemoveProject(${project.id}, '${escapeHtmlPoll(title)}')" title="Remove Project">
                    <i class="fa-solid fa-trash-alt"></i>
                </button>
            </div>
            
            ${approvalBadge}
            ${desc ? `<p class="project-description">${escapeHtmlPoll(desc)}</p>` : ''}
            
            <div class="project-meta-compact">
                <span><i class="fa-solid fa-calendar-alt"></i> ${startedAt}</span>
                <span><i class="fa-solid fa-chart-line"></i> ${pct}%</span>
            </div>
            
            <div class="progress-section-compact">
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${pct}%"></div>
                </div>
                <span class="progress-text">${pct}%</span>
            </div>
            
            <div class="quick-update-section">
                <button class="btn-expand-update" onclick="toggleUpdateForm(${project.id})">
                    <i class="fa-solid fa-pen-to-square"></i> Update Progress
                    <i class="fa-solid fa-chevron-down expand-icon"></i>
                </button>
                
                <div class="update-form-container" id="updateForm${project.id}" style="display: none;">
                    <form id="projectForm${project.id}" class="progress-form-compact">
                        <div class="form-row-compact">
                            <div class="form-group-compact">
                                <label>Status</label>
                                <select id="projectStatus${project.id}" class="form-select-compact">
                                    <option value="not_started"${status === 'not_started' ? ' selected' : ''}>Not Started</option>
                                    <option value="in_progress"${status === 'in_progress' ? ' selected' : ''}>In Progress</option>
                                    <option value="completed"${status === 'completed' ? ' selected' : ''}>Completed</option>
                                </select>
                            </div>
                            <div class="form-group-compact">
                                <label>Progress %</label>
                                <input type="number" id="projectPercent${project.id}" min="0" max="100" value="${pct}" class="form-input-compact">
                            </div>
                        </div>
                        <button type="submit" class="btn-save-compact">
                            <i class="fa-solid fa-save"></i> Save
                        </button>
                    </form>
                </div>
            </div>
        </div>
    `;
}

function toggleUpdateForm(projectId) {
    const form = document.getElementById(`updateForm${projectId}`);
    const button = event.currentTarget;
    const icon = button.querySelector('.expand-icon');

    if (form.style.display === 'none') {
        form.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
        button.classList.add('expanded');
    } else {
        form.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        button.classList.remove('expanded');
    }
}

function confirmRemoveProject(projectId, projectTitle) {
    // Create beautiful confirmation modal
    const modal = document.createElement('div');
    modal.className = 'remove-project-modal';
    modal.innerHTML = `
        <div class="modal-overlay" onclick="closeRemoveModal()"></div>
        <div class="modal-content remove-modal-content">
            <div class="modal-icon warning">
                <i class="fa-solid fa-exclamation-triangle"></i>
            </div>
            <h3>Remove Project?</h3>
            <p>Are you sure you want to remove <strong>"${projectTitle}"</strong> from your active projects?</p>
            <p class="warning-text">Your progress will be saved, but you'll need to re-select it to continue working.</p>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="closeRemoveModal()">
                    <i class="fa-solid fa-times"></i> Cancel
                </button>
                <button class="btn-confirm-remove" onclick="removeProject(${projectId})">
                    <i class="fa-solid fa-trash-alt"></i> Remove Project
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
}

function closeRemoveModal() {
    const modal = document.querySelector('.remove-project-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

async function removeProject(projectId) {
    try {
        const response = await fetch(`${API_URL}/member/remove-project/${projectId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Project removed successfully!', 'success');
            closeRemoveModal();
            loadMyProject();
        } else {
            showNotification(data.message || 'Failed to remove project', 'error');
        }
    } catch (error) {
        console.error('Error removing project:', error);
        showNotification('Failed to remove project', 'error');
    }
}

function renderProjectBrowser(container) {
    // Filter out already selected projects
    const selectedProjectIds = activeProjects.map(p => p.projectIdeaId);
    const availableProjects = allProjectIdeas.filter(idea => !selectedProjectIds.includes(idea.id));

    const canAddMore = activeProjects.length < MAX_PROJECTS;

    if (!canAddMore) {
        container.innerHTML = `
            <div class="no-projects-message slots-full">
                <i class="fa-solid fa-check-double"></i>
                <h4>All Project Slots Filled!</h4>
                <p>You're working on ${MAX_PROJECTS} projects. Remove a project to add a new one.</p>
            </div>
        `;
        return;
    }

    if (availableProjects.length === 0) {
        container.innerHTML = `
            <div class="no-projects-message">
                <i class="fa-solid fa-inbox"></i>
                <p>No more projects available to select</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="project-browser">
            <div class="browser-header">
                <div class="search-filter-bar">
                    <div class="search-box-project">
                        <i class="fa-solid fa-search"></i>
                        <input type="text" id="projectSearchInput" placeholder="Search projects..." onkeyup="filterProjects()">
                    </div>
                    <div class="project-count-badge">
                        <i class="fa-solid fa-lightbulb"></i>
                        <span id="projectCount">${availableProjects.length}</span> Available
                    </div>
                </div>
            </div>
            
            <div class="projects-grid" id="projectsGrid"></div>
            
            <div class="pagination-controls" id="paginationControls"></div>
        </div>
    `;

    renderProjectCards(availableProjects);
}

function filterProjects() {
    const searchTerm = document.getElementById('projectSearchInput').value.toLowerCase();
    const selectedProjectIds = activeProjects.map(p => p.projectIdeaId);
    const availableProjects = allProjectIdeas.filter(idea => !selectedProjectIds.includes(idea.id));

    const filtered = availableProjects.filter(idea =>
        idea.title.toLowerCase().includes(searchTerm) ||
        (idea.description && idea.description.toLowerCase().includes(searchTerm))
    );

    document.getElementById('projectCount').textContent = filtered.length;
    renderProjectCards(filtered);
}

function renderProjectCards(projects) {
    const grid = document.getElementById('projectsGrid');
    const paginationControls = document.getElementById('paginationControls');

    if (projects.length === 0) {
        grid.innerHTML = `
            <div class="no-results">
                <i class="fa-solid fa-search"></i>
                <p>No projects found matching your search</p>
            </div>
        `;
        paginationControls.innerHTML = '';
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(projects.length / projectsPerPage);
    const startIndex = (currentPage - 1) * projectsPerPage;
    const endIndex = startIndex + projectsPerPage;
    const paginatedProjects = projects.slice(startIndex, endIndex);

    // Render cards
    grid.innerHTML = paginatedProjects.map(idea => `
        <div class="project-idea-card">
            <div class="card-icon">
                <i class="fa-solid fa-lightbulb"></i>
            </div>
            <h3 class="card-title">${escapeHtmlPoll(idea.title)}</h3>
            ${idea.description ? `<p class="card-description">${escapeHtmlPoll(idea.description)}</p>` : '<p class="card-description text-muted">No description provided</p>'}
            <button class="btn-choose-project" onclick="chooseProject(${idea.id})">
                <i class="fa-solid fa-plus-circle"></i> Add to My Projects
            </button>
        </div>
    `).join('');

    // Render pagination
    if (totalPages > 1) {
        let paginationHTML = '<div class="pagination">';

        paginationHTML += `
            <button class="page-btn ${currentPage === 1 ? 'disabled' : ''}" 
                    onclick="changePage(${currentPage - 1})" 
                    ${currentPage === 1 ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-left"></i>
            </button>
        `;

        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
                paginationHTML += `
                    <button class="page-btn ${i === currentPage ? 'active' : ''}" 
                            onclick="changePage(${i})">
                        ${i}
                    </button>
                `;
            } else if (i === currentPage - 2 || i === currentPage + 2) {
                paginationHTML += '<span class="page-dots">...</span>';
            }
        }

        paginationHTML += `
            <button class="page-btn ${currentPage === totalPages ? 'disabled' : ''}" 
                    onclick="changePage(${currentPage + 1})" 
                    ${currentPage === totalPages ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        `;

        paginationHTML += '</div>';
        paginationControls.innerHTML = paginationHTML;
    } else {
        paginationControls.innerHTML = '';
    }
}

function changePage(page) {
    const selectedProjectIds = activeProjects.map(p => p.projectIdeaId);
    const availableProjects = allProjectIdeas.filter(idea => !selectedProjectIds.includes(idea.id));
    const totalPages = Math.ceil(availableProjects.length / projectsPerPage);

    if (page < 1 || page > totalPages) return;

    currentPage = page;
    filterProjects();

    document.getElementById('projectsGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function chooseProject(projectIdeaId) {
    // Check if already at max
    if (activeProjects.length >= MAX_PROJECTS) {
        showNotification(`You can only have ${MAX_PROJECTS} active projects. Remove one first.`, 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/member/choose-project`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectIdeaId })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Project added successfully!', 'success');
            await loadMyProject();
            const content = document.getElementById('myProjectContent');
            if (content) content.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else showNotification(data.message || 'Could not choose', 'error');
    } catch (error) {
        console.error('Error choosing project:', error);
        showNotification('Failed to choose project', 'error');
    }
}

async function submitProjectProgress(e, projectId) {
    e.preventDefault();

    const status = document.getElementById(`projectStatus${projectId}`).value;
    const progressPercent = parseInt(document.getElementById(`projectPercent${projectId}`).value, 10);

    if (progressPercent < 0 || progressPercent > 100) {
        showNotification('Progress must be between 0-100', 'error');
        return;
    }

    if (progressPercent === 100 && status !== 'completed') {
        showNotification('If progress is 100%, status must be Completed', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/member/update-project/${projectId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status, progressPercent })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Progress updated successfully!', 'success');
            loadMyProject();
        } else {
            showNotification(data.message || 'Failed to update progress', 'error');
        }
    } catch (error) {
        console.error('Error updating project progress:', error);
        showNotification('Failed to update progress', 'error');
    }
}

async function submitMyProjectProgress(e) {
    e.preventDefault();
    const status = document.getElementById('myProjectStatus').value;
    const progressPercent = parseInt(document.getElementById('myProjectPercent').value, 10);
    if (progressPercent < 0 || progressPercent > 100) {
        showNotification('Progress must be 0-100', 'error');
        return;
    }
    if (progressPercent === 100 && status !== 'completed') {
        showNotification('If progress is 100%, status must be Completed', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_URL}/member/my-project/progress`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, progressPercent })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Progress updated!', 'success');
            loadMyProject();
        } else showNotification(data.message || 'Could not update', 'error');
    } catch (error) {
        console.error('Error updating progress:', error);
        showNotification('Failed to update', 'error');
    }
}

// Load Gallery
async function loadGallery() {
    try {
        const response = await fetch(`${API_URL}/member/events`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const container = document.getElementById('galleryGrid');

            if (!container) {
                console.error('Gallery container not found!');
                return;
            }

            if (data.events.length === 0) {
                container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-images"></i><h3>No Events Yet</h3><p>Photos will appear here after events.</p></div>';
                return;
            }

            container.innerHTML = data.events.map(event => `
                <section class="gallery-section">
                    <div class="gallery-section-header">
                        <div>
                            <h3 class="gallery-section-title">${escapeHtml(event.title || 'Event')}</h3>
                            <p class="gallery-section-subtitle">${new Date(event.date).toLocaleDateString()}</p>
                        </div>
                    </div>
                    <div id="gallery-${event.id}" class="gallery-section-grid">
                        <div class="gallery-loading">Loading photos...</div>
                    </div>
                </section>
            `).join('');

            // Load photos for each event
            data.events.forEach(event => loadEventGallery(event.id));
        }
    } catch (error) {
        console.error('Error loading gallery:', error);
        showNotification('Failed to load gallery', 'error');
    }
}

async function loadEventGallery(eventId) {
    try {
        const response = await fetch(`${API_URL}/gallery/${eventId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        const galleryDiv = document.getElementById(`gallery-${eventId}`);

        if (data.success && data.photos.length > 0) {
            galleryDiv.innerHTML = data.photos.map(photo => `
                <div class="gallery-photo-card" onclick="viewPhoto('${photo.fullUrl}')">
                    <img src="${photo.fullUrl}" alt="Event photo">
                    <div class="gallery-photo-overlay">
                        <span>View</span>
                    </div>
                </div>
            `).join('');
        } else {
            galleryDiv.innerHTML = '<p class="gallery-loading">No photos yet</p>';
        }
    } catch (error) {
        console.error('Error loading event gallery:', error);
    }
}

function viewPhoto(url) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px;">
            <div class="modal-header">
                <h3>Photo</h3>
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body" style="padding: 0;">
                <img src="${url}" style="width: 100%; height: auto; border-radius: 0 0 12px 12px;">
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Load Student ID for display
async function loadStudentId() {
    try {
        const response = await fetch(`${API_URL}/member/profile`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        if (data.success && data.profile) {
            const studentIdElement = document.getElementById('yourStudentId');
            if (studentIdElement) {
                studentIdElement.textContent = data.profile.studentId || 'N/A';
            }
        }
    } catch (error) {
        console.error('Error loading student ID:', error);
    }
}

// Global profile data
let currentUserProfile = null;

// Load Profile
async function loadProfile() {
    try {
        const response = await fetch(`${API_URL}/member/profile?t=${Date.now()}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            currentUserProfile = data.profile; // Store for editing
            const profile = data.profile;

            // Update Display Elements (Text Content)
            const displayNameEl = document.getElementById('profileDisplayName');
            if (displayNameEl) displayNameEl.textContent = profile.username;

            const usernameEl = document.getElementById('profileUsername');
            if (usernameEl) usernameEl.textContent = '@' + profile.username;

            const studentIdEl = document.getElementById('profileStudentId');
            if (studentIdEl) studentIdEl.textContent = profile.studentId || '-';

            const emailEl = document.getElementById('profileEmail');
            if (emailEl) emailEl.textContent = profile.email || '-';

            const bioEl = document.getElementById('profileBioDisplay');
            if (bioEl) bioEl.textContent = profile.bio || 'No bio added yet.';

            const phoneEl = document.getElementById('profilePhone');
            if (phoneEl) phoneEl.textContent = profile.phone || 'Not provided';

            const deptEl = document.getElementById('profileDepartment');
            if (deptEl) deptEl.textContent = profile.department || 'Not provided';

            // Update stats
            const pointsEl = document.getElementById('profilePoints'); // Keep points logic
            if (pointsEl) {
                // Use total points if available
                pointsEl.textContent = profile.totalPoints !== undefined ? profile.totalPoints : (profile.points || 0);
            }

            const rankEl = document.getElementById('profileRankBadge');
            if (rankEl) {
                rankEl.textContent = profile.rank || 'Rookie';
                rankEl.className = `badge badge-rank ${profile.rank ? profile.rank.toLowerCase() : 'rookie'}`;
            }

            const eventsEl = document.getElementById('profileEvents');
            if (eventsEl) eventsEl.textContent = profile.stats?.totalEvents || 0;

            const certsEl = document.getElementById('profileCerts');
            // Certificates count might need a separate call or be added to profile API
            // For now, leave as 0 or fetch from certificates list if loaded

            // Update profile picture
            const preview = document.getElementById('profilePicPreview');
            const placeholder = document.querySelector('.profile-avatar i');

            if (profile.profilePic) {
                const fullUrl = getFullImageUrl(profile.profilePic);

                if (preview) {
                    preview.src = fullUrl;
                    preview.style.display = 'block';
                }
                if (placeholder) placeholder.style.display = 'none';

                // ALSO UPDATE NAVBAR AND DROPDOWN Aatars
                const navImg = document.getElementById('navUserImg');
                if (navImg) {
                    navImg.src = fullUrl;
                    navImg.style.display = 'block';
                    const icon = navImg.nextElementSibling;
                    if (icon && icon.tagName === 'I') icon.style.display = 'none';
                }

                const dropdownImg = document.getElementById('dropdownUserImg');
                if (dropdownImg) {
                    dropdownImg.src = fullUrl;
                    dropdownImg.style.display = 'block';
                    const icon = dropdownImg.nextElementSibling;
                    if (icon && icon.tagName === 'I') icon.style.display = 'none';
                }
            }

            // Populate Profile Clubs List
            const clubsListEl = document.getElementById('profileClubsList');
            if (clubsListEl) {
                if (profile.clubStats && profile.clubStats.length > 0) {
                    clubsListEl.innerHTML = profile.clubStats.map(club => `
                        <div class="club-stat-item" style="display: flex; align-items: center; gap: 15px; padding: 10px; border-bottom: 1px solid #eee; margin-bottom: 5px;">
                            <div class="club-stat-icon" style="width: 40px; height: 40px; background: #f3f4f6; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #4f46e5;">
                                ${club.logo ? `<img src="${club.logo}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">` : '<i class="fa-solid fa-building"></i>'}
                            </div>
                            <div class="club-stat-info">
                                <h4 style="margin: 0; font-size: 16px; color: #1f2937;">${club.name}</h4>
                                <p style="margin: 2px 0 0 0; font-size: 13px; color: #6b7280;">${club.rank} • ${club.points} pts</p>
                            </div>
                        </div>
                    `).join('');
                } else {
                    clubsListEl.innerHTML = '<p style="color: #9ca3af; text-align: center; padding: 20px;">No clubs joined yet.</p>';
                }
            }

            // Load Profile Achievements
            loadProfileAchievements();

        }
    } catch (error) {
        console.error('Error loading profile:', error);
        showNotification('Failed to load profile', 'error');
    }
}

// Separate function to load achievements on profile page
async function loadProfileAchievements() {
    const container = document.getElementById('profileAchievements');
    if (!container) return;

    try {
        const response = await fetch(`${API_URL}/member/achievements`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.success && data.achievements && data.achievements.length > 0) {
            container.innerHTML = data.achievements.map(ach => `
                <div class="achievement-item ${ach.unlocked ? '' : 'locked'}" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px; margin-bottom: 10px;">
                    <div class="achievement-icon" style="min-width: 40px; height: 40px; border-radius: 50%; background: ${ach.unlocked ? '#ecfdf5' : '#f3f4f6'}; display: flex; align-items: center; justify-content: center; color: ${ach.unlocked ? '#10b981' : '#9ca3af'}; font-size: 18px;">
                        <i class="${ach.icon}"></i>
                    </div>
                    <div class="achievement-info">
                        <h4 style="margin: 0; font-size: 15px; color: ${ach.unlocked ? '#1f2937' : '#9ca3af'};">${ach.title}</h4>
                        <p style="margin: 2px 0 0 0; font-size: 12px; color: #6b7280;">${ach.description}</p>
                    </div>
                    ${ach.unlocked ? '<i class="fa-solid fa-check-circle" style="margin-left: auto; color: #10b981;"></i>' : '<i class="fa-solid fa-lock" style="margin-left: auto; color: #d1d5db;"></i>'}
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p style="color: #9ca3af; text-align: center; padding: 20px;">No achievements yet.</p>';
        }
    } catch (error) {
        console.error('Error loading profile achievements:', error);
        container.innerHTML = '<p class="error-text">Failed to load achievements</p>';
    }
}

// Update Profile
document.addEventListener('DOMContentLoaded', () => {
    // Initialize profile editing
    setupProfileEditing();

    // Profile picture upload
    const profilePicInput = document.getElementById('profilePicInput');
    if (profilePicInput) {
        profilePicInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('profilePic', file);

            try {
                const response = await fetch(`${API_URL}/member/upload-profile-pic`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });

                const data = await response.json();

                if (data.success) {
                    showNotification('Profile picture updated!', 'success');
                    const preview = document.getElementById('profilePicPreview');
                    const placeholder = document.querySelector('.profile-avatar i');
                    const fullUrl = getFullImageUrl(data.profilePic);

                    if (preview) {
                        preview.src = fullUrl;
                        preview.style.display = 'block';
                    }
                    if (placeholder) placeholder.style.display = 'none';

                    // Update global profile pic
                    if (currentUserProfile) currentUserProfile.profilePic = fullUrl;

                    const navImg = document.getElementById('navUserImg');
                    if (navImg) {
                        navImg.src = fullUrl;
                        navImg.style.display = 'block';
                        const icon = navImg.nextElementSibling;
                        if (icon && icon.tagName === 'I') icon.style.display = 'none';
                    }

                    const dropdownImg = document.getElementById('dropdownUserImg');
                    if (dropdownImg) {
                        dropdownImg.src = fullUrl;
                        dropdownImg.style.display = 'block';
                        const icon = dropdownImg.nextElementSibling;
                        if (icon && icon.tagName === 'I') icon.style.display = 'none';
                    }
                } else {
                    showNotification(data.message, 'error');
                }
            } catch (error) {
                console.error('Error uploading profile pic:', error);
                showNotification('Failed to upload profile picture', 'error');
            }
        });
    }
});

function setupProfileEditing() {
    const editForm = document.getElementById('editProfileForm');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const displayName = document.getElementById('editDisplayName').value;
            const bio = document.getElementById('editBio').value;
            const phone = document.getElementById('editPhone').value;
            const department = document.getElementById('editDepartment').value;
            // Get email from global profile since we might not want to edit it here or it's read-only
            // If email editing is allowed:
            // const email = document.getElementById('editEmail')?.value;

            try {
                const response = await fetch(`${API_URL}/member/update-profile`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    // Include email if needed, ensuring it doesn't clear if not passed
                    body: JSON.stringify({ username: displayName, bio, phone, department })
                    // Note: If you want to update email, add it to the body.
                });

                const data = await response.json();

                if (data.success) {
                    showNotification('Profile updated successfully!', 'success');
                    closeEditProfileModal();

                    // Immediate DOM update
                    const bioEl = document.getElementById('profileBioDisplay');
                    if (bioEl) bioEl.textContent = bio || 'No bio added yet.';

                    const phoneEl = document.getElementById('profilePhone');
                    if (phoneEl) phoneEl.textContent = phone || 'Not provided';

                    const deptEl = document.getElementById('profileDepartment');
                    if (deptEl) deptEl.textContent = department || 'Not provided';

                    await loadProfile(); // Reload to sync
                } else {
                    showNotification(data.message, 'error');
                }
            } catch (error) {
                console.error('Error updating profile:', error);
                showNotification('Failed to update profile', 'error');
            }
        });
    }
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

// ===== CERTIFICATE MANAGEMENT =====

// Load Certificates
async function loadCertificates() {
    try {
        const response = await fetch(`${API_URL}/member/certificates`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        const grid = document.getElementById('certificatesGrid');

        if (data.success && data.certificates.length > 0) {
            grid.innerHTML = data.certificates.map(cert => {
                const title = escapeHtml(cert.title || 'Certificate');
                const clubName = escapeHtml(cert.clubName || '');
                const eventTitle = cert.eventTitle ? escapeHtml(cert.eventTitle) : '';
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
                        ? `<i class="fa-solid fa-file-pdf" style="font-size: 64px; color: #ef4444;"></i>`
                        : `<img src="${cert.filepath}" alt="${title}">`
                    }
                        </div>
                        <div class="certificate-info">
                            <h3>${title}</h3>
                            <div class="certificate-meta">
                                ${clubName ? `<span><i class="fa-solid fa-building"></i> ${clubName}</span>` : ''}
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
                    const title = card.getAttribute('data-title') || 'Certificate';
                    const fileUrl = card.getAttribute('data-file') || '';
                    const fileType = card.getAttribute('data-type') || '';
                    if (fileUrl) openCertificateView(title, fileUrl, fileType);
                });
            });

            grid.querySelectorAll('.certificate-delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const certId = btn.getAttribute('data-cert-id');
                    if (certId) deleteCertificate(certId);
                });
            });
        } else {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-certificate"></i>
                    <p>No certificates uploaded yet</p>
                    <button class="btn-primary" onclick="showUploadCertificateModal()">
                        <i class="fa-solid fa-upload"></i> Upload Your First Certificate
                    </button>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading certificates:', error);
        showNotification('Failed to load certificates', 'error');
    }
}

function openCertificateView(title, fileUrl, fileType) {
    const modal = document.getElementById('certificateViewModal');
    const titleEl = document.getElementById('certViewTitle');
    const content = document.getElementById('certificateViewContent');
    const downloadBtn = document.getElementById('downloadCertBtn');
    const type = (fileType || '').toLowerCase();

    if (titleEl) titleEl.textContent = title || 'Certificate';
    if (content) {
        content.innerHTML = type === 'pdf'
            ? `<iframe src="${fileUrl}" style="width: 100%; height: 70vh; border: none; border-radius: 12px;"></iframe>`
            : `<img src="${fileUrl}" style="width: 100%; height: auto; border-radius: 12px;">`;
    }
    if (downloadBtn) {
        downloadBtn.onclick = () => window.open(fileUrl, '_blank');
    }
    modal?.classList.add('active');
}

// Show upload certificate modal
async function showUploadCertificateModal() {
    document.getElementById('uploadCertificateModal').classList.add('active');

    // Load user's clubs for dropdown
    try {
        const response = await fetch(`${API_URL}/member/my-clubs`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        const clubSelect = document.getElementById('certClub');
        if (data.success && data.clubs.length > 0) {
            clubSelect.innerHTML = '<option value="">Choose a club...</option>' +
                data.clubs.map(club => `<option value="${club.id}">${club.name}</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading clubs:', error);
    }
}

// Close upload certificate modal
function closeUploadCertificateModal() {
    document.getElementById('uploadCertificateModal').classList.remove('active');
    document.getElementById('uploadCertificateForm').reset();
}

// Load club events for certificate
async function loadClubEventsForCert() {
    const clubId = document.getElementById('certClub').value;
    const eventSelect = document.getElementById('certEvent');

    if (!clubId) {
        eventSelect.innerHTML = '<option value="">Choose an event...</option>';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/member/events`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const clubEvents = data.events.filter(e => e.clubId === parseInt(clubId));
            eventSelect.innerHTML = '<option value="">Choose an event...</option>' +
                clubEvents.map(event => `<option value="${event.id}">${event.title} - ${new Date(event.date).toLocaleDateString()}</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading events:', error);
    }
}

// Upload certificate form submission
document.getElementById('uploadCertificateForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData();
    formData.append('title', document.getElementById('certTitle').value);
    formData.append('clubId', document.getElementById('certClub').value);
    formData.append('eventId', document.getElementById('certEvent').value || '');
    formData.append('issueDate', document.getElementById('certIssueDate').value || '');
    formData.append('description', document.getElementById('certDescription').value || '');
    formData.append('certificate', document.getElementById('certFile').files[0]);

    try {
        const response = await fetch(`${API_URL}/member/upload-certificate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            closeUploadCertificateModal();
            loadCertificates();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error uploading certificate:', error);
        showNotification('Failed to upload certificate', 'error');
    }
});

// Delete certificate
async function deleteCertificate(certId) {
    if (!confirm('Are you sure you want to delete this certificate?')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/member/certificate/${certId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            loadCertificates();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error deleting certificate:', error);
        showNotification('Failed to delete certificate', 'error');
    }
}

// ========== NOTIFICATIONS ==========
async function loadNotifications() {
    try {
        const response = await fetch(`${API_URL}/notifications`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            updateNotificationBadge(data.unreadCount || 0);

            // Show notification modal (create if doesn't exist)
            let modal = document.getElementById('notificationsModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'notificationsModal';
                modal.className = 'modal';
                modal.innerHTML = `
                    <div class="modal-content" style="max-width: 500px;">
                        <div class="modal-header">
                            <h3><i class="fa-solid fa-bell"></i> Notifications</h3>
                            <button class="modal-close" onclick="closeNotificationsModal()">&times;</button>
                        </div>
                        <div class="modal-body" id="notificationsList" style="max-height: 400px; overflow-y: auto;">
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }

            const list = document.getElementById('notificationsList');
            if (list) {
                if (data.notifications.length === 0) {
                    list.innerHTML = '<p class="loading">No notifications</p>';
                } else {
                    list.innerHTML = data.notifications.map(notif => `
                        <div class="notification-item ${!notif.read ? 'unread' : ''}" 
                             onclick="markNotificationRead(${notif.id})">
                            <div style="display: flex; justify-content: space-between; align-items: start; padding: 15px; border-bottom: 1px solid #e5e7eb;">
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

            modal.classList.add('active');
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

function closeNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function markNotificationRead(notifId) {
    try {
        await fetch(`${API_URL}/notifications/${notifId}/read`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        loadNotifications();
    } catch (error) {
        console.error('Error marking notification as read:', error);
    }
}

// ========== MESSAGES (IMPROVED: LOADING STATES, ERROR HANDLING, MEMORY MANAGEMENT) ==========
let currentChatRecipient = null;
let messageRefreshInterval = null;
let isLoadingMessages = false;

async function loadMessages() {
    // Prevent multiple simultaneous loads
    if (isLoadingMessages) return;
    isLoadingMessages = true;

    try {
        const contactsResponse = await fetch(`${API_URL}/messages/contacts`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!contactsResponse.ok) {
            throw new Error(`HTTP ${contactsResponse.status}`);
        }

        const contactsData = await contactsResponse.json();

        let modal = document.getElementById('messagesModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'messagesModal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 700px;">
                    <div class="modal-header">
                        <h3><i class="fa-solid fa-envelope"></i> Messages with Club Owner</h3>
                        <button class="modal-close" onclick="closeMessagesModal()">&times;</button>
                    </div>
                    <div class="modal-body" style="padding: 0;">
                        <div id="chatMessages" style="height: 400px; overflow-y: auto; padding: 20px; background: #f9fafb;">
                            <div class="loading-spinner" style="text-align: center; padding: 40px;">
                                <i class="fa-solid fa-spinner fa-spin" style="font-size: 32px; color: #3b82f6;"></i>
                                <p style="margin-top: 10px; color: #6b7280;">Loading messages...</p>
                            </div>
                        </div>
                        <div style="padding: 15px; border-top: 1px solid #e5e7eb; background: white;">
                            <form id="sendMessageForm" style="display: flex; gap: 10px;">
                                <input type="text" id="messageInput" placeholder="Type your message..." 
                                       style="flex: 1; padding: 10px; border: 1px solid #e5e7eb; border-radius: 8px;"
                                       required maxlength="1000">
                                <button type="submit" class="btn-primary" id="sendMessageBtn">
                                    <i class="fa-solid fa-paper-plane"></i> Send
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            document.getElementById('sendMessageForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                await sendMessage();
            });
        }

        if (contactsData.success && contactsData.contacts.length > 0) {
            currentChatRecipient = contactsData.contacts[0];
            await loadChatHistory();
            startRealTimeUpdates();
        } else {
            document.getElementById('chatMessages').innerHTML = `
                <div style="text-align: center; color: #9ca3af; padding: 60px 20px;">
                    <i class="fa-solid fa-user-slash" style="font-size: 48px; margin-bottom: 15px;"></i>
                    <p>You need to be part of a club to message</p>
                </div>
            `;
        }

        const totalUnread = contactsData.contacts.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
        updateMessageBadge(totalUnread);
        modal.classList.add('active');
    } catch (error) {
        console.error('Error loading messages:', error);
        showNotification('Failed to load messages. Please try again.', 'error');

        // Show error in modal if it exists
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            chatMessages.innerHTML = `
                <div style="text-align: center; color: #ef4444; padding: 60px 20px;">
                    <i class="fa-solid fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 15px;"></i>
                    <p>Failed to load messages</p>
                    <button onclick="loadMessages()" class="btn-primary" style="margin-top: 15px;">
                        <i class="fa-solid fa-refresh"></i> Retry
                    </button>
                </div>
            `;
        }
    } finally {
        isLoadingMessages = false;
    }
}

// VIEW HISTORY
async function loadChatHistory() {
    if (!currentChatRecipient) return;

    try {
        const response = await fetch(`${API_URL}/messages?recipientId=${currentChatRecipient.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const chatMessages = document.getElementById('chatMessages');

        if (data.success && data.messages.length > 0) {
            const userId = JSON.parse(atob(token.split('.')[1])).id;
            chatMessages.innerHTML = data.messages.map(msg => {
                const isSent = msg.senderId === userId;
                return `
                    <div style="display: flex; justify-content: ${isSent ? 'flex-end' : 'flex-start'}; margin-bottom: 12px;">
                        <div style="max-width: 70%; padding: 10px 14px; border-radius: 12px; background: ${isSent ? '#3b82f6' : '#fff'}; color: ${isSent ? '#fff' : '#1f2937'}; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                            <p style="margin: 0; font-size: 14px;">${msg.message}</p>
                            <p style="margin: 4px 0 0 0; font-size: 10px; opacity: 0.7; text-align: right;">
                                ${new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                        </div>
                    </div>
                `;
            }).join('');
            chatMessages.scrollTop = chatMessages.scrollHeight;

            // Mark as read
            data.messages.forEach(msg => {
                if (msg.recipientId === userId && !msg.read) {
                    fetch(`${API_URL}/messages/${msg.id}/read`, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                }
            });
        } else {
            chatMessages.innerHTML = `
                <div style="text-align: center; color: #9ca3af; padding: 60px 20px;">
                    <i class="fa-solid fa-comment-dots" style="font-size: 48px; margin-bottom: 15px;"></i>
                    <p>No messages yet. Start the conversation!</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading chat:', error);
    }
}

// SEND (with loading state and better error handling)
async function sendMessage() {
    if (!currentChatRecipient) return;

    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendMessageBtn');
    const message = messageInput.value.trim();

    if (!message) return;

    // Disable input during send
    messageInput.disabled = true;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

    try {
        const response = await fetch(`${API_URL}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipientId: currentChatRecipient.id,
                message: message,
                type: 'direct'
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.success) {
            messageInput.value = '';
            await loadChatHistory(); // RECEIVE - reload to show sent message
            showNotification('Message sent!', 'success');
        } else {
            showNotification(data.message || 'Failed to send message', 'error');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showNotification('Failed to send message. Check your connection.', 'error');
    } finally {
        // Re-enable input
        messageInput.disabled = false;
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send';
        messageInput.focus();
    }
}

// REAL-TIME UPDATES (with proper cleanup)
function startRealTimeUpdates() {
    stopRealTimeUpdates(); // Clear any existing interval
    messageRefreshInterval = setInterval(() => {
        if (document.getElementById('messagesModal')?.classList.contains('active')) {
            loadChatHistory();
        } else {
            // Stop polling if modal is closed
            stopRealTimeUpdates();
        }
    }, 3000); // Check every 3 seconds
}

function stopRealTimeUpdates() {
    if (messageRefreshInterval) {
        clearInterval(messageRefreshInterval);
        messageRefreshInterval = null;
        console.log('⏹️ Stopped real-time updates');
    }
}

function updateMessageBadge(count) {
    const badge = document.getElementById('messageBadge');
    if (badge) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
}

function closeMessagesModal() {
    const modal = document.getElementById('messagesModal');
    if (modal) modal.classList.remove('active');
    stopRealTimeUpdates(); // Properly stop polling
    currentChatRecipient = null;
}

// Clean up on page unload (prevent memory leaks)
window.addEventListener('beforeunload', () => {
    stopRealTimeUpdates();
});

// Offline/Online detection
window.addEventListener('offline', () => {
    showNotification('⚠️ You are offline. Messages will be sent when you reconnect.', 'warning');
    stopRealTimeUpdates();
});

window.addEventListener('online', () => {
    showNotification('✅ Back online!', 'success');
    // Reload messages if modal is open
    if (document.getElementById('messagesModal')?.classList.contains('active')) {
        loadChatHistory();
        startRealTimeUpdates();
    }
});

// Close modals when clicking outside (backdrop)
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        const modalId = e.target.id;

        // Handle specific modals that need cleanup functions
        if (modalId === 'qrScannerModal') {
            closeQRScanner();
        } else if (modalId === 'messagesModal') {
            closeMessagesModal();
        } else if (modalId === 'notificationsModal') {
            closeNotificationsModal();
        } else if (modalId === 'uploadCertificateModal') {
            closeUploadCertificateModal();
        } else {
            // For other modals (like dynamic photo viewer), just close/remove them
            e.target.classList.remove('active');

            // If it was a dynamic modal without ID (like photo view), remove from DOM
            if (!modalId) {
                e.target.remove();
            }
        }
    }
});

// Initialize
verifyAuth();

// ========== PRELOADER ==========
// ========== PRELOADER ==========
// Preloader is now managed by verifyAuth() to ensure no content is shown before auth check
function hidePreloader() {
    const preloader = document.getElementById('preloader');
    if (preloader) {
        preloader.classList.add('hidden');
    }
    // Show dashboard content after preloader
    const dashboardContent = document.getElementById('dashboard-content');
    const homeLoader = document.getElementById('homeLoader');
    if (homeLoader) {
        homeLoader.style.display = 'none';
    }
    if (dashboardContent) {
        dashboardContent.style.display = 'block';
    }
}

// ========== THEME TOGGLE ==========
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
    // Check saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });
}

function updateThemeIcon(theme) {
    const icon = themeToggle?.querySelector('i');
    if (icon) {
        icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
}

// ========== GLOBAL SEARCH ==========
const globalSearchBtn = document.getElementById('globalSearchBtn');
const searchModal = document.getElementById('searchModal');
const globalSearchInput = document.getElementById('globalSearchInput');

if (globalSearchBtn && searchModal) {
    globalSearchBtn.addEventListener('click', () => {
        searchModal.classList.add('active');
        globalSearchInput?.focus();
    });

    // Close on click outside
    searchModal.addEventListener('click', (e) => {
        if (e.target === searchModal) {
            searchModal.classList.remove('active');
        }
    });

    // Close on ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchModal.classList.contains('active')) {
            searchModal.classList.remove('active');
        }
    });

    // Search functionality
    if (globalSearchInput) {
        globalSearchInput.addEventListener('input', debounce(async (e) => {
            const query = e.target.value.trim();
            const resultsContainer = document.getElementById('searchResults');

            if (query.length < 2) {
                resultsContainer.innerHTML = `
                    <div class="search-empty">
                        <i class="fa-solid fa-search"></i>
                        <p>Start typing to search...</p>
                    </div>
                `;
                return;
            }

            resultsContainer.innerHTML = `
                <div class="loading-spinner">
                    <div class="spinner"></div>
                    <p>Searching...</p>
                </div>
            `;

            try {
                const response = await fetch(`${API_URL}/member/search?q=${encodeURIComponent(query)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();

                if (data.success && data.results.length > 0) {
                    resultsContainer.innerHTML = data.results.map(item => `
                        <div class="search-result-item" onclick="handleSearchResult('${item.type}', ${item.id})">
                            <div class="search-result-icon">
                                <i class="fa-solid fa-${getSearchIcon(item.type)}"></i>
                            </div>
                            <div class="search-result-content">
                                <h4>${item.title}</h4>
                                <p>${item.description || item.type}</p>
                            </div>
                        </div>
                    `).join('');
                } else {
                    resultsContainer.innerHTML = `
                        <div class="search-empty">
                            <i class="fa-solid fa-search"></i>
                            <p>No results found for "${query}"</p>
                        </div>
                    `;
                }
            } catch (error) {
                console.error('Search error:', error);
                resultsContainer.innerHTML = `
                    <div class="search-empty">
                        <i class="fa-solid fa-search"></i>
                        <p>Search for events, announcements...</p>
                    </div>
                `;
            }
        }, 300));
    }
}

function getSearchIcon(type) {
    const icons = {
        event: 'calendar',
        announcement: 'bullhorn',
        member: 'user',
        certificate: 'certificate'
    };
    return icons[type] || 'file';
}

function handleSearchResult(type, id) {
    searchModal?.classList.remove('active');
    switch (type) {
        case 'event':
            navigateTo('events');
            break;
        case 'announcement':
            navigateTo('announcements');
            break;
        case 'member':
            navigateTo('members');
            break;
        default:
            break;
    }
}

// Debounce utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ========== NOTIFICATION DROPDOWN ==========
const notificationBell = document.getElementById('notificationBell');
const notificationWrapper = document.querySelector('.notification-wrapper');

if (notificationBell && notificationWrapper) {
    notificationBell.addEventListener('click', async (e) => {
        e.stopPropagation();
        notificationWrapper.classList.toggle('active');
        if (notificationWrapper.classList.contains('active')) {
            await loadNotificationDropdown();
        }
    });
}

async function loadNotificationDropdown() {
    const list = document.getElementById('notificationList');
    if (!list) return;

    list.innerHTML = '<p style="text-align: center; padding: 20px; color: #9ca3af;">Loading...</p>';

    try {
        const response = await fetch(`${API_URL}/notifications`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.success && data.notifications && data.notifications.length > 0) {
            list.innerHTML = data.notifications.slice(0, 5).map(notif => `
                <div class="notification-item ${!notif.read ? 'unread' : ''}" onclick="markNotificationRead(${notif.id})">
                    <div class="notification-icon ${notif.type || 'event'}">
                        <i class="fa-solid fa-${getNotifIcon(notif.type)}"></i>
                    </div>
                    <div class="notification-content">
                        <p class="notification-title">${notif.title}</p>
                        <p class="notification-text">${notif.message?.substring(0, 50) || ''}...</p>
                        <span class="notification-time">${formatTimeAgo(notif.createdAt)}</span>
                    </div>
                </div>
            `).join('');
        } else {
            list.innerHTML = '<p style="text-align: center; padding: 30px; color: #9ca3af;">No notifications</p>';
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
        list.innerHTML = '<p style="text-align: center; padding: 20px; color: #ef4444;">Failed to load</p>';
    }
}

function getNotifIcon(type) {
    const icons = {
        event: 'calendar-check',
        announcement: 'bullhorn',
        achievement: 'trophy'
    };
    return icons[type] || 'bell';
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

// ========== USER MENU DROPDOWN ==========
const userMenuBtn = document.getElementById('userMenuBtn');
const userMenu = document.querySelector('.user-menu');

if (userMenuBtn && userMenu) {
    userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenu.classList.toggle('active');
        // Close notifications if open
        notificationWrapper?.classList.remove('active');
    });
}

// Close dropdowns on outside click
document.addEventListener('click', () => {
    notificationWrapper?.classList.remove('active');
    userMenu?.classList.remove('active');
});

// ========== MODALS ==========
function closeEventModal() {
    document.getElementById('eventDetailsModal')?.classList.remove('active');
}

function closeCertificateView() {
    document.getElementById('certificateViewModal')?.classList.remove('active');
}

function closeEditProfileModal() {
    document.getElementById('editProfileModal')?.classList.remove('active');
}

function closeNewMessageModal() {
    document.getElementById('newMessageModal')?.classList.remove('active');
}

function openNewMessageModal() {
    document.getElementById('newMessageModal')?.classList.add('active');
}

function closeLightbox() {
    document.getElementById('imageLightbox')?.classList.remove('active');
}

function closeConfirmDialog() {
    document.getElementById('confirmDialog')?.classList.remove('active');
}

function confirmDeleteAccount() {
    const dialog = document.getElementById('confirmDialog');
    const confirmBtn = document.getElementById('confirmBtn');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmIcon = document.getElementById('confirmIcon');

    if (confirmTitle) confirmTitle.textContent = 'Delete Account?';
    if (confirmMessage) confirmMessage.textContent = 'This action cannot be undone. All your data will be permanently deleted.';
    if (confirmIcon) confirmIcon.innerHTML = '<i class="fa-solid fa-trash"></i>';
    if (confirmIcon) confirmIcon.className = 'confirm-icon danger';

    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            try {
                const response = await fetch(`${API_URL}/member/delete-account`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();
                if (data.success) {
                    showNotification('Account deleted successfully', 'success');
                    localStorage.removeItem('token');
                    setTimeout(() => window.location.href = 'index.html', 2000);
                } else {
                    showNotification(data.message || 'Failed to delete account', 'error');
                }
            } catch (error) {
                showNotification('Failed to delete account', 'error');
            }
            closeConfirmDialog();
        };
    }

    dialog?.classList.add('active');
}

// ========== SETTINGS PAGE ==========
const settingsMenu = document.querySelectorAll('.settings-menu li');
const settingsSections = document.querySelectorAll('.settings-section');

settingsMenu.forEach(item => {
    item.addEventListener('click', () => {
        const target = item.getAttribute('data-settings');

        settingsMenu.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        settingsSections.forEach(section => {
            section.classList.remove('active');
            if (section.id === target + '-settings') {
                section.classList.add('active');
            }
        });
    });
});

// Theme options in settings
const themeOptions = document.querySelectorAll('.theme-option');
themeOptions.forEach(option => {
    option.addEventListener('click', () => {
        themeOptions.forEach(o => o.classList.remove('active'));
        option.classList.add('active');

        const theme = option.getAttribute('data-theme');
        if (theme === 'auto') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
        localStorage.setItem('theme', theme);
        updateThemeIcon(theme);
    });
});

// Color options
const colorOptions = document.querySelectorAll('.color-option');
colorOptions.forEach(option => {
    option.addEventListener('click', () => {
        colorOptions.forEach(o => o.classList.remove('active'));
        option.classList.add('active');

        const color = option.getAttribute('data-color');
        const colorMap = {
            blue: '#3b82f6',
            purple: '#8b5cf6',
            green: '#10b981',
            orange: '#f59e0b',
            pink: '#ec4899'
        };
        document.documentElement.style.setProperty('--primary-color', colorMap[color]);
        localStorage.setItem('accentColor', color);
    });
});

// Load saved accent color
const savedColor = localStorage.getItem('accentColor');
if (savedColor) {
    const colorMap = {
        blue: '#3b82f6',
        purple: '#8b5cf6',
        green: '#10b981',
        orange: '#f59e0b',
        pink: '#ec4899'
    };
    document.documentElement.style.setProperty('--primary-color', colorMap[savedColor]);
    colorOptions.forEach(o => {
        o.classList.remove('active');
        if (o.getAttribute('data-color') === savedColor) o.classList.add('active');
    });
}

// ========== FAQ ACCORDION ==========
const faqItems = document.querySelectorAll('.faq-item');
faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question?.addEventListener('click', () => {
        const isActive = item.classList.contains('active');
        faqItems.forEach(i => i.classList.remove('active'));
        if (!isActive) item.classList.add('active');
    });
});

// ========== CERTIFICATE FILE HANDLING ==========
const certFileInput = document.getElementById('certFile');
const certFilePreview = document.getElementById('certFilePreview');
const certFileName = document.getElementById('certFileName');
const certFileUpload = document.getElementById('certFileUpload');

if (certFileInput) {
    certFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            certFileName.textContent = file.name;
            certFilePreview.style.display = 'flex';
            certFileUpload.querySelector('.file-upload-content').style.display = 'none';
        }
    });
}

function removeCertFile() {
    certFileInput.value = '';
    certFilePreview.style.display = 'none';
    certFileUpload.querySelector('.file-upload-content').style.display = 'block';
}

// ========== PASSWORD TOGGLE ==========
const togglePasswordBtns = document.querySelectorAll('.toggle-password');
togglePasswordBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const input = btn.parentElement.querySelector('input');
        const icon = btn.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'fa-solid fa-eye-slash';
        } else {
            input.type = 'password';
            icon.className = 'fa-solid fa-eye';
        }
    });
});

// ========== UPCOMING EVENTS & DASHBOARD ENHANCEMENT ==========
async function loadUpcomingEvents() {
    try {
        const response = await fetch(`${API_URL}/member/events`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        // Update Sidebar Badge
        const badge = document.getElementById('upcomingEventsBadge');
        if (badge) {
            const upcomingCount = data.events ? data.events.filter(e => new Date(e.date) >= new Date()).length : 0;
            if (upcomingCount > 0) {
                badge.textContent = upcomingCount;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }

        const container = document.getElementById('upcomingEventsList');
        if (!container) return;

        if (data.success && data.events && data.events.length > 0) {
            const upcoming = data.events
                .filter(e => new Date(e.date) >= new Date())
                .slice(0, 3);

            if (upcoming.length > 0) {
                container.innerHTML = upcoming.map(event => {
                    const d = new Date(event.date);
                    return `
                        <div class="event-preview-item">
                            <div class="event-date-box">
                                <span class="day">${d.getDate()}</span>
                                <span class="month">${d.toLocaleString('default', { month: 'short' })}</span>
                            </div>
                            <div class="event-preview-info">
                                <h4>${event.title}</h4>
                                <div class="event-preview-meta">
                                    <span><i class="fa-solid fa-clock"></i> ${event.time || 'TBA'}</span>
                                    <span><i class="fa-solid fa-location-dot"></i> ${event.venue}</span>
                                </div>
                            </div>
                            <div class="event-preview-action">
                                <button class="btn-primary btn-sm" onclick="rsvpEvent(${event.id})">RSVP</button>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No upcoming events</p></div>';
            }
        } else {
            container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No events found</p></div>';
        }
    } catch (error) {
        console.error('Error loading upcoming events:', error);
    }
}

async function loadLeaderboardPreview() {
    try {
        const response = await fetch(`${API_URL}/member/leaderboard`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        const container = document.getElementById('leaderboardPreview');
        if (!container) return;

        if (data.success && data.leaderboard && data.leaderboard.length > 0) {
            container.innerHTML = data.leaderboard.slice(0, 5).map((member, index) => `
                <div class="leaderboard-preview-item ${member.isCurrentUser ? 'highlight' : ''}">
                    <div class="leaderboard-rank ${index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : 'normal'}">
                        ${index + 1}
                    </div>
                    <div class="leaderboard-user">
                        <div class="leaderboard-avatar">
                            ${member.username.charAt(0).toUpperCase()}
                        </div>
                        <div class="leaderboard-user-info">
                            <h4>${member.username}${member.isCurrentUser ? ' (You)' : ''}</h4>
                            <span>${member.rankTitle}</span>
                        </div>
                    </div>
                    <div class="leaderboard-points">${member.points} pts</div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-state"><p>No leaderboard data</p></div>';
        }
    } catch (error) {
        console.error('Error loading leaderboard preview:', error);
    }
}

async function loadLatestAnnouncements() {
    try {
        const response = await fetch(`${API_URL}/member/announcements`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        // Update Sidebar Badge
        const badge = document.getElementById('announcementsBadge');
        if (badge) {
            const count = data.announcements ? data.announcements.length : 0;
            if (count > 0) {
                badge.textContent = count > 5 ? 'New' : count;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }

        const container = document.getElementById('latestAnnouncements');
        if (!container) return;

        if (data.success && data.announcements && data.announcements.length > 0) {
            container.innerHTML = data.announcements.slice(0, 3).map(ann => `
                <div class="announcement-preview-item">
                    <div class="announcement-header-row">
                        <span class="announcement-priority ${ann.priority || 'normal'}">${ann.priority || 'normal'}</span>
                        <span class="announcement-date">${formatTimeAgo(ann.date)}</span>
                    </div>
                    <h4>${ann.title}</h4>
                    <p>${ann.message.substring(0, 100)}...</p>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-state"><p>No announcements</p></div>';
        }
    } catch (error) {
        console.error('Error loading announcements:', error);
    }
}

async function updateMessageBadge() {
    // Placeholder for actual message count logic
    // Currently turning it off as there is no message endpoint active for counts
    const badge = document.getElementById('messagesBadge');
    if (badge) {
        badge.style.display = 'none';
    }
}

async function loadAchievementsPreview() {
    const container = document.getElementById('achievementsList');
    if (!container) return;

    try {
        const response = await fetch(`${API_URL}/member/achievements`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success && data.achievements.length > 0) {
            container.innerHTML = data.achievements.map(ach => `
                <div class="achievement-item ${ach.unlocked ? '' : 'locked'}">
                    <div class="achievement-icon">
                        <i class="${ach.icon}"></i>
                    </div>
                    <span class="achievement-name">${ach.title}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = `
                <div class="empty-state-mini">
                    <i class="fa-solid fa-trophy"></i>
                    <p>No achievements yet</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading achievements:', error);
        container.innerHTML = `<p class="error-text">Failed to load</p>`;
    }
}

// Load dashboard widgets
async function loadDashboardWidgets() {
    await Promise.all([
        loadUpcomingEvents(),
        loadLeaderboardPreview(),
        loadLatestAnnouncements(),
        loadAchievementsPreview(),
        updateMessageBadge()
    ]);
}

// Call after dashboard loads
setTimeout(loadDashboardWidgets, 1000);

// ========== CHART INITIALIZATION ==========
let activityChart = null;
let attendanceChart = null;

function initActivityChart() {
    const ctx = document.getElementById('activityChart')?.getContext('2d');
    if (!ctx) return;

    if (activityChart) activityChart.destroy();

    activityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Activity',
                data: [5, 10, 8, 15, 12, 18, 14],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function initAttendanceChart() {
    const ctx = document.getElementById('attendanceChart')?.getContext('2d');
    if (!ctx) return;

    if (attendanceChart) attendanceChart.destroy();

    attendanceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [{
                label: 'Events Attended',
                data: [3, 5, 4, 6, 8, 5],
                backgroundColor: '#10b981',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

// Initialize charts when dashboard loads
setTimeout(() => {
    initActivityChart();
    initAttendanceChart();
}, 2000);

// Chart filter buttons
const chartFilters = document.querySelectorAll('.chart-filter');
chartFilters.forEach(filter => {
    filter.addEventListener('click', () => {
        chartFilters.forEach(f => f.classList.remove('active'));
        filter.classList.add('active');
        // Update chart data based on period
        initActivityChart();
    });
});

// ========== MARK ALL NOTIFICATIONS AS READ ==========
const markAllReadBtn = document.getElementById('markAllRead');
if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', async () => {
        try {
            await fetch(`${API_URL}/notifications/mark-all-read`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            updateNotificationBadge(0);
            loadNotificationDropdown();
            showNotification('All notifications marked as read', 'success');
        } catch (error) {
            console.error('Error marking notifications as read:', error);
        }
    });
}

// ========== PROFILE EDITING ==========
function populateEditModal() {
    if (!currentUserProfile) return;

    const modal = document.getElementById('editProfileModal');
    if (!modal) return;

    // Populate fields
    if (document.getElementById('editDisplayName'))
        document.getElementById('editDisplayName').value = currentUserProfile.username || '';

    if (document.getElementById('editBio'))
        document.getElementById('editBio').value = currentUserProfile.bio || '';

    if (document.getElementById('editPhone'))
        document.getElementById('editPhone').value = currentUserProfile.phone || '';

    if (document.getElementById('editDepartment'))
        document.getElementById('editDepartment').value = currentUserProfile.department || '';

    modal.classList.add('active');
}

function editAbout() {
    populateEditModal();
}

function editPersonalInfo() {
    populateEditModal();
}

function changeCoverPhoto() {
    showNotification('Cover photo change coming soon!', 'info');
}

// ========== LIGHTBOX FOR GALLERY ==========
let currentGalleryImages = [];
let currentImageIndex = 0;

function openLightbox(imageUrl, images, index) {
    currentGalleryImages = images || [imageUrl];
    currentImageIndex = index || 0;

    const lightbox = document.getElementById('imageLightbox');
    const lightboxImage = document.getElementById('lightboxImage');

    if (lightbox && lightboxImage) {
        lightboxImage.src = imageUrl;
        lightbox.classList.add('active');
    }
}

function prevImage() {
    if (currentGalleryImages.length > 0) {
        currentImageIndex = (currentImageIndex - 1 + currentGalleryImages.length) % currentGalleryImages.length;
        document.getElementById('lightboxImage').src = currentGalleryImages[currentImageIndex];
    }
}

function nextImage() {
    if (currentGalleryImages.length > 0) {
        currentImageIndex = (currentImageIndex + 1) % currentGalleryImages.length;
        document.getElementById('lightboxImage').src = currentGalleryImages[currentImageIndex];
    }
}

// Keyboard navigation for lightbox
document.addEventListener('keydown', (e) => {
    const lightbox = document.getElementById('imageLightbox');
    if (lightbox?.classList.contains('active')) {
        if (e.key === 'ArrowLeft') prevImage();
        if (e.key === 'ArrowRight') nextImage();
        if (e.key === 'Escape') closeLightbox();
    }
});

// ========== SUBMIT MANUAL ATTENDANCE CODE ==========
function submitManualCode() {
    const code = document.getElementById('manualAttendanceCode')?.value;
    if (code) {
        markAttendanceFromScanner(parseInt(code));
    } else {
        showNotification('Please enter an attendance code', 'error');
    }
}

console.log('✅ Member Dashboard JS fully loaded');

// ========== SETTINGS PAGE ==========

// Load Settings - Populate form fields with user data
async function loadSettings() {
    try {
        const response = await fetch(`${API_URL}/member/profile`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            const profile = data.profile;

            // Populate Account Settings form fields
            const displayNameInput = document.getElementById('settingsDisplayName');
            if (displayNameInput) displayNameInput.value = profile.username || '';

            const emailInput = document.getElementById('settingsEmail');
            if (emailInput) emailInput.value = profile.email || '';

            const phoneInput = document.getElementById('settingsPhone');
            if (phoneInput) phoneInput.value = profile.phone || '';

            const bioInput = document.getElementById('settingsBio');
            if (bioInput) bioInput.value = profile.bio || '';
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showNotification('Failed to load settings', 'error');
    }
}

// Settings Menu Tab Switching
document.addEventListener('DOMContentLoaded', () => {
    const settingsMenuItems = document.querySelectorAll('.settings-menu li');
    const settingsSections = document.querySelectorAll('.settings-section');

    settingsMenuItems.forEach(item => {
        item.addEventListener('click', () => {
            const settingsType = item.getAttribute('data-settings');

            // Update active menu item
            settingsMenuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');

            // Show corresponding section
            settingsSections.forEach(section => section.classList.remove('active'));
            const targetSection = document.getElementById(`${settingsType}-settings`);
            if (targetSection) targetSection.classList.add('active');
        });
    });

    // Account Settings Form Submission
    const accountSettingsForm = document.getElementById('accountSettingsForm');
    if (accountSettingsForm) {
        accountSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const displayName = document.getElementById('settingsDisplayName').value;
            const email = document.getElementById('settingsEmail').value;
            const phone = document.getElementById('settingsPhone').value;
            const bio = document.getElementById('settingsBio').value;

            try {
                const response = await fetch(`${API_URL}/member/update-profile`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username: displayName, email, phone, bio })
                });

                const data = await response.json();

                if (data.success) {
                    showNotification('Settings saved successfully!', 'success');
                    // Update profile page elements too
                    if (currentUserProfile) {
                        currentUserProfile.username = displayName;
                        currentUserProfile.email = email;
                        currentUserProfile.phone = phone;
                        currentUserProfile.bio = bio;
                    }
                } else {
                    showNotification(data.message || 'Failed to save settings', 'error');
                }
            } catch (error) {
                console.error('Error saving settings:', error);
                showNotification('Failed to save settings', 'error');
            }
        });
    }

    // Change Password Form Submission
    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (newPassword !== confirmPassword) {
                showNotification('New passwords do not match!', 'error');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/member/change-password`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ currentPassword, newPassword })
                });

                const data = await response.json();

                if (data.success) {
                    showNotification('Password changed successfully!', 'success');
                    changePasswordForm.reset();
                } else {
                    showNotification(data.message || 'Failed to change password', 'error');
                }
            } catch (error) {
                console.error('Error changing password:', error);
                showNotification('Failed to change password', 'error');
            }
        });
    }

    // Toggle Password Visibility
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = btn.previousElementSibling;
            const icon = btn.querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    });
});

// Delete Account Function
async function confirmDeleteAccount() {
    if (!confirm('Are you ABSOLUTELY sure you want to delete your account? This action cannot be undone and you will lose all points and certificates.')) {
        return;
    }

    // Double confirmation
    const verification = prompt('Type "DELETE" to confirm account deletion:');
    if (verification !== 'DELETE') {
        if (verification !== null) showNotification('Deletion cancelled. Verification failed.', 'info');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/member/delete-account`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            alert('Your account has been deleted. Redirecting to home...');
            localStorage.removeItem('token');
            window.location.href = 'index.html';
        } else {
            showNotification(data.message || 'Failed to delete account', 'error');
        }
    } catch (error) {
        console.error('Error deleting account:', error);
        showNotification('Failed to delete account', 'error');
    }
}

// ==================== MESSAGING SYSTEM ====================

// Socket.IO Connection
let socket = null;
let currentRecipientId = null;
let isMessagesLoading = false;

// Initialize Socket.IO
function initializeSocket() {
    if (typeof io === 'undefined') {
        console.warn('Socket.IO client not available');
        return;
    }
    if (!socket) {
        socket = io(API_URL, {
            auth: {
                token: token
            }
        });

        socket.on('connect', () => {
            console.log('✅ Socket.IO connected');
            const decoded = parseJwt(token);
            if (decoded && decoded.id) {
                socket.emit('join-user', decoded.id);
            }
        });

        socket.on('disconnect', () => {
            console.log('❌ Socket.IO disconnected');
        });

        socket.on('new-message', (message) => {
            console.log('📨 New message received:', message);
            handleNewMessage(message);
        });

        socket.on('message-sent', (message) => {
            console.log('✅ Message sent confirmation:', message);
        });
    }
}

// Parse JWT token
function parseJwt(token) {
    try {
        return JSON.parse(atob(token.split('.')[1]));
    } catch (e) {
        return null;
    }
}

// Load Messages Page
async function loadMessages() {
    if (isMessagesLoading) return;
    isMessagesLoading = true;
    try {
        // Initialize socket if not already done
        initializeSocket();

        // Load contacts
        await loadContacts();
    } catch (error) {
        console.error('Error loading messages:', error);
        showNotification('Failed to load messages', 'error');
    } finally {
        isMessagesLoading = false;
    }
}

// Load Contacts
async function loadContacts() {
    try {
        const response = await fetch(`${API_URL}/messages/contacts`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            const contactsList = document.getElementById('contactsList');

            if (data.contacts.length === 0) {
                contactsList.innerHTML = `
                    <div class="loading-state">
                        <i class="fa-solid fa-user-slash"></i>
                        <p>No contacts available</p>
                    </div>
                `;
                return;
            }

            contactsList.innerHTML = data.contacts.map(contact => {
                const roleLabel = contact.role || 'Club Owner';
                return `
                    <div class="contact-item"
                        data-contact-id="${contact.id}"
                        data-contact-name="${escapeHtml(contact.username)}"
                        data-contact-role="${escapeHtml(roleLabel)}">
                        <div class="contact-avatar">
                            ${contact.username.charAt(0).toUpperCase()}
                        </div>
                        <div class="contact-info">
                            <div class="contact-name">${escapeHtml(contact.username)}</div>
                            <div class="contact-last-message">
                                ${contact.lastMessage ? escapeHtml(contact.lastMessage.message.substring(0, 30) + '...') : 'No messages yet'}
                            </div>
                        </div>
                        <div class="contact-meta">
                            ${contact.lastMessage ? `<div class="contact-time">${formatMessageTime(contact.lastMessage.createdAt)}</div>` : ''}
                            ${contact.unreadCount > 0 ? `<div class="contact-unread">${contact.unreadCount}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            contactsList.querySelectorAll('.contact-item').forEach(item => {
                item.addEventListener('click', () => {
                    const recipientId = parseInt(item.dataset.contactId, 10);
                    const username = item.dataset.contactName || 'Contact';
                    const role = item.dataset.contactRole || 'Club Owner';
                    selectContact(recipientId, username, role, item);
                });
            });

            // Auto-select first contact if available
            if (data.contacts.length > 0) {
                const firstContact = data.contacts[0];
                const firstEl = contactsList.querySelector('.contact-item');
                selectContact(firstContact.id, firstContact.username, firstContact.role, firstEl);
            }
        }
    } catch (error) {
        console.error('Error loading contacts:', error);
        showNotification('Failed to load contacts', 'error');
    }
}

// Select Contact
async function selectContact(recipientId, username, role, element) {
    currentRecipientId = recipientId;

    // Update UI
    document.getElementById('messagesEmpty').style.display = 'none';
    document.getElementById('messagesActive').style.display = 'flex';
    document.getElementById('chatContactName').textContent = username;
    document.getElementById('chatContactRole').textContent = role || 'Club Owner';

    // Highlight selected contact
    document.querySelectorAll('.contact-item').forEach(item => {
        item.classList.remove('active');
    });
    if (element) {
        element.classList.add('active');
    }

    // Load messages
    await loadChatMessages(recipientId);
}

// Load Chat Messages
async function loadChatMessages(recipientId) {
    try {
        const response = await fetch(`${API_URL}/messages?recipientId=${recipientId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            displayMessages(data.messages);
        }
    } catch (error) {
        console.error('Error loading messages:', error);
        showNotification('Failed to load messages', 'error');
    }
}

// Display Messages
function displayMessages(messages) {
    const chatMessages = document.getElementById('chatMessages');
    const decoded = parseJwt(token);
    const currentUserId = decoded?.id;

    if (messages.length === 0) {
        chatMessages.innerHTML = `
            <div class="loading-state">
                <i class="fa-solid fa-comments"></i>
                <p>No messages yet. Start the conversation!</p>
            </div>
        `;
        return;
    }

    chatMessages.innerHTML = messages.map(msg => {
        const isSent = msg.senderId === currentUserId;
        return `
            <div class="message-group ${isSent ? 'sent' : 'received'}">
                <div class="message-bubble">
                    <p class="message-text">${escapeHtml(msg.message)}</p>
                </div>
                <div class="message-time">${formatMessageTime(msg.createdAt)}</div>
            </div>
        `;
    }).join('');

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Send Message
async function sendMessage(event) {
    event.preventDefault();

    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();

    if (!message || !currentRecipientId) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipientId: currentRecipientId,
                message: message,
                type: 'direct'
            })
        });

        const data = await response.json();

        if (data.success) {
            // Clear input
            messageInput.value = '';
            document.getElementById('charCount').textContent = '0';

            // Add message to chat
            const chatMessages = document.getElementById('chatMessages');
            const messageHtml = `
                <div class="message-group sent">
                    <div class="message-bubble">
                        <p class="message-text">${escapeHtml(message)}</p>
                    </div>
                    <div class="message-time">Just now</div>
                </div>
            `;
            chatMessages.insertAdjacentHTML('beforeend', messageHtml);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            showNotification(data.message || 'Failed to send message', 'error');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showNotification('Failed to send message', 'error');
    }
}

// Handle New Message (Real-time)
function handleNewMessage(message) {
    // If chat is open with this sender, add message
    if (currentRecipientId === message.senderId) {
        const chatMessages = document.getElementById('chatMessages');
        const messageHtml = `
            <div class="message-group received">
                <div class="message-bubble">
                    <p class="message-text">${escapeHtml(message.message)}</p>
                </div>
                <div class="message-time">${formatMessageTime(message.createdAt)}</div>
            </div>
        `;
        chatMessages.insertAdjacentHTML('beforeend', messageHtml);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Update contacts list
    loadContacts();

    // Show notification
    showNotification(`New message from ${message.senderName}`, 'info');
}

// Format Message Time
function formatMessageTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    // Less than 1 minute
    if (diff < 60000) {
        return 'Just now';
    }

    // Less than 1 hour
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes}m ago`;
    }

    // Less than 24 hours
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}h ago`;
    }

    // Less than 7 days
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days}d ago`;
    }

    // Show date
    return date.toLocaleDateString();
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Character counter for message input
document.addEventListener('DOMContentLoaded', () => {
    const messageInput = document.getElementById('messageInput');
    const charCount = document.getElementById('charCount');

    if (messageInput && charCount) {
        messageInput.addEventListener('input', () => {
            charCount.textContent = messageInput.value.length;

            // Auto-resize textarea
            messageInput.style.height = 'auto';
            messageInput.style.height = messageInput.scrollHeight + 'px';
        });
    }
});

console.log('✅ Messaging system initialized');
