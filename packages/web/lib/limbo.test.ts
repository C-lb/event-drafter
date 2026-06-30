// packages/web/lib/limbo.test.ts
import { describe, it, expect } from 'vitest';
import { selectLimbo, type LimboRecord } from './limbo';

const rec = (p: Partial<LimboRecord> & Pick<LimboRecord, 'type' | 'id' | 'state'>): LimboRecord => ({
  name: `name-${p.id}`,
  eventId: 1,
  eventName: 'Gala',
  ...p,
});

describe('selectLimbo', () => {
  it('always flags sending, regardless of auto-send', () => {
    const out = selectLimbo({
      records: [rec({ type: 'invite', id: 1, state: 'sending' })],
      autoSend: false,
      activeSend: null,
    });
    expect(out.count).toBe(1);
    expect(out.prefilledCount).toBe(0);
  });

  it('flags prefilled only when auto-send is on', () => {
    const records = [rec({ type: 'invite', id: 2, state: 'prefilled' })];
    expect(selectLimbo({ records, autoSend: false, activeSend: null }).count).toBe(0);
    const on = selectLimbo({ records, autoSend: true, activeSend: null });
    expect(on.count).toBe(1);
    expect(on.prefilledCount).toBe(1);
  });

  it('excludes the record being actively sent right now', () => {
    const out = selectLimbo({
      records: [
        rec({ type: 'invite', id: 1, state: 'sending' }),
        rec({ type: 'reply', id: 1, state: 'sending' }),
      ],
      autoSend: false,
      activeSend: { type: 'invite', id: 1 },
    });
    expect(out.records.map((r) => `${r.type}:${r.id}`)).toEqual(['reply:1']);
  });

  it('orders sending before prefilled', () => {
    const out = selectLimbo({
      records: [
        rec({ type: 'invite', id: 9, state: 'prefilled' }),
        rec({ type: 'invite', id: 8, state: 'sending' }),
      ],
      autoSend: true,
      activeSend: null,
    });
    expect(out.records.map((r) => r.state)).toEqual(['sending', 'prefilled']);
  });
});
