import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Package the Electron app with a correctly-ABI'd better-sqlite3.
//
// The packaged app ships the hoisted repo-root node_modules (see electron-builder.yml
// extraResources) and forks every child with execPath=electron + ELECTRON_RUN_AS_NODE,
// so the WHOLE app runs on Electron's Node (ABI 130 for Electron 33), not system Node.
// But dev/test (vitest, tsx worker) run on system Node (ABI 137 on Node 24). They share
// the same hoisted node_modules/better-sqlite3, which can only hold ONE compiled binary.
//
// So: rebuild better-sqlite3 for Electron -> package -> restore it for system Node.
// The restore runs in `finally` so a failed/interrupted build never leaves dev broken.

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, '..');
const repoRoot = join(desktopDir, '..', '..');

const electronPkg = join(repoRoot, 'node_modules', 'electron', 'package.json');
if (!existsSync(electronPkg)) {
  console.error('electron not found at repo root node_modules; run npm install first');
  process.exit(1);
}
const electronVersion = JSON.parse(readFileSync(electronPkg, 'utf8')).version;

const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });

try {
  console.log(`\n[package] rebuilding better-sqlite3 for Electron ${electronVersion}...`);
  run(
    `./node_modules/.bin/electron-rebuild -f -w better-sqlite3 --version ${electronVersion}`,
    repoRoot,
  );

  console.log('\n[package] running electron-builder...');
  run('electron-builder --publish never', desktopDir);
} finally {
  console.log('\n[package] restoring better-sqlite3 for system Node...');
  run('npm rebuild better-sqlite3', repoRoot);
}

console.log('\n[package] done. Installers in packages/desktop/release/');
