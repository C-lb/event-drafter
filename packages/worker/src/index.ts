import { runMigrations } from '@vip/core/migrate';
import { runForever } from './poller.js';
import { logger } from './logger.js';

async function main() {
  runMigrations();
  logger.info('worker startup', { node: process.version });
  await runForever();
}

main().catch((err) => {
  logger.error('worker fatal', { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
