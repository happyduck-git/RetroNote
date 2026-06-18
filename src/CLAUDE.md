# src/ — frontend

Vanilla ES modules, no build step. Loaded directly by the Tauri WebView.

## Bootstrap & view router

`main.js` is the entry point: it initializes window controls + sound, calls `loadConfig()`, registers views, then gates routing on auth (login required only if chat is configured). `core/router.js` is a tiny state machine — a view is `{ mount(screenEl, params, ctx), unmount?() }`. `navigate()` always `unmount()`s the previous view before mounting the next. **Clean up channel subscriptions / timers in `unmount()`** — that is the leak-prevention contract.

## Chat is optional and config-gated

Chat only activates if Supabase keys are present. `config.js` ships with empty defaults and `loadConfig()` dynamically imports the **gitignored** `config.local.js` (copied from `config.local.example.js`) at runtime to merge real keys. No keys → `isChatConfigured()` is false → app runs in notes-only mode, no login required.

## Transport abstraction

`chat/transport.js` defines a backend-agnostic pub/sub contract (`connect/send/leave/on/track`); `supabase-transport.js` implements it over Supabase Realtime. Key design: **sending a message is a single DB INSERT** — `postgres_changes` echoes it back to all subscribers (including the sender). The wire envelope is uniform: `{ id, clientId, nickname, text, ts }`. Swapping backends means implementing the same contract with no UI changes.

## Message store (memory only; Postgres is source of truth)

`chat/message-store.js` holds the displayed list in memory and **dedups by `id`** (because the sender receives its own INSERT echo). Ownership (`mine`) is decided by `senderUid` vs the logged-in `auth.uid()`, **not** by `clientId` (so the same account on another device shows as "you"). Display name resolution order: live `nicknameMap` → latest snapshot per sender → envelope `nickname`. Changing a nickname mutates one map entry and re-renders all of that sender's past messages without touching the `messages` table.

## Session & cross-device sync

`chat/session.js` owns device-local state in `localStorage` (clientId, per-room nickname, saved-rooms list with aliases) and reconciles it against the server's `room_memberships` rows. Policy is **server-priority** (server value wins on conflict). A session-scope guard clears device-local data when the logged-in user changes (A→B) so one account's rooms/nicknames never leak into another's screen. `auth/auth.js` is a Supabase Auth singleton; the vendor bundle is dynamically imported on first use (zero load cost in notes-only builds).

## Notes

`platform/notes-fs.js` writes plain `.txt` to `Documents/retro-notes/` via the Tauri fs plugin — unrelated to the DB/chat path.

## Conventions

- Prefer dependency-injection factories for testable logic (e.g. `makeChangeRoomNickname` in `session.js` takes its collaborators so tests can pass fakes; the default export wires the real module state).
- The app ships with `csp: null` to allow Supabase WebSocket connections. If you ever set a Content-Security-Policy, add `connect-src https://*.supabase.co wss://*.supabase.co`.
- The Supabase anon key is a publishable key — safe to commit; real keys still go only in gitignored `config.local.js`.
