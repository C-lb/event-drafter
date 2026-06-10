import type { Job } from '@vip/core';
import { JOB_KINDS, type JobKind } from '@vip/core/types';
import { noopHandler } from './noop.js';
import { importContactsHandler } from './import-contacts.js';

export type JobHandler = (job: Job) => Promise<void>;

export const handlers: Record<JobKind, JobHandler> = {
  ...(Object.fromEntries(JOB_KINDS.map((k) => [k, noopHandler])) as Record<JobKind, JobHandler>),
  import_contacts: importContactsHandler,
};
