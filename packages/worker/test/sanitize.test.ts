import { describe, it, expect } from 'vitest';
import { sanitizeDraft } from '../src/llm/sanitize.js';

describe('sanitizeDraft', () => {
  it('replaces spaced em-dash with a comma', () => {
    expect(sanitizeDraft('Hi Ada — looking forward to it.')).toBe(
      'Hi Ada, looking forward to it.',
    );
  });

  it('replaces spaced en-dash with a comma', () => {
    expect(sanitizeDraft('We meet at noon – downstairs.')).toBe(
      'We meet at noon, downstairs.',
    );
  });

  it('replaces flush em-dash (no spaces) with comma + space', () => {
    expect(sanitizeDraft('quick one—any chance you can make it?')).toBe(
      'quick one, any chance you can make it?',
    );
  });

  it('strips a leading em-dash on a line', () => {
    expect(sanitizeDraft('— Looking forward to seeing you.')).toBe(
      'Looking forward to seeing you.',
    );
  });

  it('strips a trailing em-dash on a line', () => {
    expect(sanitizeDraft('see you then —')).toBe('see you then');
  });

  it('handles multiple em-dashes in one message', () => {
    expect(
      sanitizeDraft('Good morning Ian — we have a lunch on Wednesday — would love to see you.'),
    ).toBe('Good morning Ian, we have a lunch on Wednesday, would love to see you.');
  });

  it('does not touch hyphens (compound words like "follow-up")', () => {
    expect(sanitizeDraft('Just a quick follow-up on lunch.')).toBe(
      'Just a quick follow-up on lunch.',
    );
  });

  it('preserves intentional line breaks (paragraphs)', () => {
    const input = 'Good morning Ada,\n\nWould love to have you join us.\n\nRegards,\nSara';
    expect(sanitizeDraft(input)).toBe(input);
  });

  it('collapses double spaces left by upstream mistakes', () => {
    expect(sanitizeDraft('lunch  on  Wednesday')).toBe('lunch on Wednesday');
  });

  it('collapses triple+ newlines down to a paragraph break', () => {
    expect(sanitizeDraft('para one\n\n\n\npara two')).toBe('para one\n\npara two');
  });

  it('is idempotent (running twice gives the same output)', () => {
    const input = 'Hi Ada — see you Wednesday — at noon.';
    expect(sanitizeDraft(sanitizeDraft(input))).toBe(sanitizeDraft(input));
  });

  it('returns empty for empty input', () => {
    expect(sanitizeDraft('')).toBe('');
  });
});
