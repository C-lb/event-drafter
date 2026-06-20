import net from 'node:net';

const DEFAULT_LOCK_PORT = Number(process.env.ED_WORKER_LOCK_PORT ?? 47654);

/**
 * Single-worker guarantee.
 *
 * Binds a localhost TCP port as a process-wide mutex: only one process can hold
 * a given port, and the OS releases it the instant the holder dies — so there is
 * no stale lockfile to reap after a crash. A second worker (including a
 * tsx-watch orphan or a double `npm run dev`) hits EADDRINUSE and is rejected,
 * which keeps two pollers from ever running the send loop concurrently. That
 * concurrency is what the rate limiter and the DB send-claims can't fully cover
 * on their own — two workers could otherwise dispatch two *different* messages
 * in the same instant, breaking "one at a time".
 *
 * Resolves with the listening server (keep the reference for the process
 * lifetime); rejects if the lock is already held.
 */
export function acquireSingletonLock(port = DEFAULT_LOCK_PORT): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`another event-drafter worker is already running (lock port ${port} in use)`));
      } else {
        reject(err);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      // Don't let the lock alone keep the event loop alive — the poller does that.
      server.unref();
      resolve(server);
    });
  });
}
