import type { Job } from '@event-drafter/core';
import { JOB_KINDS, type JobKind } from '@event-drafter/core/types';
import { noopHandler } from './noop.js';
import { importContactsHandler } from './import-contacts.js';
import { draftInviteHandler } from './draft-invite.js';
import { sendMessageHandler } from './send-message.js';
import { checkRepliesHandler } from './check-replies.js';
import { classifyReplyHandler } from './classify-reply.js';
import { redraftReplyHandler } from './redraft-reply.js';
import { sendResponseHandler } from './send-response.js';
import { generateFollowUpsHandler } from './generate-follow-ups.js';
import { generateTargetedFollowUpsHandler } from './generate-targeted-follow-ups.js';
import { sendFollowUpHandler } from './send-follow-up.js';
import { cleanupJobsHandler } from './cleanup-jobs.js';
import { updateDelegateTrackerHandler } from './update-delegate-tracker.js';

export type JobHandler = (job: Job) => Promise<void>;

export const handlers: Record<JobKind, JobHandler> = {
  ...(Object.fromEntries(JOB_KINDS.map((k) => [k, noopHandler])) as Record<JobKind, JobHandler>),
  import_contacts: importContactsHandler,
  draft_invite: draftInviteHandler,
  send_message: sendMessageHandler,
  check_replies: checkRepliesHandler,
  classify_reply: classifyReplyHandler,
  draft_response: classifyReplyHandler,
  redraft_reply: redraftReplyHandler,
  send_response: sendResponseHandler,
  generate_follow_ups: generateFollowUpsHandler,
  generate_targeted_follow_ups: generateTargetedFollowUpsHandler,
  generate_follow_up: generateFollowUpsHandler,
  send_follow_up: sendFollowUpHandler,
  cleanup_jobs: cleanupJobsHandler,
  update_delegate_tracker: updateDelegateTrackerHandler,
};
