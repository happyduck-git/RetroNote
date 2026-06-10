**English** | [한국어](README.ko.md)

# retro-note

A cozy retro CRT terminal for quick thoughts. Always on top, always within reach.

<!-- Add a screenshot or short GIF here, e.g. docs/preview.gif -->

## What is it

retro-note is a single-screen note-taking app styled like an old CRT computer. Open it, type, save. No folders, no markdown, no sync — just a place to dump a thought before it slips away.

Built with Tauri 2, runs natively on macOS and Windows.

## Features

- CRT green-on-black aesthetic with mechanical keystroke sound
- Always-on-top, transparent, borderless retro chassis
- One file per note, saved as plain `.txt` to your Documents folder
- Drag the chassis anywhere on screen
- Resize via the green triangle grip (bottom-right) or keyboard shortcuts
- Aspect ratio is locked to keep the chassis art intact
- Mute toggle for the keystroke sound
- **Chat rooms** — join a room by code and chat in real time (optional, needs a free Supabase project)

## Keyboard shortcuts

| Action | macOS | Windows |
|---|---|---|
| Resize larger | `⌘ =` | `Ctrl =` |
| Resize smaller | `⌘ -` | `Ctrl -` |
| Reset to default size | `⌘ 0` | `Ctrl 0` |
| Pinch zoom | `⌘` + scroll | `Ctrl` + scroll |

## Where are my notes?

Saved as plain `.txt` files in:

- **macOS**: `~/Documents/retro-notes/`
- **Windows**: `C:\Users\<you>\Documents\retro-notes\`

Filename pattern: `note_YYYY-MM-DD_HH-MM.txt`

## Chat

On launch the screen offers **[ NOTE ]** and **[ CHAT ]**. Pick CHAT and:

1. Set a nickname once (stored locally, asked only the first time).
2. **Create a room** to get a 6-character code, or **join** by typing a code someone shared.
3. Chat in real time. Anyone who joins later sees **only messages sent after they joined** — there is no history.

Room codes are the only access control, so don't share sensitive information.

### Set up chat (Supabase)

Chat needs a realtime backend. The [Supabase](https://supabase.com) **free plan** is plenty:

1. Create a free Supabase project.
2. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.
3. Copy the template and fill it in (`config.local.js` is gitignored, so your keys stay out of the repo):
   ```bash
   cp src/config.local.example.js src/config.local.js
   ```
   ```js
   // src/config.local.js
   export const SUPABASE = {
     url: "https://YOUR-PROJECT.supabase.co", // base URL only, no /rest/v1 path
     anonKey: "YOUR-ANON-PUBLIC-KEY",
   };
   ```
   `src/config.js` loads these keys at runtime if present; without `config.local.js` the app still runs with chat disabled.
4. Rebuild / re-run. If both values are empty, the **[ CHAT ]** button stays disabled and only notes work.

Notes:
- The anon key is a publishable key — it's safe to commit. Keep Supabase's **Realtime Authorization** at its default (off) so anonymous clients can use broadcast channels.
- Free-plan projects pause after ~1 week of inactivity; click **Restore** in the dashboard to resume (still free, data intact).
- This app ships with `csp: null`, so WebSocket connections are allowed. If you later set a Content-Security-Policy, add `connect-src https://*.supabase.co wss://*.supabase.co`.

## Build from source

Requires Node.js, Rust (with Cargo), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev      # development
npm run tauri build    # production binary
```

The production build outputs to `src-tauri/target/release/bundle/` — `.dmg` on macOS, `.msi` / `.exe` on Windows.

## Tech

- [Tauri 2](https://tauri.app/) — Rust backend, system WebView frontend
- Vanilla HTML / CSS / JS — no frontend build step
- Web Audio API for the keystroke sound

## License

TBD
