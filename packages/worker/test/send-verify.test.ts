import { describe, it, expect } from 'vitest';
import {
  evaluateSendState,
  statusTextIsPending,
  type SendObservation,
} from '../src/wa/send-verify.js';

const DRAFT = 'Hi David, you are warmly invited to our private tasting on 20 June.';

function obs(partial: Partial<SendObservation>): SendObservation {
  return {
    composeText: '',
    lastOutboundText: null,
    lastOutboundPending: false,
    ...partial,
  };
}

describe('evaluateSendState', () => {
  it('confirms when compose is empty and outbound bubble matches with no pending clock', () => {
    expect(evaluateSendState(obs({ lastOutboundText: DRAFT }), DRAFT)).toBe('confirmed');
  });

  it('reports not-sent while the draft still sits in the compose box', () => {
    expect(evaluateSendState(obs({ composeText: DRAFT }), DRAFT)).toBe('not-sent');
  });

  it('reports pending when the bubble matches but still shows the clock icon', () => {
    expect(
      evaluateSendState(obs({ lastOutboundText: DRAFT, lastOutboundPending: true }), DRAFT),
    ).toBe('pending');
  });

  it('reports pending when compose cleared but no matching bubble yet (DOM lag)', () => {
    expect(evaluateSendState(obs({}), DRAFT)).toBe('pending');
  });

  it('reports pending when the newest outbound bubble is some other message', () => {
    expect(
      evaluateSendState(obs({ lastOutboundText: 'an older unrelated message' }), DRAFT),
    ).toBe('pending');
  });

  it('matches on whitespace-insensitive prefix (WA re-wraps long messages)', () => {
    const rewrapped = DRAFT.replace(/ /g, '\n');
    expect(evaluateSendState(obs({ lastOutboundText: rewrapped }), DRAFT)).toBe('confirmed');
  });

  it('compose box matching is also whitespace-insensitive', () => {
    expect(
      evaluateSendState(obs({ composeText: DRAFT.replace(/ /g, ' ') }), DRAFT),
    ).toBe('not-sent');
  });

  it('a leftover partial word in compose does not count as not-sent', () => {
    expect(
      evaluateSendState(obs({ composeText: 'Hi', lastOutboundText: DRAFT }), DRAFT),
    ).toBe('confirmed');
  });

  it('handles drafts shorter than the prefix window', () => {
    expect(evaluateSendState(obs({ lastOutboundText: 'ok' }), 'ok')).toBe('confirmed');
  });
});

describe('statusTextIsPending', () => {
  it('treats the WA "Pending" status label as in-flight', () => {
    expect(statusTextIsPending('Pending')).toBe(true);
  });

  it('treats "Sending" as in-flight', () => {
    expect(statusTextIsPending(' Sending ')).toBe(true);
  });

  it('treats Sent / Delivered / Read as no longer pending', () => {
    expect(statusTextIsPending('Sent')).toBe(false);
    expect(statusTextIsPending('Delivered')).toBe(false);
    expect(statusTextIsPending('Read')).toBe(false);
  });

  it('treats a missing/unreadable status as not pending (so a rendered outbound bubble is not stuck forever)', () => {
    expect(statusTextIsPending(null)).toBe(false);
    expect(statusTextIsPending('')).toBe(false);
    expect(statusTextIsPending(undefined)).toBe(false);
  });
});
