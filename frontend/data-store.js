/**
 * DataStore — IndexedDB-backed persistent cache for dashboard modules.
 *
 * Object stores:
 *   module_cache  – cached module payloads (key = moduleName:userId:clubId)
 *   sync_meta     – small metadata values (sync timestamps, etc.)
 *
 * Public API (all async):
 *   DataStore.init()
 *   DataStore.loadFromCache(moduleName, userId, clubId)
 *   DataStore.saveToCache(moduleName, payload, version, userId, clubId)
 *   DataStore.getVersion(moduleName, userId, clubId)
 *   DataStore.markDirty(moduleName, userId, clubId)
 *   DataStore.isDirty(moduleName, userId, clubId)
 *   DataStore.clearUserCache(userId, clubId)
 *   DataStore.clearAll()
 *   DataStore.getSyncMeta(key)
 *   DataStore.setSyncMeta(key, value)
 */

(function () {
    'use strict';

    const DB_NAME = 'ClubConnectCache';
    const DB_VERSION = 1;
    const STORE_MODULES = 'module_cache';
    const STORE_META = 'sync_meta';

    let _db = null;
    let _initPromise = null;

    // ───────── helpers ─────────

    function compositeKey(moduleName, userId, clubId) {
        return `${moduleName}:${userId || 'anon'}:${clubId || 'none'}`;
    }

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_MODULES)) {
                    db.createObjectStore(STORE_MODULES, { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META, { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            request.onerror = (event) => {
                console.error('IndexedDB open error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    function tx(storeName, mode) {
        if (!_db) throw new Error('DataStore not initialised');
        const transaction = _db.transaction(storeName, mode);
        return transaction.objectStore(storeName);
    }

    function idbGet(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const store = tx(storeName, 'readonly');
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    function idbPut(storeName, record) {
        return new Promise((resolve, reject) => {
            try {
                const store = tx(storeName, 'readwrite');
                const req = store.put(record);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    function idbDelete(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const store = tx(storeName, 'readwrite');
                const req = store.delete(key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    function idbClear(storeName) {
        return new Promise((resolve, reject) => {
            try {
                const store = tx(storeName, 'readwrite');
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    function idbGetAll(storeName) {
        return new Promise((resolve, reject) => {
            try {
                const store = tx(storeName, 'readonly');
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    // ───────── public API ─────────

    const DataStore = {

        async init() {
            if (_db) return;
            if (_initPromise) return _initPromise;
            _initPromise = openDB().then(db => { _db = db; });
            await _initPromise;
            console.log('📦 DataStore initialised (IndexedDB)');
        },

        /**
         * Load cached payload for a module.
         * Returns { data, version, syncedAt, dirty } or null if not cached.
         */
        async loadFromCache(moduleName, userId, clubId) {
            try {
                await this.init();
                const key = compositeKey(moduleName, userId, clubId);
                const record = await idbGet(STORE_MODULES, key);
                if (!record) return null;
                return {
                    data: record.data,
                    version: record.version,
                    syncedAt: record.syncedAt,
                    dirty: !!record.dirty
                };
            } catch (err) {
                console.warn('DataStore.loadFromCache error:', err);
                return null;
            }
        },

        /**
         * Save module payload to cache.
         */
        async saveToCache(moduleName, payload, version, userId, clubId) {
            try {
                await this.init();
                const key = compositeKey(moduleName, userId, clubId);
                await idbPut(STORE_MODULES, {
                    key,
                    moduleName,
                    userId,
                    clubId,
                    data: payload,
                    version: version || 0,
                    syncedAt: Date.now(),
                    dirty: false
                });
            } catch (err) {
                console.warn('DataStore.saveToCache error:', err);
            }
        },

        /**
         * Get the cached version number for a module (or 0).
         */
        async getVersion(moduleName, userId, clubId) {
            try {
                await this.init();
                const key = compositeKey(moduleName, userId, clubId);
                const record = await idbGet(STORE_MODULES, key);
                return record ? (record.version || 0) : 0;
            } catch {
                return 0;
            }
        },

        /**
         * Mark a module dirty so next page visit fetches fresh data.
         */
        async markDirty(moduleName, userId, clubId) {
            try {
                await this.init();
                const key = compositeKey(moduleName, userId, clubId);
                const record = await idbGet(STORE_MODULES, key);
                if (record) {
                    record.dirty = true;
                    await idbPut(STORE_MODULES, record);
                }
            } catch (err) {
                console.warn('DataStore.markDirty error:', err);
            }
        },

        /**
         * Check if a module is dirty.
         */
        async isDirty(moduleName, userId, clubId) {
            try {
                await this.init();
                const key = compositeKey(moduleName, userId, clubId);
                const record = await idbGet(STORE_MODULES, key);
                return record ? !!record.dirty : true; // treat missing as dirty
            } catch {
                return true;
            }
        },

        /**
         * Remove all cached modules for a specific user+club pair.
         */
        async clearUserCache(userId, clubId) {
            try {
                await this.init();
                const all = await idbGetAll(STORE_MODULES);
                const suffix = `:${userId || 'anon'}:${clubId || 'none'}`;
                for (const record of all) {
                    if (record.key && record.key.endsWith(suffix)) {
                        await idbDelete(STORE_MODULES, record.key);
                    }
                }
            } catch (err) {
                console.warn('DataStore.clearUserCache error:', err);
            }
        },

        /**
         * Clear everything (both stores).
         */
        async clearAll() {
            try {
                await this.init();
                await idbClear(STORE_MODULES);
                await idbClear(STORE_META);
                console.log('📦 DataStore cleared');
            } catch (err) {
                console.warn('DataStore.clearAll error:', err);
            }
        },

        /**
         * Get a small metadata value (e.g. last sync time).
         */
        async getSyncMeta(key) {
            try {
                await this.init();
                const record = await idbGet(STORE_META, key);
                return record ? record.value : null;
            } catch {
                return null;
            }
        },

        /**
         * Set a small metadata value.
         */
        async setSyncMeta(key, value) {
            try {
                await this.init();
                await idbPut(STORE_META, { key, value });
            } catch (err) {
                console.warn('DataStore.setSyncMeta error:', err);
            }
        }
    };

    // Expose globally
    window.DataStore = DataStore;

})();
