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
