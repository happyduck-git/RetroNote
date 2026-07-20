# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

retro-note is a Tauri 2 desktop app (macOS + Windows): a single-screen, always-on-top CRT-styled note pad, plus an **optional** real-time chat backed by Supabase. The frontend is vanilla HTML/CSS/JS ES modules loaded directly by the system WebView — **there is no frontend build step or bundler**. `tauri.conf.json` points `frontendDist` at `../src`, so files in `src/` are served as-is.

Code comments are written in Korean. Match that style when editing existing files.

## Commands

```bash
npm install                # deps (Tauri CLI, supabase CLI, pg)
npm run tauri dev          # run app in dev
npm run tauri build        # production bundle → src-tauri/target/release/bundle/

npm test                   # unit tests (fakes injected; no DB needed)
node --test src/chat/message-store.test.js   # run a single unit test file
npm run test:integration   # scenario tests against a real LOCAL Supabase stack
npm run db:start           # supabase start (needs Docker Desktop running)
npm run db:stop
```

`npm test` runs a fixed list of files (see `package.json` `scripts.test`); new unit tests must be added to that list to run in CI. Integration tests auto-read URL/keys via `supabase status -o env`.

## Two test layers (this distinction matters)

- **Unit** (`*.test.js` next to source): pure logic with server/storage **faked**. They cannot catch DB-level issues (RLS, sessions, Realtime).
- **Integration** (`test/integration/`, see its `README.md`): boots the actual app modules against a local Supabase stack (Postgres + Auth + PostgREST + Realtime), replaying `db/migrations/*.sql`. This layer exists because an RLS infinite-recursion bug (Postgres `42P17`) once blocked room entry and unit tests were blind to it. Prefer adding/extending an integration scenario when touching RLS, auth, membership, or Realtime.

## Where to look

Subdirectories carry their own `CLAUDE.md` with deeper detail (loaded on demand):

- `src/CLAUDE.md` — frontend bootstrap, view router, chat architecture (transport / message store / session).
- `db/CLAUDE.md` — schema, RLS rules and the `42P17` recursion trap, migration workflow.
- `src-tauri/CLAUDE.md` — the thin Rust layer and the Tauri capabilities allowlist.

## Release / CI

`.github/workflows/release.yml` builds and drafts a GitHub Release on `v*` tags via `tauri-action` (macOS arm64 + x64 with code-signing/notarization when secrets are set, Windows). It also attaches an unsigned Windows portable `.exe`, and CI injects the gitignored `src/config.local.js` from secrets. Pet sprite PNGs (a paid asset) are likewise absent from the repo; release CI checks out a private assets repo (its `owner/name` lives in the `PET_ASSETS_REPO` repository variable) via a read-only deploy key (`PET_ASSETS_DEPLOY_KEY`) and copies them into `src/assets/pet/<color>/` at build time. Release notes (which become the app updater dialog's "변경 내용" + `latest.json`'s `notes`) are resolved by `scripts/format-release-notes.sh`, which takes one of two paths: if `release-notes/<tag>.md` exists it is used **verbatim** (hand-written, user-facing wording — the preferred path); otherwise it falls back to cleaning GitHub's `generate-notes` output, dropping authors, PR/issue numbers, and release/version-bump PR lines. To hand-write them, scaffold the auto-generated list first with `npm run notes:draft -- <tag> <branch>` (writes `release-notes/<tag>.md`; refuses to clobber an existing file without `--force`), then edit it down to user-facing wording. **CI checks out the tagged commit, so the notes file must be committed before you tag** — put it in the version-bump PR so the wording gets reviewed alongside the bump. **Preview before tagging: `npm run notes:preview -- <tag> <branch>`** (e.g. `v0.1.12 main`) — CI and the preview share this script, so what you see is what ships; CI also echoes the notes into the Actions run summary, and the release is drafted (not published), so you get a second look before hitting Publish. Note that editing a draft release's body on GitHub does **not** change `latest.json`'s `notes`, so the in-app updater dialog would still show the original text — fix wording in `release-notes/<tag>.md` before tagging rather than in the draft. The Tauri auto-updater **is** wired up — the updater artifacts (`*.app.tar.gz` / installer `.sig`) are kept (an old `cleanup` job that deleted them was removed). `build-windows.yml` builds Windows installers as artifacts only (no release) for manual verification.
