import { describe, it, expect } from 'vitest';
import { parsePrePlainText } from '../src/wa/reader.js';

describe('parsePrePlainText', () => {
  it('parses 12-hour en-US format', () => {
    const r = parsePrePlainText('[2:14 PM, 6/10/2026] Ada Lovelace: ');
    expect(r.author).toBe('Ada Lovelace');
    expect(r.ts?.getFullYear()).toBe(2026);
  });

  it('parses 24-hour en-GB format', () => {
    const r = parsePrePlainText('[14:14, 10/06/2026] Ada: ');
    expect(r.author).toBe('Ada');
  });

  it('returns null ts on garbage', () => {
    expect(parsePrePlainText('not a meta').ts).toBeNull();
  });

  it('returns null ts on unparseable date', () => {
    const r = parsePrePlainText('[xx:xx, yy/mm/zz] X: ');
    expect(r.ts).toBeNull();
    expect(r.author).toBe('X');
  });
});
