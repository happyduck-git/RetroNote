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
