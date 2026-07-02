import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'resources', 'ms-playwright');
// Install ONLY chromium via the worker's pinned playwright so the bundled rev
// matches exactly what the worker resolves at runtime. Using `npm -w ... exec`
// ensures we invoke the playwright binary resolved by the worker workspace (the
// hoisted node_modules/.bin/playwright that satisfies worker's ^1.49.0 lockfile
// entry), not whatever `npx --yes` might fetch from the registry.
execSync('npm -w @event-drafter/worker exec -- playwright install chromium', {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: dest },
});
console.log('chromium installed to', dest);
