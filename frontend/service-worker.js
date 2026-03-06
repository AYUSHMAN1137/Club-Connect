const CACHE_NAME = 'club-connect-cache-v1';
const API_CACHE = 'club-connect-api-v1';

const STATIC_ASSETS = [
    './',
    './index.html',
    './login.html',
    './member-dashboard.html',
    './owner-dashboard.html',
    './global.css',
    './member-dashboard.css',
    './owner-dashboard.css',
    './ui-base.css',
    './utils.js',
    './data-store.js',
    './sync-engine.js',
    './member-dashboard.js',
    './owner-dashboard.js'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[ServiceWorker] Precaching App Shell');
            return cache.addAll(STATIC_ASSETS);
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== CACHE_NAME && key !== API_CACHE) {
                    console.log('[ServiceWorker] Removing old cache', key);
                    return caches.delete(key);
                }
            })
        ))
    );
    self.clients.claim();
});

function isApiRoute(url) {
    return url.pathname.startsWith('/api') ||
        url.pathname.startsWith('/owner') ||
        url.pathname.startsWith('/member') ||
        url.pathname.startsWith('/auth') ||
        url.pathname.startsWith('/sync');
}

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Dynamic API caching (Network First)
    if (isApiRoute(url)) {
        if (event.request.method !== 'GET') {
            // It's a mutation: intercept and fallback to offline queue natively if fetch fails.
            event.respondWith(
                fetch(event.request.clone()).catch(async (err) => {
                    const db = await openQueueDB();
                    try {
                        let bodyText = await event.request.clone().text();
                        await addToQueue(db, {
                            url: event.request.url,
                            method: event.request.method,
                            headers: [...event.request.headers.entries()],
                            body: bodyText,
                            timestamp: Date.now(),
                            retries: 0
                        });

                        // Fire off background sync if supported
                        if (self.registration.sync) {
                            self.registration.sync.register('sync-mutations');
                        }

                        await broadcastTelemetry({ type: 'bg_sync', status: 'queued', url: event.request.url });
                    } catch (e) {
                        console.error('Failed to queue mutation:', e);
                        await broadcastTelemetry({ type: 'error', location: 'SW_queue_mutation', error: e.message || e });
                    }
                    return new Response(JSON.stringify({ success: false, message: 'Offline. Action queued for sync.' }), {
                        status: 503,
                        headers: { 'Content-Type': 'application/json' }
                    });
                })
            );
            return;
        }

        // GET request -> Network First
        event.respondWith(
            fetch(event.request).then(response => {
                // Ignore 206 Partial Content or opaque responses which cannot be cached correctly usually
                if (!response || response.status !== 200 || (response.type !== 'basic' && response.type !== 'cors')) {
                    return response;
                }
                const cloned = response.clone();
                caches.open(API_CACHE).then(cache => cache.put(event.request, cloned));
                return response;
            }).catch(async () => {
                const cached = await caches.match(event.request);
                return cached || new Response(JSON.stringify({ success: false, message: 'Offline - No cached data available.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
            })
        );
        return;
    }

    // Static assets -> Navigation/HTML Network-First, Assets Cache-First (stale-while-revalidate)
    if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            const networkFetch = fetch(event.request).then(response => {
                const cloned = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
                return response;
            }).catch(() => null);
            return cachedResponse || networkFetch;
        })
    );
});

// Background Sync functionality
self.addEventListener('sync', event => {
    if (event.tag === 'sync-mutations') {
        event.waitUntil(processBackgroundQueue());
    }
});

async function broadcastTelemetry(payload) {
    const clients = await self.clients.matchAll();
    clients.forEach(client => client.postMessage({ type: 'SW_TELEMETRY', payload }));
}

async function processBackgroundQueue() {
    console.log('[ServiceWorker] Firing sync-mutations...');
    const db = await openQueueDB();
    const items = await getQueueItems(db);

    for (let item of items) {
        try {
            const headersObj = {};
            item.headers.forEach(h => { headersObj[h[0]] = h[1] });

            const fetchReq = new Request(item.url, {
                method: item.method,
                headers: new Headers(headersObj),
                body: item.body || null
            });
            const response = await fetch(fetchReq);
            if (response.ok || response.status >= 400) {
                // If success or hard server error (not network error), drop from queue
                await deleteFromQueue(db, item.id);
                await broadcastTelemetry({ type: 'bg_sync', status: response.ok ? 'success' : 'server_error', url: item.url, retries: item.retries || 0 });
            }
        } catch (err) {
            console.error('Background sync failed for item:', item, err);
            item.retries = (item.retries || 0) + 1;

            if (item.retries >= 3) {
                await deleteFromQueue(db, item.id);
                await broadcastTelemetry({ type: 'error', location: 'SW_sync_abandoned', url: item.url, retries: item.retries });
            } else {
                await updateQueueItem(db, item);
                await broadcastTelemetry({ type: 'error', location: 'SW_sync_retry', url: item.url, retries: item.retries });
            }
        }
    }
}

// Inline IDB Helpers for Service Worker
function openQueueDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('ClubConnectOfflineQueue', 1);
        req.onupgradeneeded = e => {
            e.target.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}
function addToQueue(db, record) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        tx.objectStore('outbox').put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject();
    });
}
function getQueueItems(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readonly');
        const req = tx.objectStore('outbox').getAll();
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = () => reject();
    });
}
function deleteFromQueue(db, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        tx.objectStore('outbox').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject();
    });
}
function updateQueueItem(db, record) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        tx.objectStore('outbox').put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject();
    });
}
