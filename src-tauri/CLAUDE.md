# src-tauri/ — native (Rust) layer

Intentionally thin. `src/lib.rs` registers the fs plugin and, in `setup`, disables the DWM window shadow **on Windows only** (the borderless transparent chassis would otherwise show a rectangular frame; macOS keeps its shadow). `src/main.rs` just calls `run()`.

## Capabilities allowlist

Whatever Tauri API the WebView is allowed to call is enumerated in `capabilities/default.json` (window controls, `fs:*` permissions, etc.). **Adding a new Tauri API call from the frontend usually means adding its permission here** — otherwise the call is rejected at runtime.

## Config & versioning

- `tauri.conf.json`: `frontendDist` is `../src` (no build step), `csp: null`, borderless/transparent/always-on-top window, bundle targets `all`. The app version lives here and in `Cargo.toml` — keep them in sync when releasing.
- The auto-updater plugin is **not** wired up yet (see the root `CLAUDE.md` Release section — CI currently deletes the updater artifacts). Enabling it would touch `Cargo.toml`, `tauri.conf.json` (`plugins.updater` + pubkey), `lib.rs`, and `capabilities/`.
