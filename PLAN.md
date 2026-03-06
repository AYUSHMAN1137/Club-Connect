# Local-First Smart Caching Plan (Member + Owner Dashboard)

## Summary
Goal: App/web ko **instant load** banana (online/offline dono), startup pe data ek baar bulk me sync karna, aur uske baad repeated API calls almost zero rakhna.  
Approach: **Local-first architecture** with IndexedDB + background sync + socket invalidation + periodic verification sync.

## Success Criteria
1. First successful sync ke baad next app open par dashboard render < 300ms (offline/online).
2. Page switch par unnecessary API call na ho (data local cache se aaye).
3. Server changes hone par sirf changed module refresh ho, full reload nahi.
4. Offline mode me last known data complete dikhe.
5. Cache inconsistency detect hone par auto-reconcile ho (extra old local records remove, new server records add).

## Scope
In-scope:
- Member + Owner dashboards data caching + sync strategy
- Backend support for bootstrap + version/manifest + delta refresh
- Service worker for static asset/API snapshot behavior
- Invalidation and reconciliation rules

Out-of-scope:
- UI redesign
- Business logic changes (points, polls, attendance rules)

## Key Design Decisions (locked)
1. Storage engine: **IndexedDB primary**, `localStorage` only for tiny metadata (token, activeClubId, sync timestamps).
2. Startup strategy: **Local-first render**, then background sync.
3. Network strategy: **Bootstrap once**, then **manifest/version check**, then only changed modules fetch.
4. Freshness strategy: **Socket events = primary invalidation**, manifest polling = fallback.
5. Verification strategy: lightweight checks frequent, full reconciliation daily/on-demand.

## Public API / Interface Changes

### New backend endpoints
1. `GET /member/bootstrap`
- Returns all member dashboard modules in one response + per-module version map.
2. `GET /owner/bootstrap`
- Returns all owner dashboard modules in one response + per-module version map.
3. `GET /member/sync-manifest`
- Returns versions/checksums for member modules only.
4. `GET /owner/sync-manifest`
- Returns versions/checksums for owner modules only.
5. `GET /member/module/:name`
- Returns a single module payload by name with version.
6. `GET /owner/module/:name`
- Returns a single module payload by name with version.

### Manifest contract (example)
- `versions`: `{ dashboard: "v123", events: "v57", announcements: "v12", polls: "v41", ... }`
- `generatedAt`: ISO timestamp
- `clubId`, `userId`

### Client data-layer interfaces
Add in frontend:
- `loadFromCache(moduleName, userId, clubId)`
- `saveToCache(moduleName, payload, version, syncedAt)`
- `markDirty(moduleName, reason)`
- `syncChangedModules()`
- `fullReconcile()`

## File-Level Implementation Plan

1. Create data store layer
- Add [data-store.js](C:/Users/ayush_lr8ru2y/Desktop/Club%20Connect/frontend/data-store.js)
- IndexedDB object stores:
- `module_cache`
- `sync_meta`
- `pending_actions` (future offline writes ke liye reserve)

2. Create sync engine
- Add [sync-engine.js](C:/Users/ayush_lr8ru2y/Desktop/Club%20Connect/frontend/sync-engine.js)
- Responsibilities:
- bootstrap fetch
- manifest fetch
- changed module refresh
- stale reconciliation
- online/offline handlers
- foreground/background sync scheduling

3. Wire member dashboard to data-layer
- Update [member-dashboard.js](C:/Users/ayush_lr8ru2y/Desktop/Club%20Connect/frontend/member-dashboard.js)
- All `load*` functions direct fetch ke bajay cached repository use karein.
- Page switch par network call disable by default.
- Socket event par only related module dirty mark + background refresh.
- `loadNotifications` and `refreshNotificationBadge` duplicate fetches merge.

4. Wire owner dashboard to unified cache
- Update [owner-dashboard.js](C:/Users/ayush_lr8ru2y/Desktop/Club%20Connect/frontend/owner-dashboard.js)
- Existing `moduleCache(Map)` ko IndexedDB-backed persistent cache se replace/bridge.
- `cache: 'no-cache'` force flags remove where not needed.
- Route mismatch fix in plan: frontend `/owner/advanced-analytics` vs backend `/owner/analytics` unify to one route.

5. Add service worker
- Add [sw.js](C:/Users/ayush_lr8ru2y/Desktop/Club%20Connect/frontend/sw.js)
- Register in [member-dashboard.html](C:/Users/ayush_lr8ru2y/Desktop/Club%20Connect/frontend/member-dashboard.html) and [owner-dashboard.html](C:/Users/ayush_lr8ru2y/Desktop/Club%20Connect/frontend/owner-dashboard.html)
- Strategy:
- static assets: cache-first
- module API snapshots: stale-while-revalidate
- bootstrap/manifest: network-first with short timeout fallback to cache

