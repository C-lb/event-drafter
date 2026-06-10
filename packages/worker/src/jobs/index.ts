import type { Job } from '@vip/core';
import { JOB_KINDS, type JobKind } from '@vip/core/types';
import { noopHandler } from './noop.js';

export type JobHandler = (job: Job) => Promise<void>;

export const handlers: Record<JobKind, JobHandler> = Object.fromEntries(
  JOB_KINDS.map((kind) => [kind, noopHandler]),
) as Record<JobKind, JobHandler>;
