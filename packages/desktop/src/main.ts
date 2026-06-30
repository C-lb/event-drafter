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
