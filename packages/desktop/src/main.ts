import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { resolveRuntimeEnv, pickPreferredPort, DESKTOP_PREFERRED_PORT, waitForPort, repoRoot } from './runtime';
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
  // Prefer port 41000 so the Google redirect URI is stable and registerable in the Console.
  // Falls back to a free port if 41000 is busy (e.g. another instance running).
  const port = await pickPreferredPort(DESKTOP_PREFERRED_PORT);
  if (port !== DESKTOP_PREFERRED_PORT) {
    console.warn(`[desktop] Port ${DESKTOP_PREFERRED_PORT} was busy — using ${port}. Google OAuth redirect URI will be http://127.0.0.1:${port}/api/auth/google/callback`);
  }
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
