import { getLoginState, shutdownWa } from './driver.js';
import { logger } from '../logger.js';

async function main() {
  logger.info('wa-smoke: starting');
  const state = await getLoginState();
  logger.info('wa-smoke: login state', { state });

  if (state === 'logged-in') {
    logger.info('wa-smoke: ✓ logged in, selectors found chatListPane');
    process.exitCode = 0;
  } else if (state === 'needs-qr') {
    logger.warn('wa-smoke: ⚠ needs QR scan — visit /setup/wa');
    process.exitCode = 2;
  } else {
    logger.error('wa-smoke: ✗ unknown state — selectors may have changed');
    process.exitCode = 1;
  }

  await shutdownWa();
}

main().catch((err) => {
  logger.error('wa-smoke: failed', { err: err instanceof Error ? err.stack : String(err) });
  process.exitCode = 1;
});
