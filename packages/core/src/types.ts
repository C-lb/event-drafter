export const JOB_KINDS = [
  'send_message',
  'check_replies',
  'classify_reply',
  'draft_response',
  'redraft_reply',
  'generate_follow_up',
  'import_contacts',
  'draft_invite',
  'send_response',
  'generate_follow_ups',
  'send_follow_up',
  'cleanup_jobs',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const INVITE_STATUSES = [
  'pending',
  'drafted',
  'approved',
  'prefilled',
  'sent',
  'skipped',
  'failed',
] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const RSVP_VALUES = ['yes', 'no', 'maybe', 'none'] as const;
export type Rsvp = (typeof RSVP_VALUES)[number];

export const REPLY_CLASSIFICATIONS = ['yes', 'no', 'maybe', 'unclear'] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number];

// Who decided a reply's classification: the LLM, or the operator overriding it
// by hand from the /replies feed. A manual override pins confidence to 1 and
// triggers a fresh draft keyed off the chosen judgement.
export const CLASSIFICATION_SOURCES = ['llm', 'manual', 'reaction'] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

export const EVENT_STATUSES = ['draft', 'drafting', 'sending', 'closed'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const FOLLOW_UP_STATUSES = [
  'pending',
  'drafted',
  'approved',
  'prefilled',
  'sent',
  'skipped',
  'failed',
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const RESPONSE_STATUSES = [
  'pending',
  'drafted',
  'approved',
  'prefilled',
  'sent',
  'skipped',
  'failed',
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];
