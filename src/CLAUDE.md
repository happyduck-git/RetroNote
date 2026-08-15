# src/ — frontend

Vanilla ES modules, no build step. Loaded directly by the Tauri WebView.

## Bootstrap & view router

`main.js` is the entry point: it initializes window controls + sound, calls `loadConfig()`, registers views, then gates routing on auth (login required only if chat is configured). `core/router.js` is a tiny state machine — a view is `{ mount(screenEl, params, ctx), unmount?() }`. `navigate()` always `unmount()`s the previous view before mounting the next. **Clean up channel subscriptions / timers in `unmount()`** — that is the leak-prevention contract.

## Chat is optional and config-gated

Chat only activates if Supabase keys are present. `config.js` ships with empty defaults and `loadConfig()` dynamically imports the **gitignored** `config.local.js` (copied from `config.local.example.js`) at runtime to merge real keys. No keys → `isChatConfigured()` is false → app runs in notes-only mode, no login required.

## Transport abstraction

`chat/transport.js` defines a backend-agnostic pub/sub contract (`connect/send/leave/on/track`); `supabase-transport.js` implements it over Supabase Realtime. Key design: **sending a message is a single DB INSERT** — `postgres_changes` echoes it back to all subscribers (including the sender). The wire envelope is uniform: `{ id, clientId, nickname, text, ts }`. Swapping backends means implementing the same contract with no UI changes.

## 연결 복구 (reconnect)

실시간 채널은 창을 오래 숨겨 두면 조용히 죽고, 라이브러리 혼자서는 못 살아나는 경우가 있다
(채널이 `CLOSED` 되면 스스로 소켓 목록에서 빠지고, 숨은 동안에는 소켓이 재접속을 포기한다).
그래서 복구는 앱이 소유한다: `chat/reconnect-controller.js` 가 **언제 다시 붙을지**를 결정하고,
복구는 항상 **옛 채널 버리고 새 채널로 재구독**(`transport.reconnect()` / `messageNotifier.reconnect()`)이다.

- 시도 시점: 창 포커스·보이기·`online` 이벤트(넷 다 듣는다 — 플랫폼마다 빠지는 게 있다),
  transport 의 error/closed/timeout, 1초 tick 워치독, 사용자가 상태를 클릭했을 때.
- 간격: `RETRY_DELAYS_MS = [0, 2s, 5s, 10s, 30s]` — 30초에서 멈춘다. 창이 앞으로 오면 처음으로 되돌린다.
  붙자마자 끊기는(flap) 경우엔 벌점을 매겨 간격을 벌리고, 30초 넘게 잘 붙어 있으면 벌점을 씻는다.
- 좀비 판별: 상태가 `connected` 여도 `isHealthy()`(채널이 실제로 `joined`)가 거짓이거나
  복귀 시 `backfill()` 이 실패하면 죽은 것으로 보고 다시 붙인다.
- 재연결 직전 `ensureFreshSession()` 으로 만료된 토큰을 갱신한다 — 만료 토큰으로 붙으면 서버가 거절한다.
- 화면 상태 4가지(`connecting/connected/recovering/waiting`)는 `views/conn-status.js` 가 문구로 바꾼다.
- 전역 알림 채널은 `chat/notifier-connection.js` 가 감독한다. **재연결이 안 읽음 카운터를 지우면 안 되므로**
  `message-notifier` 의 채널 정리(`teardownChannel`)와 카운터 정리(`stop`)는 분리돼 있다.

## Message store (memory only; Postgres is source of truth)

`chat/message-store.js` holds the displayed list in memory and **dedups by `id`** (because the sender receives its own INSERT echo). Ownership (`mine`) is decided by `senderUid` vs the logged-in `auth.uid()`, **not** by `clientId` (so the same account on another device shows as "you"). Display name is each message's own frozen `sender_nickname` (the envelope `nickname`) — never re-resolved. Changing a nickname does **not** touch past messages; the new name only applies to messages sent afterward (anonymization, issue #49). The `messages` table is never rewritten.

## Session & cross-device sync

`chat/session.js` owns device-local state in `localStorage` (clientId, per-room nickname, saved-rooms list with aliases) and reconciles it against the server's `room_memberships` rows. Policy is **server-priority** (server value wins on conflict). A session-scope guard clears device-local data when the logged-in user changes (A→B) so one account's rooms/nicknames never leak into another's screen. `auth/auth.js` is a Supabase Auth singleton; the vendor bundle is dynamically imported on first use (zero load cost in notes-only builds).

## Notes

`platform/notes-fs.js` writes plain `.txt` to `Documents/retro-notes/` via the Tauri fs plugin — unrelated to the DB/chat path.

## Screensaver

`platform/screensaver.js` — 3 minutes with no in-app input (mouse/keyboard/wheel) mounts a canvas overlay over the CRT screen area on **every** view; any input dismisses it instantly, restoring the previous state (pure overlay — no routing, and the waking keydown/click is swallowed so it can't hit UI underneath, e.g. the close button). Incoming chat messages do NOT dismiss it. Two scenes (`screensaver-scenes.js`: starfield / matrix rain) alternate per activation until one is chosen (issue #73 comparison phase); pin one via localStorage `retro-note.screensaver-scene`, or preview instantly from the devtools console with `__screensaver.show("matrix")`.

## Conventions

- Prefer dependency-injection factories for testable logic (e.g. `makeChangeRoomNickname` in `session.js` takes its collaborators so tests can pass fakes; the default export wires the real module state).
- The app ships with `csp: null` to allow Supabase WebSocket connections. If you ever set a Content-Security-Policy, add `connect-src https://*.supabase.co wss://*.supabase.co`.
- The Supabase anon key is a publishable key — safe to commit; real keys still go only in gitignored `config.local.js`.
