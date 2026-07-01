import { describe, it, expect } from 'vitest';
import {
  buildWorkerEvents,
  describeWorkerEvent,
  type WorkerJobRow,
  type WorkerEvent,
} from './worker-events';

const SINCE = 1_000_000;

function row(p: Partial<WorkerJobRow> & Pick<WorkerJobRow, 'id' | 'kind' | 'status'>): WorkerJobRow {
  return { started_at: null, finished_at: null, last_error: null, recipient: null, ...p };
}

describe('buildWorkerEvents', () => {
  it('emits a started event for a running job started at/after the cursor', () => {
    const { events } = buildWorkerEvents(
      [row({ id: 1, kind: 'check_replies', status: 'running', started_at: SINCE + 5 })],
      SINCE,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ key: '1:started', phase: 'started', kind: 'check_replies' });
  });

  it('emits both started and finished for a job that ran and completed', () => {
    const { events } = buildWorkerEvents(
      [row({ id: 7, kind: 'draft_invite', status: 'succeeded', started_at: SINCE + 1, finished_at: SINCE + 9 })],
      SINCE,
    );
    expect(events.map((e) => e.phase)).toEqual(['started', 'finished']);
  });

  it('ignores anything before the cursor (no history replay)', () => {
    const { events } = buildWorkerEvents(
      [row({ id: 2, kind: 'draft_invite', status: 'succeeded', started_at: SINCE - 100, finished_at: SINCE - 50 })],
      SINCE,
    );
    expect(events).toHaveLength(0);
  });

  it('only finishes succeeded/failed jobs, not still-queued rows', () => {
    const { events } = buildWorkerEvents(
      [row({ id: 3, kind: 'draft_invite', status: 'queued', finished_at: SINCE + 3 })],
      SINCE,
    );
    expect(events).toHaveLength(0);
  });

  it('carries last_error onto a failed finished event', () => {
    const { events } = buildWorkerEvents(
      [row({ id: 4, kind: 'send_message', status: 'failed', finished_at: SINCE + 2, last_error: 'boom' })],
      SINCE,
    );
    expect(events[0]).toMatchObject({ phase: 'finished', status: 'failed', error: 'boom' });
  });

  it('orders events by time and reports the newest as the cursor', () => {
    const { events, cursor } = buildWorkerEvents(
      [
        row({ id: 1, kind: 'check_replies', status: 'succeeded', started_at: SINCE + 30, finished_at: SINCE + 40 }),
        row({ id: 2, kind: 'draft_invite', status: 'running', started_at: SINCE + 10 }),
      ],
      SINCE,
    );
    expect(events.map((e) => e.at)).toEqual([SINCE + 10, SINCE + 30, SINCE + 40]);
    expect(cursor).toBe(SINCE + 40);
  });

  it('returns the unchanged cursor when nothing is new', () => {
    const { events, cursor } = buildWorkerEvents([], SINCE);
    expect(events).toHaveLength(0);
    expect(cursor).toBe(SINCE);
  });
});

const ev = (p: Partial<WorkerEvent> & Pick<WorkerEvent, 'kind' | 'phase' | 'status'>): WorkerEvent => ({
  key: 'k',
  jobId: 1,
  at: SINCE,
  recipient: null,
  error: null,
  ...p,
});

describe('describeWorkerEvent', () => {
  it('weaves the recipient name into send copy', () => {
    expect(describeWorkerEvent(ev({ kind: 'send_message', phase: 'started', status: 'running', recipient: 'Alice' })))
      .toMatchObject({ tone: 'info', title: 'Sending invite to Alice' });
    expect(describeWorkerEvent(ev({ kind: 'send_follow_up', phase: 'finished', status: 'succeeded', recipient: 'Bob' })))
      .toMatchObject({ tone: 'success', title: 'Sent follow-up to Bob' });
  });

  it('uses friendly phrasing for known non-send kinds', () => {
    expect(describeWorkerEvent(ev({ kind: 'check_replies', phase: 'started', status: 'running' })).title)
      .toBe('Checking for replies');
    expect(describeWorkerEvent(ev({ kind: 'generate_follow_ups', phase: 'finished', status: 'succeeded' })).title)
      .toBe('Follow-ups ready');
  });

  it('renders a failed send as a sticky error with the reason', () => {
    const d = describeWorkerEvent(
      ev({ kind: 'send_response', phase: 'finished', status: 'failed', recipient: 'Carol', error: 'timeout' }),
    );
    expect(d).toMatchObject({ tone: 'error', title: 'Could not send to Carol', body: 'timeout', duration: null });
  });

  it('falls back to a humanized kind for unknown jobs', () => {
    expect(describeWorkerEvent(ev({ kind: 'weird_task', phase: 'started', status: 'running' })).title)
      .toBe('Working: Weird task');
  });
});
