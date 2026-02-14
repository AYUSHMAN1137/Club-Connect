// Utility Functions
// Make API_URL globally accessible
window.API_URL = window.API_URL || 'http://localhost:4000';
const API_URL = window.API_URL;

// ===== NGROK INTERSTITIAL BYPASS =====
// When using ngrok free tier, it injects an HTML warning page before the actual response.
// This global fetch interceptor adds the bypass header to ALL fetch requests automatically.
(function () {
    const hostname = window.location.hostname;
    const isNgrok = hostname.endsWith('ngrok-free.app') || hostname.endsWith('ngrok.app') || hostname.endsWith('ngrok.dev');
    if (!isNgrok) return;

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
        init = init || {};
        init.headers = init.headers || {};
        // Support both Headers object and plain object
        if (init.headers instanceof Headers) {
            if (!init.headers.has('ngrok-skip-browser-warning')) {
                init.headers.set('ngrok-skip-browser-warning', 'true');
            }
        } else {
            if (!init.headers['ngrok-skip-browser-warning']) {
                init.headers['ngrok-skip-browser-warning'] = 'true';
            }
        }
        return originalFetch.call(this, input, init);
    };
    console.log('🌐 Ngrok detected — fetch interceptor active');
})();

// Loading Spinner Component
function showLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Loading...</p>
            </div>
        `;
    }
}

function hideLoading(elementId, content = '') {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = content;
    }
}

// Tooltip Component
function createTooltip(element, text) {
    element.setAttribute('data-tooltip', text);
    element.classList.add('has-tooltip');
}

// Initialize tooltips
function initTooltips() {
    document.querySelectorAll('[data-tooltip]').forEach(el => {
        el.classList.add('has-tooltip');
    });
}

// Dark Mode Toggle
function initDarkMode() {
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

// Detect if we're running through ngrok
const isNgrokEnv = window.location.hostname.endsWith('ngrok-free.app') ||
    window.location.hostname.endsWith('ngrok.app') ||
    window.location.hostname.endsWith('ngrok.dev');

// API Helper with loading
async function apiCall(url, options = {}) {
    const token = localStorage.getItem('token');
    try {
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
        };
        // Bypass ngrok's interstitial warning page
        if (isNgrokEnv) {
            headers['ngrok-skip-browser-warning'] = 'true';
        }
        const response = await fetch(`${API_URL}${url}`, {
            ...options,
            headers
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Request failed');
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Format Date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Format Time
function formatTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}
