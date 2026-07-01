import { getDb } from '@/lib/db';
import { jobs } from '@event-drafter/core/schema';
import { getSetting } from '@event-drafter/core/settings';
import { SCHEDULES, getReplyCheckSchedule } from '@event-drafter/worker/scheduler';
import { nextRunFor, ago } from '@/lib/cron-format';
import { eq, sql } from 'drizzle-orm';
import { triggerCleanup, restartWorker } from './actions';
import { listLimbo } from './limbo-actions';
import { RestartWorkerButton } from './RestartWorkerButton';
import { MessagesInLimbo } from './MessagesInLimbo';
import { AutoRefresh } from '../components/AutoRefresh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function HealthTag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`badge ${ok ? 'badge-green' : 'badge-red'}`}>
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

export default async function StatusPage() {
  const db = getDb();
  const limbo = await listLimbo();

  const heartbeat = getSetting('worker_heartbeat');
  const heartbeatAge = heartbeat?.ts ? Date.now() - heartbeat.ts : null;
  const workerOk = heartbeatAge !== null && heartbeatAge < 15_000;

  const tokens = getSetting('google_tokens');
  const tokenExpMs = tokens ? tokens.expiry_date - Date.now() : null;
  // Auth is healthy as long as we have a refresh_token — access tokens expire
  // hourly but googleapis auto-refreshes them via the 'tokens' event in
  // authorizedClient(). The "Expires:" line below still shows access-token
  // lifetime for visibility.
  const googleOk = Boolean(tokens?.refresh_token);

  const lastOk = getSetting('llm_last_ok');
  const lastErr = getSetting('llm_last_error');
  const llmOk = lastOk !== null && (lastErr === null || (lastOk?.ts ?? 0) >= lastErr.ts);

  const queueRows = db
    .select({ status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.status)
    .all();
  const queue: Record<string, number> = { queued: 0, running: 0, succeeded: 0, failed: 0 };
  for (const r of queueRows) queue[r.status] = Number(r.count);

  const breakdownRows = db
    .select({ kind: jobs.kind, status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.kind, jobs.status)
    .all();
  const STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
  const breakdown = new Map<string, Record<string, number>>();
  for (const r of breakdownRows) {
    if (!breakdown.has(r.kind)) breakdown.set(r.kind, { queued: 0, running: 0, succeeded: 0, failed: 0 });
    breakdown.get(r.kind)![r.status] = Number(r.count);
  }
  const sortedKinds = [...breakdown.keys()].sort();

  const recentFailed = db
    .select({ id: jobs.id, kind: jobs.kind, created_at: jobs.created_at, last_error: jobs.last_error })
    .from(jobs)
    .where(sql`${jobs.status} = 'failed'`)
    .orderBy(sql`${jobs.id} DESC`)
    .limit(5)
    .all();

  const inFlight = db
    .select({ id: jobs.id, kind: jobs.kind, status: jobs.status, created_at: jobs.created_at, started_at: jobs.started_at, attempts: jobs.attempts, progress: jobs.progress })
    .from(jobs)
    .where(sql`${jobs.status} IN ('queued','running')`)
    .orderBy(sql`${jobs.id} ASC`)
    .limit(20)
    .all();

  const cleanupInFlight = inFlight.some((j) => j.kind === 'cleanup_jobs');
  const lastCleanup = db
    .select({ id: jobs.id, status: jobs.status, created_at: jobs.created_at, finished_at: jobs.finished_at })
    .from(jobs)
    .where(eq(jobs.kind, 'cleanup_jobs'))
    .orderBy(sql`${jobs.id} DESC`)
    .limit(1)
    .get();

  return (
    <section className="space-y-6">
      {/* Keep the page live whenever ANY job is queued or running, so progress
          text (jobs.progress) and counters update without a manual reload. */}
      <AutoRefresh active={inFlight.length > 0} />
      <MessagesInLimbo records={limbo.records} prefilledCount={limbo.prefilledCount} />
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Status</h2>
        <div className="flex items-start gap-2">
          <form action={triggerCleanup}>
            <button
              type="submit"
              disabled={cleanupInFlight}
              className="btn btn-sm"
              title={lastCleanup ? `Last cleanup: ${lastCleanup.status} ${ago(((lastCleanup.finished_at ?? lastCleanup.created_at) as Date | null)?.getTime() ?? null)}` : 'No prior cleanup'}
            >
              {cleanupInFlight ? 'Cleaning up…' : 'Run cleanup now'}
            </button>
          </form>
          <RestartWorkerButton action={restartWorker} workerOk={workerOk} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <HealthTag ok={workerOk} label={`worker ${workerOk ? heartbeat?.node ?? '' : 'down'}`} />
        <HealthTag ok={googleOk} label={googleOk ? 'google auth ok' : 'google needs re-auth'} />
        <HealthTag ok={llmOk} label={llmOk ? 'llm ok' : 'llm error'} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="text-base font-semibold">Worker heartbeat</h3>
          <p className="text-xs text-ink-2">Last beat: {ago(heartbeat?.ts ?? null)}</p>
          <p className="text-xs text-ink-2">Node: {heartbeat?.node ?? '—'}</p>
        </div>
        <div className="card flex flex-col p-5">
          <h3 className="text-base font-semibold">Google tokens</h3>
          <p className="text-xs text-ink-2">
            Expires:{' '}
            {tokens
              ? `${new Date(tokens.expiry_date).toLocaleString()} (${tokenExpMs && tokenExpMs > 0 ? Math.round(tokenExpMs / 60_000) + ' min' : 'expired'})`
              : 'no tokens'}
          </p>
          <p className="text-xs text-ink-2">Scopes: {tokens?.scope ?? '—'}</p>
          <a href="/api/auth/google/start" className={`btn-sm mt-3 self-start ${googleOk ? 'btn' : 'btn-primary'}`}>
            {googleOk ? 'Re-authorize' : 'Re-authorize Google'}
          </a>
        </div>
        <div className="card p-5">
          <h3 className="text-base font-semibold">LLM (Ollama)</h3>
          <p className="text-xs text-ink-2">Last OK: {ago(lastOk?.ts ?? null)}</p>
          <p className="text-xs text-ink-2">Last error: {lastErr ? `${ago(lastErr.ts)}. ${lastErr.message}` : 'none'}</p>
        </div>
        <div className="card p-5">
          <h3 className="text-base font-semibold">Job queue totals</h3>
          <ul className="text-xs text-ink-2">
            {Object.entries(queue).map(([k, v]) => (
              <li key={k}>{k}: <strong className="text-ink">{v}</strong></li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <h3 className="eyebrow mb-2">Jobs by kind</h3>
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-ink-2">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Kind</th>
              {STATUSES.map((s) => (
                <th key={s} className="px-2 py-1 text-right font-medium">{s}</th>
              ))}
              <th className="px-2 py-1 text-right font-medium">total</th>
            </tr>
          </thead>
          <tbody>
            {sortedKinds.map((k) => {
              const row = breakdown.get(k)!;
              const total = STATUSES.reduce((acc, s) => acc + (row[s] ?? 0), 0);
              return (
                <tr key={k} className="border-b border-line">
                  <td className="px-2 py-1 font-mono">{k}</td>
                  {STATUSES.map((s) => (
                    <td key={s} className={`px-2 py-1 text-right ${(row[s] ?? 0) > 0 && s === 'failed' ? 'bg-red-50 text-red-700' : (row[s] ?? 0) > 0 && (s === 'queued' || s === 'running') ? 'bg-amber-50 text-amber-900' : ''}`}>
                      {row[s] ? row[s] : ''}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right font-semibold">{total}</td>
                </tr>
              );
            })}
            {sortedKinds.length === 0 && (
              <tr><td colSpan={STATUSES.length + 2} className="px-2 py-1 text-ink-3">No jobs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {inFlight.length > 0 && (
        <div>
          <h3 className="eyebrow mb-2">In flight (queued and running)</h3>
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-ink-2">
              <tr>
                <th className="px-2 py-1 text-left font-medium">ID</th>
                <th className="px-2 py-1 text-left font-medium">Kind</th>
                <th className="px-2 py-1 text-left font-medium">Status</th>
                <th className="px-2 py-1 text-left font-medium">Progress</th>
                <th className="px-2 py-1 text-left font-medium">Created</th>
                <th className="px-2 py-1 text-right font-medium">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {inFlight.map((j) => (
                <tr key={j.id} className="border-b border-line">
                  <td className="px-2 py-1">{j.id}</td>
                  <td className="px-2 py-1 font-mono">{j.kind}</td>
                  <td className="px-2 py-1"><span className={`badge ${j.status === 'running' ? 'badge-blue' : 'badge-neutral'}`}>{j.status}</span></td>
                  <td className="px-2 py-1">{j.progress ?? <span className="text-ink-3">—</span>}</td>
                  <td className="px-2 py-1">{ago(j.created_at instanceof Date ? j.created_at.getTime() : Number(j.created_at))}</td>
                  <td className="px-2 py-1 text-right">{j.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentFailed.length > 0 && (
        <div>
          <h3 className="eyebrow mb-2">Recent failures</h3>
          <ul className="space-y-1 text-xs">
            {recentFailed.map((j) => (
              <li key={j.id} className="rounded-card bg-red-50 p-4 text-red-700 ring-1 ring-inset ring-red-600/20">
                <p><strong>#{j.id}</strong> <span className="font-mono">{j.kind}</span> · {ago(j.created_at instanceof Date ? j.created_at.getTime() : Number(j.created_at))}</p>
                <p className="line-clamp-2">{j.last_error?.slice(0, 200) ?? ''}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="eyebrow">Cron schedule</h3>
          <a href="/settings/timing" className="text-xs font-medium text-accent hover:text-accent-hover">Edit reply-check times</a>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-ink-2">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Label</th>
              <th className="px-2 py-1 text-left font-medium">Cron (UTC)</th>
              <th className="px-2 py-1 text-left font-medium">Kind</th>
              <th className="px-2 py-1 text-left font-medium">Next run</th>
            </tr>
          </thead>
          <tbody>
            {getReplyCheckSchedule().map((s) => (
              <tr key={`reply-${s.time}`} className="border-b border-line">
                <td className="px-2 py-1">{s.label}</td>
                <td className="px-2 py-1 font-mono">{s.time} SGT</td>
                <td className="px-2 py-1">{s.kind}</td>
                <td className="px-2 py-1 text-ink-3">daily</td>
              </tr>
            ))}
            {Object.entries(SCHEDULES).map(([name, s]) => {
              const next = nextRunFor(s.cron);
              return (
                <tr key={name} className="border-b border-line">
                  <td className="px-2 py-1">{s.label}</td>
                  <td className="px-2 py-1 font-mono">{s.cron}</td>
                  <td className="px-2 py-1">{s.kind}</td>
                  <td className="px-2 py-1">{next ? next.toLocaleString() : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
