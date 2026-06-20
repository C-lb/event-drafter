import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:net';
import { acquireSingletonLock } from '../src/lock.js';

const open: Server[] = [];
const PORT = 47699;

afterEach(async () => {
  await Promise.all(open.map((s) => new Promise<void>((r) => s.close(() => r()))));
  open.length = 0;
});

describe('acquireSingletonLock()', () => {
  it('lets the first worker acquire the lock', async () => {
    const s = await acquireSingletonLock(PORT);
    open.push(s);
    expect(s.listening).toBe(true);
  });

  it('refuses a second worker while the lock is held', async () => {
    open.push(await acquireSingletonLock(PORT));
    await expect(acquireSingletonLock(PORT)).rejects.toThrow(/already running/i);
  });

  it('frees the lock when the holder closes (process death)', async () => {
    const first = await acquireSingletonLock(PORT);
    await new Promise<void>((r) => first.close(() => r()));
    const second = await acquireSingletonLock(PORT);
    open.push(second);
    expect(second.listening).toBe(true);
  });
});
