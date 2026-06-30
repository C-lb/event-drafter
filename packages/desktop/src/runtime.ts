import { join } from 'node:path';
import { createServer } from 'node:net';

/** Fixed port for the packaged desktop web server.
 *  Register `http://127.0.0.1:41000/api/auth/google/callback` in your Google Console.
 *  If 41000 is occupied (e.g. another instance), boot falls back to a free port and
 *  prints the actual URL — re-auth will need to be performed at that URL. */
export const DESKTOP_PREFERRED_PORT = 41000;

export function resolveRuntimeEnv(opts: { userData: string; browsersPath: string; port: number }) {
  const redirectUri = `http://127.0.0.1:${opts.port}/api/auth/google/callback`;
  const env: Record<string, string> = {
    ED_DB_PATH: join(opts.userData, 'app.db'),
    ED_WA_PROFILE_DIR: join(opts.userData, 'wa-profile'),
    PLAYWRIGHT_BROWSERS_PATH: opts.browsersPath,
    ED_WORKER_LOCK_PORT: '47615',
    PORT: String(opts.port),
    HOSTNAME: '127.0.0.1',
    // Computed from the actual port so Google OAuth works without a .env.
    GOOGLE_REDIRECT_URI: redirectUri,
  };
  return { env, port: opts.port, redirectUri };
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

/** Try to bind `preferred`; fall back to a random free port if it is busy. */
export function pickPreferredPort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.once('error', () => {
      // Preferred port is in use — pick any free port instead.
      srv.close(() => pickFreePort().then(resolve));
    });
    srv.listen(preferred, '127.0.0.1', () => {
      srv.close(() => resolve(preferred));
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
