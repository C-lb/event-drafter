import { describe, it, expect } from 'vitest';
import {
  parsePrePlainText,
  collectThreadSinceLastOutbound,
  joinThreadText,
  classifyRow,
  type ChatRow,
  type RawRow,
} from '../src/wa/reader.js';

function row(text: string, isInbound: boolean, ts = '2026-06-10 10:00'): ChatRow {
  return {
    meta: `[${ts}] ${isInbound ? 'Ian' : 'You'}: `,
    text,
    isInbound,
    dataId: `${isInbound ? 'in' : 'out'}-${text}`,
  };
}

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

  it('prefers day-first when both day and month are ≤ 12 (Singapore default)', () => {
    const r = parsePrePlainText('[14:14, 10/06/2026] Ada: ');
    // Should be 10 June, not 6 October.
    expect(r.ts?.getMonth()).toBe(5); // June (0-indexed)
    expect(r.ts?.getDate()).toBe(10);
  });

  it('detects month-first when day > 12 in the second slot', () => {
    const r = parsePrePlainText('[2:14 PM, 6/13/2026] Ada: ');
    // 13 in second slot can only be a day, so first slot is month.
    expect(r.ts?.getMonth()).toBe(5);
    expect(r.ts?.getDate()).toBe(13);
  });
});

describe('collectThreadSinceLastOutbound', () => {
  it('returns inbound messages after the last outbound message, in chronological order', () => {
    const rows = [
      row('old chitchat', true, '2026-06-08 09:00'),
      row('Invite to SPARK Lunch on 3 June...', false, '2026-06-10 10:00'),
      row('thanks!', true, '2026-06-10 10:05'),
      row('see you then', true, '2026-06-10 10:06'),
      row('what time again?', true, '2026-06-10 11:00'),
    ];
    const out = collectThreadSinceLastOutbound(rows);
    expect(out.map((m) => m.text)).toEqual(['thanks!', 'see you then', 'what time again?']);
  });

  it('returns empty when the last message is outbound', () => {
    const rows = [
      row('thanks!', true),
      row('Welcome, see you at 6pm.', false),
    ];
    expect(collectThreadSinceLastOutbound(rows)).toEqual([]);
  });

  it('returns every inbound when there has never been an outbound', () => {
    const rows = [row('hi', true), row('still there?', true)];
    expect(collectThreadSinceLastOutbound(rows).map((m) => m.text)).toEqual(['hi', 'still there?']);
  });

  it('skips rows missing text or meta', () => {
    const rows: ChatRow[] = [
      row('Invite text', false),
      { text: '', isInbound: true, meta: '[x]', dataId: null },
      { text: 'good text', isInbound: true, meta: null, dataId: null },
      row('actual reply', true),
    ];
    expect(collectThreadSinceLastOutbound(rows).map((m) => m.text)).toEqual(['actual reply']);
  });
});

describe('classifyRow', () => {
  const contactName = 'Ada';
  const phoneE164 = '+6591234567';

  function raw(opts: Partial<RawRow>): RawRow {
    return {
      meta: opts.meta ?? '[14:14, 10/06/2026] Someone: ',
      text: opts.text ?? 'hi',
      dataIdRaw: opts.dataIdRaw ?? '',
      cssOutbound: opts.cssOutbound ?? false,
    };
  }

  it('data-id false_ prefix → inbound (saved contact)', () => {
    const r = classifyRow(
      raw({ meta: '[14:14, 10/06/2026] Ada Lovelace: ', dataIdRaw: 'false_6591234567@c.us_ABC123' }),
      contactName,
      phoneE164,
    );
    expect(r.isInbound).toBe(true);
  });

  it('data-id true_ prefix → outbound even if author matches contact', () => {
    const r = classifyRow(
      raw({ meta: '[14:14, 10/06/2026] Ada: ', dataIdRaw: 'true_6591234567@c.us_XYZ' }),
      contactName,
      phoneE164,
    );
    expect(r.isInbound).toBe(false);
  });

  // Bug #1: unsaved contact whose author tail is the phone number.
  it('unsaved contact, author tail is phone number, data-id false_ → inbound', () => {
    const r = classifyRow(
      raw({ meta: '[14:14, 10/06/2026] +65 9123 4567: ', dataIdRaw: 'false_6591234567@c.us_ABC' }),
      contactName,
      phoneE164,
    );
    expect(r.isInbound).toBe(true);
  });

  // Bug #1: unsaved contact with a profile name that doesn't include our DB
  // first_name. data-id wins.
  it('unsaved contact, profile name doesn\'t match DB first_name, data-id false_ → inbound', () => {
    const r = classifyRow(
      raw({ meta: '[14:14, 10/06/2026] AL the Designer: ', dataIdRaw: 'false_6591234567@c.us_ABC' }),
      contactName,
      phoneE164,
    );
    expect(r.isInbound).toBe(true);
  });

  // Bug #1: unsaved contact, no data-id available, author tail is phone tail.
  // Should still classify as inbound by phone-tail match.
  it('no data-id, author tail is phone number, matches by phone-tail digits → inbound', () => {
    const r = classifyRow(
      raw({ meta: '[14:14, 10/06/2026] +65 9123 4567: ', dataIdRaw: '' }),
      contactName,
      phoneE164,
    );
    expect(r.isInbound).toBe(true);
  });

  it('no data-id, author "You" → outbound', () => {
    const r = classifyRow(
      raw({ meta: '[14:14, 10/06/2026] You: ', dataIdRaw: '' }),
      contactName,
      phoneE164,
    );
    expect(r.isInbound).toBe(false);
  });

  it('no data-id, author matches contact name → inbound', () => {
    const r = classifyRow(
      raw({ meta: '[14:14, 10/06/2026] Ada Lovelace: ', dataIdRaw: '' }),
      contactName,
      phoneE164,
    );
    expect(r.isInbound).toBe(true);
  });

  it('ambiguous (no data-id, no author match, no You) defaults to inbound', () => {
    // This is the safe default: misclassifying noise as inbound at worst
    // includes a junk row that the per-invite date filter drops, whereas
    // misclassifying as outbound would stop the walk-back early.
    const r = classifyRow(
      raw({ meta: '[14:14, 10/06/2026] Some Stranger: ', dataIdRaw: '' }),
      contactName,
      phoneE164,
    );
    expect(r.isInbound).toBe(true);
  });
});

describe('joinThreadText', () => {
  it('joins messages chronologically with a clear separator', () => {
    const out = joinThreadText([
      { text: 'thanks!' },
      { text: 'see you then' },
      { text: 'what time again?' },
    ]);
    expect(out).toContain('thanks!');
    expect(out).toContain('see you then');
    expect(out).toContain('what time again?');
    expect(out.split('— next message —')).toHaveLength(3);
  });

  it('returns empty string for empty input', () => {
    expect(joinThreadText([])).toBe('');
  });
});
