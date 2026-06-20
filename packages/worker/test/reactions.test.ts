import { describe, it, expect } from 'vitest';
import {
  extractReactionEmoji,
  reactionToClassification,
  chooseReactionRsvp,
  reactionRsvpDecision,
} from '../src/wa/reactions.js';

describe('extractReactionEmoji', () => {
  it('pulls the emoji out of a WA reaction aria-label', () => {
    expect(extractReactionEmoji('reaction 👍. View reactions')).toBe('👍');
  });
  it('handles a presentation-selector emoji (❤️)', () => {
    expect(extractReactionEmoji('reaction ❤️. View reactions')).toBe('❤️');
  });
  it('returns null when there is no emoji', () => {
    expect(extractReactionEmoji('View reactions')).toBeNull();
    expect(extractReactionEmoji('')).toBeNull();
  });
});

describe('reactionToClassification', () => {
  it('maps positive emoji to yes', () => {
    for (const e of ['👍', '❤️', '🥰', '🎉', '🙏', '👏', '✅', '🔥']) {
      expect(reactionToClassification(e)).toBe('yes');
    }
  });
  it('maps negative emoji to no', () => {
    for (const e of ['👎', '😢', '😭', '❌', '🚫']) {
      expect(reactionToClassification(e)).toBe('no');
    }
  });
  it('matches regardless of the VS16 presentation selector', () => {
    expect(reactionToClassification('❤')).toBe('yes'); // no U+FE0F
    expect(reactionToClassification('❤️')).toBe('yes'); // with U+FE0F
  });
  it('returns null for emoji with no clear signal', () => {
    for (const e of ['🤔', '😂', '👀', '']) {
      expect(reactionToClassification(e)).toBeNull();
    }
  });
});

describe('chooseReactionRsvp', () => {
  it('returns the classification and emoji for a single positive reaction', () => {
    expect(chooseReactionRsvp(['reaction 👍. View reactions'])).toEqual({
      classification: 'yes',
      emoji: '👍',
    });
  });
  it('picks the most recent (last in DOM order) mappable reaction', () => {
    expect(
      chooseReactionRsvp(['reaction 👍. View reactions', 'reaction 👎. View reactions']),
    ).toEqual({ classification: 'no', emoji: '👎' });
  });
  it('ignores unmappable reactions', () => {
    expect(chooseReactionRsvp(['reaction 🤔. View reactions'])).toBeNull();
  });
  it('returns null for no reactions', () => {
    expect(chooseReactionRsvp([])).toBeNull();
  });
});

describe('reactionRsvpDecision', () => {
  it('skips when a text reply already owns the row', () => {
    expect(reactionRsvpDecision('llm')).toBe('skip');
    expect(reactionRsvpDecision('manual')).toBe('skip');
  });
  it('upserts when there is no reply or only a prior reaction', () => {
    expect(reactionRsvpDecision(null)).toBe('upsert');
    expect(reactionRsvpDecision('reaction')).toBe('upsert');
  });
});
