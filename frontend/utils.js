// Utility Functions
// Make API_URL globally accessible
window.API_URL = window.API_URL || 'http://localhost:4000';
const UTIL_API_URL = window.API_URL;

// ========== TELEMETRY & LOGGING (Phase 5) ==========
window.Telemetry = {
    logs: [],
    record(event, prefix = '📊') {
        const payload = { timestamp: Date.now(), ...event };
        this.logs.push(payload);
        console.log(`${prefix} [Telemetry] ${event.type} —`, event.details || event);
    },
    logCacheHit: (module, method) => window.Telemetry.record({ type: 'cache_hit', details: { module, method } }, '⚡'),
    logCacheMiss: (module, method) => window.Telemetry.record({ type: 'cache_miss', details: { module, method } }, '🌐'),
    logSync: (module, status) => window.Telemetry.record({ type: 'bg_sync', details: { module, status } }, '🔄'),
    logError: (module, error) => window.Telemetry.record({ type: 'error', details: { module, error: error.message || error } }, '❌'),

    // Performance benchmarking
    benchmarks: new Map(),
    start(label) {
        this.benchmarks.set(label, performance.now());
    },
    end(label) {
        if (!this.benchmarks.has(label)) return;
        const start = this.benchmarks.get(label);
        const duration = Math.round(performance.now() - start);
        this.benchmarks.delete(label);
        this.record({ type: 'performance_metric', details: { label, durationMs: duration } }, '⏱️');
        return duration;
    }
};

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
        const response = await fetch(`${UTIL_API_URL}${url}`, {
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

// ========== OFFLINE & SERVICE WORKER ==========
window.addEventListener('load', () => {
    // 1. Service Worker Registration
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => {
                console.log('✅ ServiceWorker registered with scope:', reg.scope);
                // Listen to coming back online to trigger sync
                window.addEventListener('online', () => {
                    if (reg.sync) {
                        reg.sync.register('sync-mutations').catch(console.error);
                    }
                });
            })
            .catch(err => {
                console.warn('❌ ServiceWorker registration failed:', err);
            });
    }

    // 2. Offline Banner Update
    function updateOnlineStatus() {
        const banner = document.getElementById('offlineBanner');
        if (banner) {
            if (navigator.onLine) {
                banner.classList.remove('visible');
            } else {
                banner.classList.add('visible');
            }
        }
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    // Initial check
    updateOnlineStatus();

    // 3. Listen for Telemetry from SW
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'SW_TELEMETRY' && window.Telemetry) {
                const payload = event.data.payload;
                if (payload.type === 'error') {
                    window.Telemetry.logError(payload.location || 'SW', payload.error || payload);
                } else if (payload.type === 'bg_sync') {
                    window.Telemetry.logSync(payload.url || 'SW', payload.status || 'unknown');
                } else {
                    window.Telemetry.record(payload, '🤖');
                }
            }
        });
    }
});
