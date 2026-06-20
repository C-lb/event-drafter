import { runMigrations } from '@event-drafter/core/migrate';
import { runForever } from './poller.js';
import { logger } from './logger.js';
import { acquireSingletonLock } from './lock.js';
import { runMissedRunCheck, startScheduler } from './scheduler.js';

async function main() {
  // Refuse to start if another worker holds the lock — only one poller may run
  // the send loop, so a message is never dispatched by two processes at once.
  await acquireSingletonLock();
  runMigrations();
  logger.info('worker startup', { node: process.version });
  startScheduler();
  runMissedRunCheck();
  await runForever();
}

main().catch((err) => {
  logger.error('worker fatal', { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
