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
  'generate_targeted_follow_ups',
  'send_follow_up',
  'send_reaction',
  'auto_respond',
  'cleanup_jobs',
  'update_delegate_tracker',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

// The WhatsApp reactions the operator can send to a contact's confirming reply,
// as a lightweight acknowledgement instead of a text response.
export const REACTION_EMOJIS = ['\u{1F44D}', '❤️'] as const; // 👍  ❤️
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

// Lifecycle of a sent reaction: queued/in-flight, delivered, or it failed.
export const REACTION_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const;
export type ReactionStatus = (typeof REACTION_STATUSES)[number];

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// 'sending' is the per-record send claim: a worker atomically moves an
// approved row to 'sending' before it touches WhatsApp, and only the winner of
// that transition delivers the message. This is the single-send guarantee — a
// duplicate job or a racing second worker can never re-claim it. See the
// worker's send-claim helpers.
export const INVITE_STATUSES = [
  'pending',
  'drafted',
  'approved',
  'sending',
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
  'sending',
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
  'sending',
  'prefilled',
  'sent',
  'skipped',
  'failed',
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];
