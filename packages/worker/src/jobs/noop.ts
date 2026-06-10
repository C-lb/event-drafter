import type { Job } from '@vip/core';
import { logger } from '../logger.js';

export async function noopHandler(job: Job): Promise<void> {
  logger.info('noop handler', { jobId: job.id, kind: job.kind });
}
