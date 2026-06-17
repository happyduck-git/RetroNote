**English** | [한국어](README.ko.md)

# retro-note

A cozy retro CRT terminal for quick thoughts. Always on top, always within reach.

<!-- Add a screenshot or short GIF here, e.g. docs/preview.gif -->

## What is it

retro-note is a single-screen note-taking app styled like an old CRT computer. Open it, type, save. No folders, no markdown, no sync — just a place to dump a thought before it slips away.

Looks like a note app — but it's secretly an anonymous chat, too. Join a room by code and talk in real time under nothing but a nickname.

Built with Tauri 2, runs natively on macOS and Windows.

## Features

- CRT green-on-black aesthetic with mechanical keystroke sound
- Always-on-top, transparent, borderless retro chassis
- One file per note, saved as plain `.txt` to your Documents folder
- **Chat rooms** — join a room by code and chat in real time, with persisted message history (optional, requires an account)

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

1. **Sign in** (or sign up) with an email and password. Chat data is tied to your account, so your rooms, nicknames, and history follow you across devices.
2. Set a nickname (asked the first time).
3. **Create a room** to get a 6-character code, or **join** by typing a code someone shared.
4. Chat in real time. **Messages are saved** — every time you come back (on any device you sign in to) you see the room's history from the moment you first joined. Messages sent before you joined a room are not shown.

Anyone with the room code can join and read history from their join time onward, so the room code is the only access control — don't share sensitive information.

## Development

Building from source or self-hosting the chat backend? See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Tech

- [Tauri 2](https://tauri.app/) — Rust backend, system WebView frontend
- Vanilla HTML / CSS / JS — no frontend build step
- Web Audio API for the keystroke sound

## License

[MIT](LICENSE) © 2026 happyduck
