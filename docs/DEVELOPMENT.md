**English** | [한국어](DEVELOPMENT.ko.md)

# Development & self-hosting

How to build retro-note from source and stand up the optional chat backend. **End users don't need any of this** — see the [README](../README.md) for using the app.

## Build from source

Requires Node.js, Rust (with Cargo), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev      # development
npm run tauri build    # production binary
```

The production build outputs to `src-tauri/target/release/bundle/` — `.dmg` on macOS, `.msi` / `.exe` on Windows.

## Chat backend (Supabase)

Chat is optional and needs a realtime backend. The [Supabase](https://supabase.com) **free plan** is plenty. Without it, the app still runs with chat disabled.

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
   `src/config.js` loads these keys at runtime if present.
4. **Apply the database schema.** In the Supabase dashboard → **SQL Editor**, run the migrations in `db/migrations/` in filename order (`0001_baseline.sql` → `0004_add_membership_alias.sql`). These create the `messages` and `room_memberships` tables and the row-level security policies chat relies on. See [`db/README.md`](../db/README.md).
5. **Enable email sign-in.** Chat requires an account (Supabase Auth, email + password). The default Email provider is fine; if you leave email confirmation on, new users must confirm before they can sign in.
6. Rebuild / re-run. If both values are empty, the **[ CHAT ]** button stays disabled and only notes work.

Notes:
- The anon key is a publishable key — it's safe to commit. Chat uses authenticated Realtime (`postgres_changes`) over RLS-protected tables, so each user must be signed in; access is enforced by the row-level security policies from the migrations.
- Free-plan projects pause after ~1 week of inactivity; click **Restore** in the dashboard to resume (still free, data intact).
- This app ships with `csp: null`, so WebSocket connections are allowed. If you later set a Content-Security-Policy, add `connect-src https://*.supabase.co wss://*.supabase.co`.
