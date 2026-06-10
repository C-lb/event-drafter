import type { Job } from '@vip/core';
import { JOB_KINDS, type JobKind } from '@vip/core/types';
import { noopHandler } from './noop.js';
import { importContactsHandler } from './import-contacts.js';
import { draftInviteHandler } from './draft-invite.js';
import { sendMessageHandler } from './send-message.js';
import { checkRepliesHandler } from './check-replies.js';
import { classifyReplyHandler } from './classify-reply.js';
import { sendResponseHandler } from './send-response.js';

export type JobHandler = (job: Job) => Promise<void>;

export const handlers: Record<JobKind, JobHandler> = {
  ...(Object.fromEntries(JOB_KINDS.map((k) => [k, noopHandler])) as Record<JobKind, JobHandler>),
  import_contacts: importContactsHandler,
  draft_invite: draftInviteHandler,
  send_message: sendMessageHandler,
  check_replies: checkRepliesHandler,
  classify_reply: classifyReplyHandler,
  draft_response: classifyReplyHandler,
  send_response: sendResponseHandler,
};
