# src-tauri/ — native (Rust) layer

Intentionally thin. `src/lib.rs` registers the fs plugin and, in `setup`, disables the DWM window shadow **on Windows only** (the borderless transparent chassis would otherwise show a rectangular frame; macOS keeps its shadow). `src/main.rs` just calls `run()`.

## Window lifecycle & single-instance (issue #89)

The two windows (`main`, `pet`) both persist for the whole process, so closing only `main` used to leave the process alive and a **second launch spawned a duplicate process → duplicate pet window**. `lib.rs` now handles this natively so there is only ever one process, hence one (static) pet window:

- **Close = hide-or-quit.** `.on_window_event` intercepts `CloseRequested` for the `main` label: if the pet is currently visible (`pet_is_visible`, checks the `pet` window's `is_visible()`, not the pref) it `prevent_close()`s and **hides** main (app + pet stay in the background, unsaved note draft / current view preserved); otherwise it `exit(0)`s the whole app. `Cmd+Q` still quits regardless.
- **Reveal.** `reveal_main()` (`unminimize` + `show` + `set_focus`) brings the hidden main window back.
- **Who calls reveal, per platform:** the app splits the job to dodge the confirmed macOS `single-instance` + `updater.relaunch()` breakage ([tauri #1692](https://github.com/tauri-apps/plugins-workspace/issues/1692) — the relaunched process gets killed by the still-held lock). **macOS:** no single-instance plugin; `.build()` + `app.run(|_, RunEvent::Reopen|)` reveals main on dock-icon reactivation (`Reopen` is macOS-only). **Windows/Linux:** `tauri-plugin-single-instance` (dep is target-gated to non-macOS, registered **first** in the builder chain per its README) routes a second launch into the existing process and reveals main from its callback.
- All of this is pure Rust (`Manager` API), so **no `capabilities/` permission is needed** and the frontend close button keeps calling `getCurrentWindow().close()` unchanged.

## Capabilities allowlist

Whatever Tauri API the WebView is allowed to call is enumerated in `capabilities/default.json` (window controls, `fs:*` permissions, etc.). **Adding a new Tauri API call from the frontend usually means adding its permission here** — otherwise the call is rejected at runtime.

## Config & versioning

- `tauri.conf.json`: `frontendDist` is `../src` (no build step), `csp: null`, borderless/transparent/always-on-top window, bundle targets `all`. The app version lives here and in `Cargo.toml` — keep them in sync when releasing.
- The auto-updater plugin **is** wired up: `tauri-plugin-updater` + `tauri-plugin-process` in `Cargo.toml`/`lib.rs`, `plugins.updater` (+ `bundle.createUpdaterArtifacts`) in `tauri.conf.json`, `updater:default` + `process:allow-restart` in `capabilities/`, and the frontend check in `src/platform/updater.js`. Before a real release you must replace the `pubkey` placeholder with the actual signer public key and register the `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` GitHub Secrets (see the root `CLAUDE.md` Release section).
- **Local release builds need the signing key.** With `createUpdaterArtifacts: true`, `npm run tauri build` signs the updater artifacts and **fails if `TAURI_SIGNING_PRIVATE_KEY` (and `_PASSWORD`) are not set** in the environment. CI injects them from Secrets; for a local full build, export them first (e.g. from `retronote.key`). `npm run tauri dev` and `cargo check` are unaffected.
