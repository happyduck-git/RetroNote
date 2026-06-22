# src-tauri/ — native (Rust) layer

Intentionally thin. `src/lib.rs` registers the fs plugin and, in `setup`, disables the DWM window shadow **on Windows only** (the borderless transparent chassis would otherwise show a rectangular frame; macOS keeps its shadow). `src/main.rs` just calls `run()`.

## Capabilities allowlist

Whatever Tauri API the WebView is allowed to call is enumerated in `capabilities/default.json` (window controls, `fs:*` permissions, etc.). **Adding a new Tauri API call from the frontend usually means adding its permission here** — otherwise the call is rejected at runtime.

## Config & versioning

- `tauri.conf.json`: `frontendDist` is `../src` (no build step), `csp: null`, borderless/transparent/always-on-top window, bundle targets `all`. The app version lives here and in `Cargo.toml` — keep them in sync when releasing.
- The auto-updater plugin **is** wired up: `tauri-plugin-updater` + `tauri-plugin-process` in `Cargo.toml`/`lib.rs`, `plugins.updater` (+ `bundle.createUpdaterArtifacts`) in `tauri.conf.json`, `updater:default` + `process:allow-restart` in `capabilities/`, and the frontend check in `src/platform/updater.js`. Before a real release you must replace the `pubkey` placeholder with the actual signer public key and register the `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` GitHub Secrets (see the root `CLAUDE.md` Release section).
- **Local release builds need the signing key.** With `createUpdaterArtifacts: true`, `npm run tauri build` signs the updater artifacts and **fails if `TAURI_SIGNING_PRIVATE_KEY` (and `_PASSWORD`) are not set** in the environment. CI injects them from Secrets; for a local full build, export them first (e.g. from `retronote.key`). `npm run tauri dev` and `cargo check` are unaffected.