6. Backend sync support
- Update [server.js](C:/Users/ayush_lr8ru2y/Desktop/Club%20Connect/backend/server.js)
- Add bootstrap/manifest/module endpoints.
- Add module version generator per user+club+module.
- Mutation endpoints par module version bump/invalidation hook.
- Add optional `ETag` for module responses.

7. Backend version state persistence
- Add model e.g. `SyncState` in [models](C:/Users/ayush_lr8ru2y/Desktop/Club%20Connect/backend/models)
- Fields: `clubId`, `userScope(optional)`, `module`, `version`, `updatedAt`
- Ensure server restart ke baad bhi version continuity rahe.

## Data Modules to Cache (Decision Complete)
Member modules:
- `dashboard`, `events`, `attendance`, `leaderboard`, `announcements`, `polls`, `myProjects`, `profile`, `certificates`, `notifications`, `messagesContacts`, `messagesByRecipient`

Owner modules:
- `dashboardStats`, `members`, `events`, `announcements`, `polls`, `certificates`, `projectProgress`, `analytics`, `workshops`, `notifications`, `messagesContacts`, `messagesByRecipient`

Never cache as authoritative:
- attendance scan token/session live endpoints
- write endpoints (POST/PUT/DELETE responses only for optimistic patch, not source of truth)

## Runtime Flow

1. App open
- Read cached modules from IndexedDB.
- Render immediate UI from cache.
- In background call manifest.
- If first install/no cache, call bootstrap once and fill cache.

2. Normal navigation
- Serve from local cache only.
- No repeat API on tab/page switch.

3. Change detection
- Socket event -> mark module dirty -> background fetch changed module.
- If socket unavailable, manifest poll every 60s (foreground) and on app resume/online event.

4. Reconciliation
- If module version changed: replace cache with server payload.
- If IDs missing on server: local stale records remove.
- If server has new records: local add.
- Daily full reconcile or manual pull-to-refresh.

## Invalidation Matrix
- New event/delete event/update attendance -> invalidate `events`, `dashboard`, `attendance`, `analytics`
- Announcement create/delete -> invalidate `announcements`, `dashboard`
- Poll create/vote/close/delete -> invalidate `polls`, `dashboard`, `analytics`
- Member add/remove/award points/role change -> invalidate `members`, `leaderboard`, `dashboard`, `analytics`
- Profile change -> invalidate `profile` (+ header user meta)
- Message send/read -> invalidate `messagesContacts`, conversation module
- Notification read/read-all -> invalidate `notifications` and badge meta

## Test Cases and Scenarios

1. Cold start with cache
- App opens instantly and shows cached data before network.
2. Cold start without cache
- Bootstrap loads all required modules once and persists.
3. Page switching stress
- 20+ navigations without redundant network fetch.
4. Offline mode
- Airplane mode me full dashboard usable with cached data.
5. Online resume
- Back online आते ही manifest check + changed module sync.
6. Socket invalidation
- Owner creates event, member app auto-refreshes only `events` module.
7. Data deletion reconciliation
- Server se deleted event local store se remove after sync.
8. Club switch
- Cache namespace change by `userId+clubId`, wrong-club bleed ना हो.
9. Logout/login different user
- Previous user cache inaccessible and isolated.
10. Large dataset
- 5k+ records cache load and query performance acceptable.

## Rollout Plan
1. Phase 1: Data-layer + Member dashboard migration.
2. Phase 2: Owner dashboard migration + existing Map cache deprecate.
3. Phase 3: Backend manifest/bootstrap/version hooks.
4. Phase 4: Service worker + offline hardening.
5. Phase 5: QA + telemetry + production gradual enable via feature flag.

## Observability
- Metrics:
- bootstrap latency
- cache hit ratio per module
- manifest poll frequency
- stale reconciliation count
- API call count per session
- Error logs:
- sync failure reason
- module parse/store errors
- version mismatch conflicts

## Assumptions and Defaults
1. Multi-tab sync conflicts low priority; last-write-wins cache update acceptable.
2. Storage limit concern ignored per your requirement; IndexedDB growth allowed.
3. Security default: cache clear on logout for current user namespace.
4. Manifest interval default 60s; app resume par immediate sync.
5. Full verify (hard reconcile) default every 24h + manual trigger.
6. If backend version endpoint fails, app continues local mode and retries exponentially.

