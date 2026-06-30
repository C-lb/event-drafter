import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRuntimeEnv, pickPreferredPort, DESKTOP_PREFERRED_PORT, waitForPort, repoRoot } from './runtime';
import { forkWebServer, forkWorker } from './children';
import type { ChildProcess } from 'node:child_process';

let web: ChildProcess | null = null;
let worker: ChildProcess | null = null;
let quitting = false;

function attachChildGuard(child: ChildProcess, name: string) {
  child.on('error', (err) => {
    if (quitting) return;
    quitting = true;
    web?.kill(); worker?.kill();
    dialog.showErrorBox('Event Drafter child error', `${name}: ${err.message}`);
    app.quit();
  });
  child.on('exit', (code) => {
    if (quitting || code === 0 || code === null) return;
    quitting = true;
    web?.kill(); worker?.kill();
    dialog.showErrorBox('Event Drafter child crashed', `${name} exited with code ${code}`);
    app.quit();
  });
}

async function boot() {
  try {
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
      console.warn(`[desktop] Port ${DESKTOP_PREFERRED_PORT} was busy - using ${port}. Google OAuth redirect URI will be http://127.0.0.1:${port}/api/auth/google/callback`);
    }
    const { env } = resolveRuntimeEnv({ userData, browsersPath, port });

    // Migrations: load core's compiled migrate and run against ED_DB_PATH.
    // core is "type": "module" (ESM); this main process runs as CommonJS under
    // Electron's Node, which cannot require() ESM. Load it via a dynamic import.
    // The indirection through a Function hides import() from tsc, which would
    // otherwise down-level it back to require() under module: CommonJS.
    // pathToFileURL keeps the absolute path valid on Windows.
    process.env.ED_DB_PATH = env.ED_DB_PATH;
    const importEsm = new Function('p', 'return import(p)') as (p: string) => Promise<{ runMigrations: () => void }>;
    const migratePath = join(root, 'packages', 'core', 'dist', 'migrate.js');
    const { runMigrations } = await importEsm(pathToFileURL(migratePath).href);
    runMigrations();

    web = forkWebServer(env);
    worker = forkWorker(env);
    attachChildGuard(web, 'web');
    attachChildGuard(worker, 'worker');
    await waitForPort(port);

    const win = new BrowserWindow({ width: 1280, height: 860, title: 'Event Drafter' });
    win.loadURL(`http://127.0.0.1:${port}`);
  } catch (err) {
    web?.kill(); worker?.kill();
    dialog.showErrorBox('Event Drafter failed to start', String(err));
    app.quit();
  }
}

app.whenReady().then(boot);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { quitting = true; web?.kill(); worker?.kill(); });
