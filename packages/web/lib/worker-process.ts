// Server-only worker supervisor. Lets the Next server spawn / stop the background
// worker directly, so nobody needs a terminal. Never import this from a client
// component (it uses node:child_process).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getSetting } from '@event-drafter/core/settings';

// Matches worker-state STALE_MS: a heartbeat younger than this = worker alive.
const STALE_MS = 15_000;

/** Monorepo root. Next runs the web from packages/web, so root is two up — but
 *  fall back gracefully if launched from the root itself or an odd cwd. */
function repoRoot(): string {
  if (process.env.ED_REPO_ROOT) return process.env.ED_REPO_ROOT;
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'packages', 'worker', 'src', 'index.ts'))) return cwd;
  return resolve(cwd, '..', '..');
}

export function isWorkerAlive(): boolean {
  try {
    const hb = getSetting('worker_heartbeat');
    return !!hb?.ts && Date.now() - hb.ts < STALE_MS;
  } catch {
    return false;
  }
}

function workerPid(): number | null {
  try {
    return getSetting('worker_heartbeat')?.pid ?? null;
  } catch {
    return null;
  }
}

export interface SpawnResult {
  ok: boolean;
  started: boolean;
  message?: string;
}

/**
 * Spawn the worker as a detached, non-watch process that outlives this request
 * (and even a web-server restart). Non-watch on purpose: the tsx *watch* runner
 * orphans and force-kills itself, which is exactly the terminal pain we are
 * removing. The worker's TCP singleton lock makes a redundant spawn harmless —
 * the second process just exits.
 */
export function spawnWorker(): SpawnResult {
  if (isWorkerAlive()) return { ok: true, started: false, message: 'already running' };

  const root = repoRoot();
  const workerDir = join(root, 'packages', 'worker');
  const tsxBin = join(root, 'node_modules', '.bin', 'tsx');
  const distEntry = join(workerDir, 'dist', 'index.js');

  let cmd: string;
  let args: string[];
  if (existsSync(tsxBin)) {
    cmd = tsxBin;
    args = ['--env-file=.env', 'src/index.ts'];
  } else if (existsSync(distEntry)) {
    cmd = process.execPath; // node
    args = ['--env-file=.env', 'dist/index.js'];
  } else {
    return { ok: false, started: false, message: 'worker entry not found (no tsx and no dist build)' };
  }

  try {
    const dataDir = join(root, 'data');
    try {
      mkdirSync(dataDir, { recursive: true });
    } catch {
      /* ignore */
    }
    // Append worker stdout/stderr to a log so it is inspectable without a terminal.
    const logFd = openSync(join(dataDir, 'worker.log'), 'a');
    const child = spawn(cmd, args, {
      cwd: workerDir,
      // Inherit ED_DB_PATH / ED_WA_PROFILE_DIR from the web launch so both point
      // at the same DB and WhatsApp profile. .env (symlinked to root) fills in keys.
      env: { ...process.env },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.on('error', () => {
      /* async spawn errors surface via a missing heartbeat; nothing to do here */
    });
    child.unref();
    return { ok: true, started: true };
  } catch (e) {
    return { ok: false, started: false, message: e instanceof Error ? e.message : 'spawn failed' };
  }
}

/** Boot-time auto-start: spawn the worker unless it is already up, the operator
 *  disabled auto-start, or something else manages it (the desktop app). */
export function ensureWorkerRunning(): void {
  if (process.env.ED_EXTERNAL_WORKER === '1') return; // desktop forks its own worker
  try {
    if (getSetting('worker_autostart') === false) return; // explicitly stopped
  } catch {
    return; // no DB yet (e.g. build-time) — skip
  }
  if (isWorkerAlive()) return;
  spawnWorker();
}

export function killWorker(): { ok: boolean; stopped: boolean; message?: string } {
  const pid = workerPid();
  if (!pid || !isWorkerAlive()) return { ok: true, stopped: false, message: 'not running' };
  try {
    process.kill(pid, 'SIGTERM');
    return { ok: true, stopped: true };
  } catch (e) {
    return { ok: false, stopped: false, message: e instanceof Error ? e.message : 'kill failed' };
  }
}
