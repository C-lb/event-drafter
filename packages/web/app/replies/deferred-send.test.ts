import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDeferredSend, type SendState } from './deferred-send';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createDeferredSend', () => {
  it('fires onSend after the delay and reaches "sent"', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const d = createDeferredSend({ onSend, delayMs: 3000, onChange: () => {} });
    d.send();
    expect(d.state.phase).toBe('sending');
    await vi.advanceTimersByTimeAsync(3000);
    expect(onSend).toHaveBeenCalledOnce();
    expect(d.state.phase).toBe('sent');
  });

  it('undo before the delay cancels the send entirely', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const d = createDeferredSend({ onSend, delayMs: 3000, onChange: () => {} });
    d.send();
    d.undo();
    expect(d.state.phase).toBe('idle');
    await vi.advanceTimersByTimeAsync(3000);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('reaches "error" when onSend rejects', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('boom'));
    const d = createDeferredSend({ onSend, delayMs: 3000, onChange: () => {} });
    d.send();
    await vi.advanceTimersByTimeAsync(3000);
    expect(d.state).toEqual({ phase: 'error', message: 'boom' });
  });

  it('emits each state transition through onChange', async () => {
    const seen: SendState[] = [];
    const d = createDeferredSend({
      onSend: () => Promise.resolve(),
      delayMs: 3000,
      onChange: (s) => seen.push(s),
    });
    d.send();
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen.map((s) => s.phase)).toEqual(['sending', 'sent']);
  });

  it('ignores send() when not idle', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const d = createDeferredSend({ onSend, delayMs: 3000, onChange: () => {} });
    d.send();
    d.send();
    expect(d.state.phase).toBe('sending');
  });

  it('allows send() to retry after error', async () => {
    const onSend = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const d = createDeferredSend({ onSend, delayMs: 3000, onChange: () => {} });
    d.send();
    await vi.advanceTimersByTimeAsync(3000);
    expect(d.state.phase).toBe('error');
    d.send(); // retry from error
    expect(d.state.phase).toBe('sending');
    await vi.advanceTimersByTimeAsync(3000);
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(d.state.phase).toBe('sent');
  });

  it('does not transition after dispose() while onSend is pending', async () => {
    const seen: SendState[] = [];
    let resolveSend: () => void = () => {};
    const onSend = vi.fn(() => new Promise<void>((res) => { resolveSend = res; }));
    const d = createDeferredSend({ onSend, delayMs: 3000, onChange: (s) => seen.push(s) });
    d.send();
    await vi.advanceTimersByTimeAsync(3000);
    d.dispose();
    resolveSend();
    await Promise.resolve();
    expect(seen.map((s) => s.phase)).toEqual(['sending']);
  });
});
