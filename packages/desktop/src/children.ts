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
  return baseFork(nextBin, ['start', '-p', env['PORT']!, '-H', env['HOSTNAME']!], env, join(root, 'packages', 'web'));
}

export function forkWorker(env: Record<string, string>): ChildProcess {
  const root = repoRoot(__dirname);
  return baseFork(join(root, 'packages', 'worker', 'dist', 'index.js'), [], env, root);
}
