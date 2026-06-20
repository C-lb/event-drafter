import { describe, it, expect } from 'vitest';
import { stepHighlight, advanceHighlight } from './queue-nav';

const none = () => false;

describe('stepHighlight', () => {
  it('moves to the next id going down', () => {
    expect(stepHighlight([1, 2, 3], 1, none, 1)).toBe(2);
  });
  it('moves to the previous id going up', () => {
    expect(stepHighlight([1, 2, 3], 2, none, -1)).toBe(1);
  });
  it('stays put at the bottom boundary', () => {
    expect(stepHighlight([1, 2, 3], 3, none, 1)).toBe(3);
  });
  it('stays put at the top boundary', () => {
    expect(stepHighlight([1, 2, 3], 1, none, -1)).toBe(1);
  });
  it('skips terminal cards', () => {
    const terminal = (id: number) => id === 2;
    expect(stepHighlight([1, 2, 3], 1, terminal, 1)).toBe(3);
  });
  it('from null going down picks the first non-terminal', () => {
    expect(stepHighlight([1, 2, 3], null, none, 1)).toBe(1);
  });
  it('returns null for an empty list', () => {
    expect(stepHighlight([], null, none, 1)).toBeNull();
  });
});

describe('advanceHighlight', () => {
  it('lands on the next non-terminal after current', () => {
    const terminal = (id: number) => id === 2;
    expect(advanceHighlight([1, 2, 3], 2, terminal)).toBe(3);
  });
  it('falls back to the nearest non-terminal before when none after', () => {
    const terminal = (id: number) => id === 3;
    expect(advanceHighlight([1, 2, 3], 3, terminal)).toBe(2);
  });
  it('returns null when every card is terminal', () => {
    expect(advanceHighlight([1, 2, 3], 2, () => true)).toBeNull();
  });
});
