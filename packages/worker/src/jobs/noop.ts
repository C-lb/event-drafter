import type { Job } from '@event-drafter/core';
import { logger } from '../logger.js';

export async function noopHandler(job: Job): Promise<void> {
  logger.info('noop handler', { jobId: job.id, kind: job.kind });
}
