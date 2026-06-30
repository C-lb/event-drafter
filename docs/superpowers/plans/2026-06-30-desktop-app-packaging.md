# Desktop app packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). Steps use `- [ ]` checkboxes. NOTE: this is a packaging effort — most tasks are verified by *launching the app and observing behavior*, not by unit tests. Where a piece of pure logic exists (path/env resolution, port-wait), it gets a real unit test; the rest gets a concrete "run it, observe X" verification.

**Goal:** Ship event-drafter as an installable desktop app that bundles the worker, for **Windows (`.exe`/`.msi`) and macOS (`.dmg`/`.pkg`)**, so an operator installs one file, logs into WhatsApp once, and the web UI + background worker + local DB all run inside the app.

**Architecture:** A new `packages/desktop` Electron app. The Electron **main process** owns lifecycle: it resolves per-user data paths under `app.getPath('userData')`, runs DB migrations, forks the **Next.js production server** and the **worker** as Node child processes (using Electron's own Node via `ELECTRON_RUN_AS_NODE=1` so native modules share one ABI), waits for the server port, and loads `http://127.0.0.1:<port>` in a `BrowserWindow`. The worker's Playwright opens a separate visible WhatsApp window. Native deps (`better-sqlite3`, Playwright Chromium) are rebuilt/bundled for the packaged runtime. electron-builder produces the installers.

**Tech Stack:** Electron, electron-builder, `@electron/rebuild`, Node 22, the existing Next 16 web + Node worker + better-sqlite3 + Playwright.

## Global Constraints

- New package: `packages/desktop`, added to the root `workspaces`. Keep web/worker/core logic unchanged except the explicit config-fallback edits in Task 4.
- The worker and the web server run as **forked child processes of the Electron main**, launched with `ELECTRON_RUN_AS_NODE=1` and `execPath = process.execPath` (Electron's binary acting as Node), so `better-sqlite3` only needs to match ONE ABI (Electron's). Rebuild it with `@electron/rebuild` for that Electron version.
- Per-user data lives under `app.getPath('userData')`: `ED_DB_PATH=<userData>/app.db`, `ED_WA_PROFILE_DIR=<userData>/wa-profile`. Never write into the app install dir (read-only once signed).
- Both child processes get the same base env: `ED_DB_PATH`, `ED_WA_PROFILE_DIR`, `PLAYWRIGHT_BROWSERS_PATH` (bundled browser), `ED_WORKER_LOCK_PORT` (fixed), and the web server also gets `PORT`, `HOSTNAME=127.0.0.1`.
- Pin versions: `playwright` stays `^1.49.0` (the worker's version); the bundled Chromium MUST be the build that this Playwright version expects (install via `playwright install chromium` at the pinned version, ship it, point `PLAYWRIGHT_BROWSERS_PATH` at it).
- Do NOT bundle secrets. `ANTHROPIC_API_KEY` and the Google client secret come from the in-app Setup flow / DB `settings`, not `.env` and not the binary.
- First cut uses `asar: false` (plain files) for reliability with native modules; asar + `asarUnpack` is a later size optimization, not required to ship.
- Signing (Task 6) is gated on real certificates and a real Windows machine; it may be a separate session. Tasks 1-5 produce a working UNSIGNED build first.
- Core/worker/web are consumed from their built output (`dist/`, `.next/`); the desktop build depends on `npm run build` (root) having run first.
- Commit per task; push to `main` at the end (repo default, no PR).

## File structure

- `packages/desktop/package.json` — Electron app manifest + scripts + electron-builder config block.
- `packages/desktop/src/main.ts` — Electron main: lifecycle, window, fork children.
- `packages/desktop/src/runtime.ts` — pure helpers: `resolveRuntimeEnv()`, `waitForPort()`, `pickFreePort()`. Unit-tested.
- `packages/desktop/src/children.ts` — fork helpers for the Next server and the worker.
- `packages/desktop/src/runtime.test.ts` — unit tests for the pure helpers.
- `packages/desktop/electron-builder.yml` — build/targets/resources config (or inline in package.json `build`).
- `packages/desktop/resources/` — bundled Playwright browser lands here at build time (git-ignored; populated by a build script).
- Root `package.json` — add `packages/desktop` to `workspaces`, add `desktop:dev` / `desktop:dist` scripts.
- Edits in Task 4 only: wherever `process.env.ANTHROPIC_API_KEY` / Google client envs are read (audit in that task).

---

### Task 1: Electron skeleton — a window that loads the running web app

**Goal:** Prove Electron launches and can render the existing web UI. Assume a web dev server is already running on :3000 (you'll automate that in Task 2).

**Files:**
- Create: `packages/desktop/package.json`, `packages/desktop/src/main.ts`
- Modify: root `package.json` (add to `workspaces`, add `desktop:dev`)

- [ ] **Step 1: Create the package.**

`packages/desktop/package.json`:
```json
{
  "name": "@event-drafter/desktop",
  "version": "0.0.1",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "electron .",
    "test": "vitest run"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "@electron/rebuild": "^3.7.0",
    "electron-builder": "^25.1.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

Add a `packages/desktop/tsconfig.json` extending the base, compiling `src` → `dist`, module `commonjs` (Electron main is simplest as CJS), `outDir: dist`.

- [ ] **Step 2: Minimal main process.**

`packages/desktop/src/main.ts`:
```ts
import { app, BrowserWindow } from 'electron';

const APP_URL = process.env.ED_DESKTOP_URL ?? 'http://127.0.0.1:3000';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Event Drafter',
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(APP_URL);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

- [ ] **Step 3: Wire root scripts + workspace.** In root `package.json`: add `"packages/desktop"` to `workspaces`; add scripts:
```json
"desktop:dev": "npm -w @event-drafter/desktop run build && ED_DESKTOP_URL=http://127.0.0.1:3000 npm -w @event-drafter/desktop run start"
```

- [ ] **Step 4: Install + verify.** Run `npm install` (root), then in one terminal `npm run dev` (existing web+worker), in another `npm run desktop:dev`.
Expected: an Electron window opens and renders the Event Drafter home page (same UI as the browser), worker pill visible.

- [ ] **Step 5: Commit.**
```bash
git add packages/desktop package.json package-lock.json
git commit -m "feat(desktop): electron skeleton loads the web app"
```

---

### Task 2: Main process boots the web server + worker as children

**Goal:** The Electron app is self-contained in dev: it starts the Next production server and the worker itself, points data at `userData`, runs migrations, and loads the window when the server is up.

**Files:**
- Create: `packages/desktop/src/runtime.ts`, `packages/desktop/src/children.ts`, `packages/desktop/src/runtime.test.ts`
- Modify: `packages/desktop/src/main.ts`

**Interfaces:**
- Produces: `resolveRuntimeEnv(opts): { env: Record<string,string>; port: number }`, `waitForPort(port, host, timeoutMs): Promise<void>`, `forkWebServer(env): ChildProcess`, `forkWorker(env): ChildProcess`.

- [ ] **Step 1: Unit test the pure helpers (red).** `packages/desktop/src/runtime.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveRuntimeEnv } from './runtime';

describe('resolveRuntimeEnv', () => {
  it('puts DB + profile under the data dir and sets the port', () => {
    const { env, port } = resolveRuntimeEnv({ userData: '/data', browsersPath: '/b', port: 4123 });
    expect(env.ED_DB_PATH).toBe('/data/app.db');
    expect(env.ED_WA_PROFILE_DIR).toBe('/data/wa-profile');
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('/b');
    expect(env.PORT).toBe('4123');
    expect(env.HOSTNAME).toBe('127.0.0.1');
    expect(port).toBe(4123);
  });
});
```
Run `npm -w @event-drafter/desktop run test` → FAIL (no module).

- [ ] **Step 2: Implement `runtime.ts`.**
```ts
import { join } from 'node:path';
import { createServer } from 'node:net';

export function resolveRuntimeEnv(opts: { userData: string; browsersPath: string; port: number }) {
  const env: Record<string, string> = {
    ED_DB_PATH: join(opts.userData, 'app.db'),
    ED_WA_PROFILE_DIR: join(opts.userData, 'wa-profile'),
    PLAYWRIGHT_BROWSERS_PATH: opts.browsersPath,
    ED_WORKER_LOCK_PORT: '47615',
    PORT: String(opts.port),
    HOSTNAME: '127.0.0.1',
  };
  return { env, port: opts.port };
}

export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Repo root for both dev (monorepo) and packaged (resourcesPath/app) layouts.
 *  In a packaged build, main.ts sets ED_APP_ROOT = join(process.resourcesPath,'app')
 *  before anything imports this. Defined here so children.ts AND main.ts share ONE
 *  definition (do not redefine it elsewhere). `fromDir` is the built desktop dist dir. */
export function repoRoot(fromDir: string): string {
  return process.env.ED_APP_ROOT ?? join(fromDir, '..', '..', '..');
}

export function waitForPort(port: number, host = '127.0.0.1', timeoutMs = 30_000): Promise<void> {
  const { Socket } = require('node:net') as typeof import('node:net');
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = new Socket();
      s.setTimeout(1000);
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => { s.destroy(); retry(); });
      s.once('timeout', () => { s.destroy(); retry(); });
      s.connect(port, host);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) reject(new Error(`port ${port} not up in ${timeoutMs}ms`));
      else setTimeout(tryOnce, 300);
    };
    tryOnce();
  });
}
```
Run the test → PASS.

- [ ] **Step 3: Implement `children.ts`.** Fork the Next server and the worker using Electron-as-Node. The Next server is started via Next's CLI; the worker via its built entry.
```ts
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { repoRoot } from './runtime';

// cwd is explicit per child: `next start` MUST run from packages/web; the worker
// runs from repo root (it reads ED_DB_PATH as an absolute path).
function baseFork(modulePath: string, args: string[], env: Record<string, string>, cwd: string): ChildProcess {
  return fork(modulePath, args, {
    cwd,
    env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1' },
    execPath: process.execPath,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
}

export function forkWebServer(env: Record<string, string>): ChildProcess {
  const root = repoRoot(__dirname);
  const nextBin = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  return baseFork(nextBin, ['start', '-p', env.PORT, '-H', env.HOSTNAME], env, join(root, 'packages', 'web'));
}

export function forkWorker(env: Record<string, string>): ChildProcess {
  const root = repoRoot(__dirname);
  return baseFork(join(root, 'packages', 'worker', 'dist', 'index.js'), [], env, root);
}
```

- [ ] **Step 4: Wire `main.ts` to boot everything.**
```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { resolveRuntimeEnv, pickFreePort, waitForPort, repoRoot } from './runtime';
import { forkWebServer, forkWorker } from './children';
import type { ChildProcess } from 'node:child_process';

let web: ChildProcess | null = null;
let worker: ChildProcess | null = null;

async function boot() {
  // Packaged layout: point root + browser at the shipped resources BEFORE forking.
  if (app.isPackaged) {
    process.env.ED_APP_ROOT = join(process.resourcesPath, 'app');
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.resourcesPath, 'ms-playwright');
  }
  const root = repoRoot(__dirname);
  const userData = app.getPath('userData');
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(userData, 'ms-playwright');
  const port = await pickFreePort();
  const { env } = resolveRuntimeEnv({ userData, browsersPath, port });

  // Migrations: require core's compiled migrate and run against ED_DB_PATH.
  process.env.ED_DB_PATH = env.ED_DB_PATH;
  const { runMigrations } = require(join(root, 'packages', 'core', 'dist', 'migrate.js'));
  runMigrations();

  web = forkWebServer(env);
  worker = forkWorker(env);
  await waitForPort(port);

  const win = new BrowserWindow({ width: 1280, height: 860, title: 'Event Drafter' });
  win.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(boot);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { web?.kill(); worker?.kill(); });
```

- [ ] **Step 5: Verify (dev, unpackaged).** Run `npm run build` (root, so web `.next` + worker/core dist exist), then `npm -w @event-drafter/desktop run build && npm -w @event-drafter/desktop run start` (no external web server running this time).
Expected: window opens against the app's own forked server; `<userData>/app.db` is created (check `~/Library/Application Support/Event Drafter/app.db` on macOS); the worker process is alive (status pill goes green/idle after a few seconds). If you trigger a WhatsApp action, a separate Chromium window opens.

- [ ] **Step 6: Commit.**
```bash
git add packages/desktop
git commit -m "feat(desktop): boot forked web server + worker with userData paths"
```

---

### Task 3: Native deps under the packaged runtime (better-sqlite3 + Playwright Chromium)

**Goal:** Ensure `better-sqlite3` loads under Electron's Node ABI, and the worker's Playwright finds a bundled Chromium.

**Files:**
- Modify: `packages/desktop/package.json` (rebuild + browser-fetch build scripts)
- Create: `packages/desktop/scripts/fetch-browser.mjs` (installs the pinned Playwright Chromium into `packages/desktop/resources/ms-playwright`)

- [ ] **Step 1: Rebuild better-sqlite3 for Electron.** Add a script that runs `@electron/rebuild` against `better-sqlite3` for the installed Electron version:
```json
"rebuild-native": "electron-rebuild -f -w better-sqlite3"
```
Run it. Then re-run the Task 2 verification (`npm -w @event-drafter/desktop run start`) and confirm the DB still opens — better-sqlite3 now matches Electron, so the forked children (Electron-as-Node) load it. If you see `NODE_MODULE_VERSION` mismatch errors in the inherited stdout, the rebuild did not take — re-run targeting the right Electron version.

- [ ] **Step 2: Fetch the bundled Chromium.** `packages/desktop/scripts/fetch-browser.mjs`:
```js
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'resources', 'ms-playwright');
// Install ONLY chromium, into our resources dir, using the worker's pinned playwright.
execSync('npx --yes playwright install chromium', {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: dest },
});
console.log('chromium installed to', dest);
```
Add script: `"fetch-browser": "node scripts/fetch-browser.mjs"`. Run it. Confirm `packages/desktop/resources/ms-playwright/chromium-*/` exists. Add `packages/desktop/resources/` to `.gitignore`.

- [ ] **Step 3: Point the worker at the bundled browser in dev.** Re-run with `PLAYWRIGHT_BROWSERS_PATH` set to the resources dir (the main process already passes `browsersPath`; for this dev check, export it or set the default in `boot()` to the resources path when packaged). Trigger the WhatsApp login (Setup → WhatsApp) and confirm Chromium launches from the bundled location, not a global cache.

- [ ] **Step 4: Commit.**
```bash
git add packages/desktop/package.json packages/desktop/scripts .gitignore
git commit -m "build(desktop): rebuild better-sqlite3 for electron + bundle playwright chromium"
```

---

### Task 4: Run with no `.env` — settings-backed API keys + localhost OAuth

**Goal:** A packaged app has no `.env`. Every secret/config the web or worker reads from `process.env` must have a settings-backed fallback so the in-app Setup flow alone is sufficient.

**Files:**
- Audit + modify: wherever `process.env.ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `LLM_PROVIDER` are read (likely `packages/worker/src/llm/client.ts` and `packages/worker/src/google/oauth.ts`). Add a `settings`-table fallback.
- Possibly add Setup UI fields if a key currently has no Setup entry.

- [ ] **Step 1: Find every env read.** Run `grep -rn "process.env.ANTHROPIC_API_KEY\|process.env.GOOGLE_\|process.env.LLM_PROVIDER" packages` and list each site. For each, confirm whether a `settings` value already backs it (Google tokens + client id are already in `settings`/Setup; the Anthropic key may be env-only today).

- [ ] **Step 2: Add fallbacks.** For each env-only secret, read `getSetting(...)` first and fall back to `process.env`. Example for the Anthropic key (adjust to the real file):
```ts
const apiKey = getSetting('anthropic_api_key') ?? process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('No Anthropic API key — set it in Setup');
```
Register any new setting key in `packages/core/src/schema/settings.ts` + `SettingTypes`, and add a Setup field to capture it (mirror the existing LLM/Google setup pages). Rebuild core.

- [ ] **Step 3: Localhost OAuth redirect.** Ensure the Google OAuth redirect URI is computed from the app's actual localhost port (the desktop port is dynamic) or a fixed registered port. Decision: pin the desktop web server to a FIXED port (e.g. 41000) instead of `pickFreePort()` so the Google console redirect (`http://127.0.0.1:41000/api/auth/google/callback`) is stable; fall back to a free port only if 41000 is taken (and document that re-auth then needs the printed URL). Update `resolveRuntimeEnv`/`boot()` accordingly and register that redirect in the Google console.

- [ ] **Step 4: Verify.** With NO `.env` present, launch the desktop app, run Setup (enter Anthropic key, connect Google, log into WhatsApp), and confirm a draft generates (LLM works) and a sheet import works (Google works).

- [ ] **Step 5: Commit.**
```bash
git add packages
git commit -m "feat: settings-backed config fallback so the packaged app needs no .env"
```

---

### Task 5: electron-builder → unsigned installers (Windows + macOS)

**Goal:** Produce installable `.exe`/`.msi` (Windows) and `.dmg`/`.pkg` (macOS), UNSIGNED, that install and launch on a clean machine.

**Files:**
- Create: `packages/desktop/electron-builder.yml`
- Modify: `packages/desktop/package.json` (`dist` script), root `package.json` (`desktop:dist`)

- [ ] **Step 1: Builder config.** `packages/desktop/electron-builder.yml`:
```yaml
appId: com.eventdrafter.app
productName: Event Drafter
asar: false
directories:
  output: release
  buildResources: build
# Ship the built monorepo pieces the forked children need, plus the browser.
extraResources:
  - from: ../../packages/web/.next
    to: app/packages/web/.next
  - from: ../../packages/web/public
    to: app/packages/web/public
  - from: ../../packages/web/next.config.ts
    to: app/packages/web/next.config.ts
  - from: ../../packages/worker/dist
    to: app/packages/worker/dist
  - from: ../../packages/core/dist
    to: app/packages/core/dist
  - from: ../../node_modules
    to: app/node_modules
  - from: resources/ms-playwright
    to: ms-playwright
win:
  target: [nsis, msi]
mac:
  target: [dmg, pkg]
  category: public.app-category.productivity
nsis:
  oneClick: false
  perMachine: false
```
> The `extraResources` ship the whole built app + `node_modules` under `resources/app` (reliability over size; revisit with Next `output: standalone` + asar later). In `main.ts`, when packaged, set `process.env.ED_APP_ROOT = join(process.resourcesPath, 'app')` and `PLAYWRIGHT_BROWSERS_PATH = join(process.resourcesPath, 'ms-playwright')` BEFORE forking, so `repoRoot()`/browser resolve to the shipped copies. Add an `app.isPackaged` branch in `boot()` for this.

- [ ] **Step 2: Dist scripts.**
`packages/desktop/package.json`: `"dist": "npm run build && electron-builder --publish never"`.
Root `package.json`: `"desktop:dist": "npm run build && npm -w @event-drafter/desktop run fetch-browser && npm -w @event-drafter/desktop run rebuild-native && npm -w @event-drafter/desktop run dist"`.

- [ ] **Step 3: Build macOS locally + verify.** On macOS, run `npm run desktop:dist`. Open the produced `.dmg` from `packages/desktop/release`, install, launch.
Expected: app opens, loads the UI from the packaged server, `app.db` appears under `~/Library/Application Support/Event Drafter/`, worker pill goes green. (Gatekeeper will warn because unsigned — right-click → Open to bypass for this check; Task 6 fixes it.)

- [ ] **Step 4: Build Windows + verify (needs a Windows machine).** On Windows (Caleb's worker laptop), run the same `desktop:dist`. Install the `.exe`, launch, confirm the same: UI loads, DB under `%APPDATA%\Event Drafter\`, WhatsApp window opens on login. SmartScreen will warn (unsigned) — "More info → Run anyway" for this check.

- [ ] **Step 5: Commit.**
```bash
git add packages/desktop package.json package-lock.json
git commit -m "build(desktop): electron-builder windows + macos installers (unsigned)"
```

---

### Task 6: Code signing + notarization (gated on certificates)

**Goal:** Signed, notarized builds that install without Gatekeeper/SmartScreen warnings. BLOCKED until certs exist — see the spec's lead-time note.

**Files:**
- Modify: `packages/desktop/electron-builder.yml` (signing config), CI/secret wiring.

- [ ] **Step 1: macOS.** Add to `electron-builder.yml`: `mac.hardenedRuntime: true`, an `entitlements` plist, and notarization via `afterSign` (electron-notarize) or builder's notarize option with an Apple API key. Requires: Apple Developer ID Application cert in the keychain + an App Store Connect API key (`APPLE_API_KEY`/`APPLE_API_ISSUER`). Verify: `spctl -a -vv <app>` reports "accepted, source=Notarized Developer ID".
- [ ] **Step 2: Windows.** Configure `win.certificateFile`/`certificatePassword` (or an EV token/azure-trusted-signing). Requires an OV/EV Authenticode cert. Verify: the installed exe's signature is valid (`signtool verify /pa`) and SmartScreen no longer warns (EV) or warns less (OV, improves with reputation).
- [ ] **Step 3: Commit** once a signed build is produced on each OS.

---

## Final verification
- [ ] Unsigned macOS `.dmg` and Windows `.exe` both install and run on a clean machine: UI loads from the in-app server, DB under userData, worker reaches green, WhatsApp login window opens, a draft generates with a Setup-entered Anthropic key (no `.env`).
- [ ] `git push origin main`.

## Risks / notes for the executor
- **Next 16 + forked `next start`:** the simplest reliable path is shipping `.next` + `node_modules` and forking `next start` (this plan). If bundle size becomes a problem, switch web to `output: 'standalone'` with `serverExternalPackages: ['better-sqlite3','playwright']` and ship `.next/standalone` instead — but that needs careful file-tracing of the two native deps and is a separate hardening task, not required to ship.
- **One ABI:** forking with `ELECTRON_RUN_AS_NODE` + `process.execPath` is what lets a single `@electron/rebuild` of better-sqlite3 cover both child processes. If you instead ship a separate Node binary, you must rebuild for THAT Node version, not Electron's.
- **Two windows** (app + WhatsApp automation) is expected; document it for the operator.
- **Playwright version drift:** if `playwright` is ever bumped in the worker, re-run `fetch-browser` so the bundled Chromium matches, or the worker will try to download at runtime (and fail offline).
- Tasks 4-6 need real machines/accounts (Windows box, Apple Developer, Windows cert). Tasks 1-3 are fully doable on macOS in this repo.
