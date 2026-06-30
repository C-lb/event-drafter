# Desktop app packaging design (Windows primary, macOS secondary)

Date: 2026-06-30
Status: draft spec (preparation) — not yet planned/implemented

## Goal

Ship event-drafter as a downloadable desktop app that bundles the worker, so a
non-technical operator installs one file, opens it, logs into WhatsApp once, and
everything (web UI + background worker + local DB) runs inside the app. Launch
targets (both, confirmed 2026-06-30): **Windows** (`.exe` / `.msi`) and **macOS**
(`.dmg` / `.pkg`), from one Electron setup. Windows is where the worker runs
today, so smoke-test there first; macOS ships in the same release.

Android `.apk` is explicitly out of scope: the worker automates WhatsApp Web in a
real desktop Chromium via Playwright; there is no desktop Chromium to drive on
Android, and a Node + Playwright + Chromium stack cannot run inside an APK. A
mobile build would be a different product (accessibility automation or the
WhatsApp Business API), not a repackage of this codebase.

## Current architecture (verified facts)

- Monorepo, three workspaces: `@event-drafter/web` (Next.js App Router, SSR + API
  routes + server actions — needs a running Node server, not a static export),
  `@event-drafter/worker` (long-running Node process, the poll loop), and
  `@event-drafter/core` (Drizzle over **better-sqlite3**, a native module).
- The worker drives WhatsApp Web with **Playwright** (`playwright ^1.49.0`),
  `chromium.launchPersistentContext(PROFILE_DIR, { headless: false, ... })` —
  i.e. a **visible** Chromium window pointed at a persistent profile dir. The QR
  login and the live WhatsApp session live in that profile.
- Web and worker share one SQLite file and communicate only through it. Today
  they are launched together via `concurrently` with two env vars:
  `ED_DB_PATH` and `ED_WA_PROFILE_DIR`. Other worker env: `ED_DRAFT_CONCURRENCY`,
  `ED_WORKER_LOCK_PORT` (a localhost port the singleton lock binds).
- Runtime secrets/config come from `.env` and the in-app Setup flow:
  `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Google tokens and most settings
  are already persisted in the DB `settings` table via the Setup pages.
- macOS autostart exists today as a launchd plist (`launchd/`); Windows currently
  runs it by hand. The desktop app replaces both: the app process owns lifecycle.

## Target: Electron

Electron (a runtime bundling Node.js + Chromium into one installable app) is the
right fit because this stack is already Node + Chromium + SQLite. (Tauri was
considered and rejected: its sidecar story for a Node worker + better-sqlite3 +
Playwright is more friction than Electron, which is Node-native.)

### Process model

- **Electron main process** (Node): on launch,
  1. resolve the per-user data dir from `app.getPath('userData')` and set
     `ED_DB_PATH = <userData>/app.db`, `ED_WA_PROFILE_DIR = <userData>/wa-profile`
     so data persists across app updates;
  2. run DB migrations (`@event-drafter/core/migrate`);
  3. start the Next.js server on a free localhost port (in-process via Next's
     programmatic API, or a forked `next start`);
  4. fork the **worker** as a child process with the same env;
  5. create a `BrowserWindow` that loads `http://127.0.0.1:<port>`.
- **Worker child process**: unchanged logic. Its Playwright `chromium` opens a
  SEPARATE visible Chromium window for WhatsApp Web. UX note: the operator sees
  two windows — the app (UI) and the WhatsApp Web automation window. That is
  acceptable and matches today's behavior; document it. (Option later: hide/manage
  that window, but headful is required for WhatsApp's anti-bot tolerance, so keep
  it visible at first.)
- **Lifecycle**: quitting the app stops the worker child and closes the Next
  server. The existing singleton lock (`ED_WORKER_LOCK_PORT`) still prevents two
  workers; pick a fixed port and surface a clear error if it is taken.

### The native module: better-sqlite3

better-sqlite3 is compiled C++ and must match Electron's V8/Node ABI, not the
system Node. Rebuild it for the packaged runtime with `@electron/rebuild` in the
build step, and mark it `asarUnpack` (native `.node` files cannot load from
inside an asar archive). Verify on both Windows and macOS arch targets.

### The browser: Playwright Chromium

Playwright downloads its browsers to a cache (`%LOCALAPPDATA%\ms-playwright` /
`~/Library/Caches/ms-playwright`), which an installed app cannot rely on. Bundle
the Chromium build as an app resource and set `PLAYWRIGHT_BROWSERS_PATH` to that
bundled path before the worker launches. Use electron-builder `extraResources` to
ship the matching Playwright Chromium per platform; pin the Playwright version so
the bundled browser matches the library. Expect roughly 150 to 300 MB added to the
installer from Chromium.

### Secrets and config

Do NOT bundle `ANTHROPIC_API_KEY` or the Google client secret into the
distributed binary — anything shipped can be extracted. Drive it through the
existing in-app Setup flow instead: the operator enters their own keys on first
run, stored in the DB `settings` (and OS keychain for the most sensitive, via
`safeStorage`, as a follow-up). The Google OAuth `redirect_uri` must point at the
app's localhost callback port; register that redirect in the Google console. Audit
any place that reads `process.env.ANTHROPIC_API_KEY` directly and give it a
settings-backed fallback so a packaged app with no `.env` still works.

### Packaging and distribution

- **electron-builder** produces: Windows **NSIS `.exe`** + **`.msi`** (per-user
  install, no admin), macOS **`.dmg`** and **`.pkg`**, both arch where relevant.
- **Code signing** (the annoying-but-required part):
  - Windows: an Authenticode (OV or EV) certificate, else SmartScreen warns on
    first run.
  - macOS: Apple Developer ID signing + **notarization**, else Gatekeeper blocks
    it. Needs an Apple Developer account.
- **Auto-update** (optional, later): electron-updater against a release feed
  (GitHub Releases or S3).

## Work breakdown (for the eventual plan)

1. Electron shell: main process boots Next server + worker child, window loads
   localhost, data dir wired to `userData`, migrations on launch. (Largest task.)
2. Native module + browser bundling: `@electron/rebuild` for better-sqlite3,
   `PLAYWRIGHT_BROWSERS_PATH` + bundled Chromium, asarUnpack. Verify a packaged
   build actually launches WhatsApp Web and writes the DB.
3. Config without `.env`: settings-backed fallbacks for the API keys + Google
   redirect on the localhost port; first-run Setup confirmed end to end.
4. electron-builder config: Windows `.exe`/`.msi` target green and installable on
   a clean Windows machine (unsigned dev build first).
5. Signing + notarization: certs wired into the build for both OSes.
6. (Optional) auto-update.

## Risks / open questions

- **Two-window UX** (app + WhatsApp automation window). Acceptable initially;
  revisit if confusing.
- **WhatsApp ban risk** from automation is unchanged by packaging (already true
  today), but distributing the tool widens exposure — keep it an internal tool.
- **Signing certs** are the real lead-time item (especially Apple notarization and
  a Windows OV/EV cert). Start that procurement early if both OSes are wanted.
- **OS targets: both Windows and macOS at launch** (confirmed). Practical
  consequence: start the Apple Developer enrollment + notarization setup and the
  Windows code-signing cert (OV/EV) procurement EARLY — these are the long
  lead-time items and gate a distributable (non-warning) build on each OS.
- **better-sqlite3 + Electron ABI** can be finicky across Electron upgrades; pin
  Electron and rebuild in CI.

## Non-goals

- Android / iOS.
- Rewriting the worker or web logic — this is packaging, not a re-architecture.
- A hosted/multi-tenant version (this stays a single-operator desktop tool).
