// packages/web/lib/limbo.ts
// Decides which mid-send records need an operator decision after a crash.
// Pure: all DB I/O lives in lib/limbo-read.ts.

export type LimboType = 'invite' | 'follow_up' | 'reply';
export type LimboState = 'sending' | 'prefilled';

export interface LimboRecord {
  type: LimboType;
  /** record id: invite_id / follow_up_id / reply_id */
  id: number;
  state: LimboState;
  name: string;
  eventId: number | null;
  eventName: string | null;
}

export interface LimboInput {
  /** candidates already narrowed to status in ('sending','prefilled') */
  records: LimboRecord[];
  autoSend: boolean;
  /** the record the worker is sending right now (exclude), or null */
  activeSend: { type: LimboType; id: number } | null;
}

export interface LimboList {
  records: LimboRecord[];
  count: number;
  prefilledCount: number;
}

export function selectLimbo(input: LimboInput): LimboList {
  const { records, autoSend, activeSend } = input;
  const flagged = records.filter((r) => {
    if (activeSend && r.type === activeSend.type && r.id === activeSend.id) return false;
    if (r.state === 'sending') return true;
    return autoSend; // prefilled: only when auto-send is on
  });
  flagged.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'sending' ? -1 : 1;
    return (a.eventName ?? '').localeCompare(b.eventName ?? '') || a.name.localeCompare(b.name);
  });
  return {
    records: flagged,
    count: flagged.length,
    prefilledCount: flagged.filter((r) => r.state === 'prefilled').length,
  };
}
