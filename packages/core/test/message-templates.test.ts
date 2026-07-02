import { describe, it, expect } from 'vitest';
import {
  renderMessageTemplate,
  deriveTemplateName,
  TOGGLE_PHRASES,
  type MergeContext,
} from '../src/message-templates.js';

const base: MergeContext = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  event_name: 'AI Summit',
  event_date: new Date('2026-08-01T00:00:00Z'),
  venue: 'Marina Bay',
  food_pref: null,
  chauffeured: false,
  parking_coupon: false,
  takes_bus: false,
};

describe('renderMessageTemplate', () => {
  it('substitutes plain tokens', () => {
    const out = renderMessageTemplate('Hi {first_name}, see you at {event_name} ({venue}).', base);
    expect(out).toBe('Hi Ada, see you at AI Summit (Marina Bay).');
  });

  it('expands a toggle token to its phrase when on, empty when off', () => {
    const on = renderMessageTemplate('Note: {parking}', { ...base, parking_coupon: true });
    expect(on).toBe(`Note: ${TOGGLE_PHRASES.parking}`);
    const off = renderMessageTemplate('Note:{parking}', base).trim();
    expect(off).toBe('Note:');
  });

  it('fills food_pref when present and blank when absent', () => {
    expect(renderMessageTemplate('Food: {food_pref}', { ...base, food_pref: 'halal' }))
      .toBe('Food: halal');
    expect(renderMessageTemplate('Food:{food_pref}', base).trim()).toBe('Food:');
  });

  it('leaves unknown tokens verbatim so typos are visible', () => {
    expect(renderMessageTemplate('Hi {frist_name}', base)).toBe('Hi {frist_name}');
  });

  it('collapses blank lines and double spaces left by empty tokens', () => {
    const body = 'Hi {first_name}.\n{parking}\n{bus}\nThanks.';
    // both toggles off -> the two middle lines vanish, no triple newline remains
    expect(renderMessageTemplate(body, base)).toBe('Hi Ada.\nThanks.');
  });

  it('strips em dashes (house rule)', () => {
    expect(renderMessageTemplate('Hi {first_name} — welcome', base)).toBe('Hi Ada, welcome');
  });
});

describe('deriveTemplateName', () => {
  it('uses the first non-empty line', () => {
    expect(deriveTemplateName('\n  Reminder blast \nmore')).toBe('Reminder blast');
  });
  it('truncates long first lines', () => {
    const long = 'x'.repeat(80);
    expect(deriveTemplateName(long)).toHaveLength(60);
  });
  it('falls back when empty', () => {
    expect(deriveTemplateName('   ')).toBe('Untitled template');
  });
});
