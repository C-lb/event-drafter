/**
 * Pure decision logic for post-send verification. The driver polls the WA DOM
 * after clicking send and feeds observations through `evaluateSendState` until
 * it sees `confirmed` (or gives up and refuses to mark the invite sent).
 *
 * Why: clicking WA's send button is not proof of delivery. The message can sit
 * in the compose box (swallowed click) or hang in "pending" (clock icon) and
 * die with the browser. We only call a send done once the draft shows up as
 * the newest outbound bubble without the pending clock.
 */

export type SendObservation = {
  /** Current innerText of the compose box. */
  composeText: string;
  /** Text of the newest outbound bubble in the open chat, if any. */
  lastOutboundText: string | null;
  /** Whether that bubble still shows WA's pending clock (msg-time icon). */
  lastOutboundPending: boolean;
};

export type SendState = 'confirmed' | 'pending' | 'not-sent';

const PREFIX_LEN = 20;

/** Whitespace-insensitive prefix of the draft, mirroring prefillDraft's check. */
function needleOf(draft: string): string {
  return draft.replace(/\s+/g, '').slice(0, PREFIX_LEN);
}

function containsDraft(haystack: string, draft: string): boolean {
  const needle = needleOf(draft);
  return needle.length > 0 && haystack.replace(/\s+/g, '').includes(needle);
}

export function evaluateSendState(obs: SendObservation, draft: string): SendState {
  if (containsDraft(obs.composeText, draft)) return 'not-sent';
  if (obs.lastOutboundText !== null && containsDraft(obs.lastOutboundText, draft)) {
    return obs.lastOutboundPending ? 'pending' : 'confirmed';
  }
  // Compose box cleared but the bubble has not appeared (or the newest
  // outbound is an older message): still in flight as far as we can tell.
  return 'pending';
}
