/**
 * Thrown by a job handler to ask the poller to re-queue this job
 * for a later run, without counting it as a failed attempt.
 * Used for rate-limit gates and self-postponement.
 */
export class JobDeferred extends Error {
  constructor(public delayMs: number, message: string) {
    super(message);
    this.name = 'JobDeferred';
  }
}
