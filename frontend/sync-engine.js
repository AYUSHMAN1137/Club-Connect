/**
 * SyncEngine — background sync coordinator.
 *
 * Responsibilities:
 *   - Manifest-based change detection (poll every 60s foreground)
 *   - Socket-driven real-time invalidation
 *   - Online/offline detection with persistent banner
 *   - Background refresh of changed modules
 *   - Full daily reconciliation
 *
 * Public API:
 *   SyncEngine.init(config)
 *   SyncEngine.checkManifest()
 *   SyncEngine.refreshModule(moduleName)
 *   SyncEngine.fullReconcile()
 *   SyncEngine.destroy()
 *
 * Config shape:
 *   {
 *     role: 'member' | 'owner',
 *     userId, clubId, apiUrl, token,
 *     socket,                       // socket.io instance (optional)
 *     onModuleRefreshed(moduleName), // callback after a module is refreshed
 *     moduleEndpoints: { moduleName: '/member/events', ... }
 *   }
 */

(function () {
    'use strict';

    const MANIFEST_POLL_INTERVAL = 60 * 1000; // 60 seconds
    const FULL_RECONCILE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    const RECONCILE_META_KEY = 'lastFullReconcile';

    let _config = null;
    let _manifestTimer = null;
    let _destroyed = false;
    let _syncing = false;

    /**
     * Default module → endpoint mapping.
     * Each dashboard overrides with its own map if needed.
     */
    const MEMBER_ENDPOINTS = {
        dashboard: '/member/dashboard',
        events: '/member/events',
        attendance: '/member/attendance',
        leaderboard: '/member/leaderboard',
        announcements: '/member/announcements',
        polls: '/member/polls',
        myProjects: '/member/my-project',
        profile: '/member/profile',
        certificates: '/member/certificates',
        notifications: '/member/notifications',
        messagesContacts: '/member/messages/contacts'
    };

    const OWNER_ENDPOINTS = {
        dashboardStats: '/owner/dashboard-stats',
        members: '/owner/members',
        events: '/owner/events',
        announcements: '/owner/announcements',
        polls: '/owner/polls',
        certificates: '/owner/certificates',
        projectProgress: '/owner/project-progress',
        analytics: '/owner/analytics',
        workshops: '/owner/workshops',
        notifications: '/owner/notifications',
        messagesContacts: '/owner/messages/contacts'
    };

    // ───────── offline banner ─────────

    function showOfflineBanner() {
        let banner = document.getElementById('offlineBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'offlineBanner';
            banner.className = 'offline-banner';
            banner.innerHTML = '<i class="fa-solid fa-wifi-slash"></i> Offline — showing cached data';
            document.body.prepend(banner);
        }
        banner.classList.add('visible');
    }

    function hideOfflineBanner() {
        const banner = document.getElementById('offlineBanner');
        if (banner) banner.classList.remove('visible');
    }

    // ───────── core helpers ─────────

    function getEndpoints() {
        if (_config && _config.moduleEndpoints) return _config.moduleEndpoints;
        return _config && _config.role === 'owner' ? OWNER_ENDPOINTS : MEMBER_ENDPOINTS;
    }

    function getManifestUrl() {
        const role = _config ? _config.role : 'member';
        return `/${role}/sync-manifest`;
    }

    async function apiFetch(path) {
        if (!_config) throw new Error('SyncEngine not initialised');
        const resp = await fetch(`${_config.apiUrl}${path}`, {
            headers: {
                'Authorization': `Bearer ${_config.token}`,
                'Content-Type': 'application/json'
            }
        });
        if (!resp.ok) throw new Error(`API ${path} returned ${resp.status}`);
        return resp.json();
    }

    // ───────── public API ─────────

    const SyncEngine = {

        /**
         * Initialise the sync engine.
         */
        async init(config) {
            _config = config;
            _destroyed = false;

            // Ensure DataStore is ready
            if (window.DataStore) {
                await window.DataStore.init();
            }

            // Online / offline listeners
            window.addEventListener('online', this._onOnline);
            window.addEventListener('offline', this._onOffline);

            if (!navigator.onLine) {
                showOfflineBanner();
            }

            // Visibility change — sync on foreground resume
            document.addEventListener('visibilitychange', this._onVisibilityChange);

            // Socket invalidation
            this._bindSocket();

            // Start manifest polling
            this._startManifestPolling();

            // Check if daily reconciliation is needed
            this._checkDailyReconcile();

            console.log('🔄 SyncEngine initialised', { role: config.role, userId: config.userId, clubId: config.clubId });
        },

        /**
         * Fetch manifest and refresh any modules whose server version > local version.
         */
        async checkManifest() {
            if (_destroyed || !_config || _syncing) return;
            if (!navigator.onLine) return;

            _syncing = true;
            try {
                const manifest = await apiFetch(getManifestUrl());
                if (!manifest.success || !manifest.versions) return;

                const serverVersions = manifest.versions;
                const endpoints = getEndpoints();
                const refreshTasks = [];

                for (const [moduleName, serverVer] of Object.entries(serverVersions)) {
                    if (!endpoints[moduleName]) continue; // skip modules we don't know about

                    const localVer = await window.DataStore.getVersion(
                        moduleName, _config.userId, _config.clubId
                    );

                    if (serverVer > localVer) {
                        refreshTasks.push(moduleName);
                    }
                }

                if (refreshTasks.length > 0) {
                    console.log('🔄 Modules to refresh:', refreshTasks);
                    await Promise.allSettled(
                        refreshTasks.map(mod => this.refreshModule(mod))
                    );
                }
            } catch (err) {
                // Manifest fetch failure is non-fatal — app continues with cached data
                if (err.message && err.message.includes('Failed to fetch')) {
                    // Probably offline
                } else {
                    console.warn('⚠️ Manifest check failed:', err.message);
                }
            } finally {
                _syncing = false;
            }
        },

        /**
         * Fetch fresh data for a single module and update cache.
         */
        async refreshModule(moduleName) {
            if (_destroyed || !_config) return;
            const endpoints = getEndpoints();
            const endpoint = endpoints[moduleName];
            if (!endpoint) return;

            try {
                const data = await apiFetch(endpoint);

                // Get latest version from manifest or sync-state
                let version = 0;
                try {
                    const manifest = await apiFetch(getManifestUrl());
                    if (manifest.success && manifest.versions) {
                        version = manifest.versions[moduleName] || 0;
                    }
                } catch { /* ignore — version 0 is safe */ }

                await window.DataStore.saveToCache(
                    moduleName, data, version, _config.userId, _config.clubId
                );

                // Notify dashboard to re-render if this module's page is active
                if (_config.onModuleRefreshed) {
                    _config.onModuleRefreshed(moduleName, data);
                }

                if (window.Telemetry) window.Telemetry.logSync(moduleName, 'success');
                console.log(`✅ Module refreshed: ${moduleName} (v${version})`);
            } catch (err) {
                if (window.Telemetry) window.Telemetry.logError(`SyncEngine.refreshModule(${moduleName})`, err);
                console.warn(`⚠️ refreshModule(${moduleName}) failed:`, err.message);
            }
        },

        /**
         * Full reconciliation — re-fetch ALL modules.
         */
        async fullReconcile() {
            if (_destroyed || !_config) return;
            const endpoints = getEndpoints();
            const moduleNames = Object.keys(endpoints);
            console.log('🔄 Full reconcile — refreshing all modules...');
            await Promise.allSettled(
                moduleNames.map(mod => this.refreshModule(mod))
            );
            await window.DataStore.setSyncMeta(RECONCILE_META_KEY, Date.now());
            console.log('✅ Full reconcile complete');
        },

        /**
         * Destroy the engine — remove listeners and timers.
         */
        destroy() {
            _destroyed = true;
            if (_manifestTimer) {
                clearInterval(_manifestTimer);
                _manifestTimer = null;
            }
            window.removeEventListener('online', this._onOnline);
            window.removeEventListener('offline', this._onOffline);
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
            console.log('🔄 SyncEngine destroyed');
        },

        // ───────── internal ─────────

        _onOnline() {
            hideOfflineBanner();
            console.log('🌐 Back online — syncing...');
            SyncEngine.checkManifest();
        },

        _onOffline() {
            showOfflineBanner();
            console.log('📴 Went offline');
        },

        _onVisibilityChange() {
            if (!document.hidden && navigator.onLine) {
                SyncEngine.checkManifest();
            }
        },

        _bindSocket() {
            if (!_config || !_config.socket) return;
            const socket = _config.socket;

            // Join club room
            if (_config.clubId) {
                socket.emit('join-club', _config.clubId);
            }

            // Listen for module invalidation
            socket.on('module-invalidated', async (payload) => {
                if (!payload || !payload.modules) return;

                // Only process if it's for our club
                if (payload.clubId && payload.clubId !== _config.clubId) return;

                console.log('🔔 Socket: module-invalidated', payload.modules);

                // Mark dirty and refresh in background
                for (const mod of payload.modules) {
                    await window.DataStore.markDirty(mod, _config.userId, _config.clubId);
                }

                // Immediately fetch fresh data for dirty modules
                await Promise.allSettled(
                    payload.modules.map(mod => SyncEngine.refreshModule(mod))
                );
            });
        },

        _startManifestPolling() {
            if (_manifestTimer) clearInterval(_manifestTimer);
            _manifestTimer = setInterval(() => {
                if (!document.hidden && navigator.onLine) {
                    SyncEngine.checkManifest();
                }
            }, MANIFEST_POLL_INTERVAL);
        },

        async _checkDailyReconcile() {
            try {
                const lastReconcile = await window.DataStore.getSyncMeta(RECONCILE_META_KEY);
                const now = Date.now();
                if (!lastReconcile || (now - lastReconcile) > FULL_RECONCILE_INTERVAL) {
                    // Schedule for a few seconds after init so it doesn't block startup
                    setTimeout(() => {
                        if (!_destroyed) SyncEngine.fullReconcile();
                    }, 5000);
                }
            } catch { /* ignore */ }
        },

        /**
         * Convenience: try to load a module from cache.
         * If cached and not dirty, return cached data.
         * If not cached or dirty, fetch from API, cache, and return.
         * This is the main method dashboards should use.
         */
        async cachedFetch(moduleName, endpointOverride) {
            if (!_config) return { data: null, fromCache: false };

            const userId = _config.userId;
            const clubId = _config.clubId;

            // 1. Try cache
            const cached = await window.DataStore.loadFromCache(moduleName, userId, clubId);
            if (cached && !cached.dirty) {
                if (window.Telemetry) window.Telemetry.logCacheHit(moduleName, 'cachedFetch');
                return { data: cached.data, fromCache: true };
            }

            // 2. If offline and have stale cache, use it
            if (!navigator.onLine && cached) {
                showOfflineBanner();
                if (window.Telemetry) window.Telemetry.logCacheHit(moduleName, 'cachedFetch_offlineStale');
                return { data: cached.data, fromCache: true };
            }

            // 3. Fetch fresh
            if (window.Telemetry) window.Telemetry.logCacheMiss(moduleName, 'cachedFetch');
            const endpoints = getEndpoints();
            const endpoint = endpointOverride || endpoints[moduleName];
            if (!endpoint) return { data: null, fromCache: false };

            try {
                const data = await apiFetch(endpoint);

                // Get version from manifest
                let version = 0;
                try {
                    const manifest = await apiFetch(getManifestUrl());
                    if (manifest.success && manifest.versions) {
                        version = manifest.versions[moduleName] || 0;
                    }
                } catch { /* use version 0 */ }

                await window.DataStore.saveToCache(moduleName, data, version, userId, clubId);
                return { data, fromCache: false };
            } catch (err) {
                // Network error — fall back to stale cache if available
                if (cached) {
                    console.warn(`⚠️ Fetch failed for ${moduleName}, using stale cache`);
                    if (window.Telemetry) window.Telemetry.logCacheHit(moduleName, 'cachedFetch_staleFallback');
                    showOfflineBanner();
                    return { data: cached.data, fromCache: true };
                }
                if (window.Telemetry) window.Telemetry.logError(`fetch:${moduleName}`, err);
                throw err; // no cache, no network — propagate error
            }
        }
    };

    // Expose globally
    window.SyncEngine = SyncEngine;

})();
