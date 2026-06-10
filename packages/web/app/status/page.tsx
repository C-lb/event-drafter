import { getDb } from '@/lib/db';
import { jobs } from '@vip/core/schema';
import { getSetting } from '@vip/core/settings';
import { SCHEDULES } from '@vip/worker/scheduler';
import { nextRunFor, ago } from '@/lib/cron-format';
import { eq, sql } from 'drizzle-orm';
import { triggerCleanup } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function HealthTag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

export default async function StatusPage() {
  const db = getDb();

  const heartbeat = getSetting('worker_heartbeat');
  const heartbeatAge = heartbeat?.ts ? Date.now() - heartbeat.ts : null;
  const workerOk = heartbeatAge !== null && heartbeatAge < 15_000;

  const tokens = getSetting('google_tokens');
  const tokenExpMs = tokens ? tokens.expiry_date - Date.now() : null;
  const googleOk = Boolean(tokens && tokenExpMs && tokenExpMs > 0);

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
    .select({ id: jobs.id, kind: jobs.kind, status: jobs.status, created_at: jobs.created_at, started_at: jobs.started_at, attempts: jobs.attempts })
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
    <section className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Status</h2>
        <form action={triggerCleanup}>
          <button
            type="submit"
            disabled={cleanupInFlight}
            className="rounded bg-neutral-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            title={lastCleanup ? `Last cleanup: ${lastCleanup.status} ${ago(lastCleanup.finished_at ?? lastCleanup.created_at)}` : 'No prior cleanup'}
          >
            {cleanupInFlight ? 'Cleaning up…' : 'Run cleanup now'}
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2">
        <HealthTag ok={workerOk} label={`worker ${workerOk ? heartbeat?.node ?? '' : 'down'}`} />
        <HealthTag ok={googleOk} label={googleOk ? 'google auth ok' : 'google needs re-auth'} />
        <HealthTag ok={llmOk} label={llmOk ? 'llm ok' : 'llm error'} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded border border-neutral-200 bg-white p-3">
          <h3 className="text-sm font-semibold">Worker heartbeat</h3>
          <p className="text-xs text-neutral-700">Last beat: {ago(heartbeat?.ts ?? null)}</p>
          <p className="text-xs text-neutral-700">Node: {heartbeat?.node ?? '—'}</p>
        </div>
        <div className="rounded border border-neutral-200 bg-white p-3">
          <h3 className="text-sm font-semibold">Google tokens</h3>
          <p className="text-xs text-neutral-700">
            Expires:{' '}
            {tokens
              ? `${new Date(tokens.expiry_date).toLocaleString()} (${tokenExpMs && tokenExpMs > 0 ? Math.round(tokenExpMs / 60_000) + ' min' : 'expired'})`
              : 'no tokens'}
          </p>
          <p className="text-xs text-neutral-700">Scopes: {tokens?.scope ?? '—'}</p>
        </div>
        <div className="rounded border border-neutral-200 bg-white p-3">
          <h3 className="text-sm font-semibold">LLM (Ollama)</h3>
          <p className="text-xs text-neutral-700">Last OK: {ago(lastOk?.ts ?? null)}</p>
          <p className="text-xs text-neutral-700">Last error: {lastErr ? `${ago(lastErr.ts)} — ${lastErr.message}` : 'none'}</p>
        </div>
        <div className="rounded border border-neutral-200 bg-white p-3">
          <h3 className="text-sm font-semibold">Job queue totals</h3>
          <ul className="text-xs">
            {Object.entries(queue).map(([k, v]) => (
              <li key={k}>{k}: <strong>{v}</strong></li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Jobs by kind</h3>
        <table className="w-full text-xs">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border px-2 py-1 text-left">Kind</th>
              {STATUSES.map((s) => (
                <th key={s} className="border px-2 py-1 text-right">{s}</th>
              ))}
              <th className="border px-2 py-1 text-right">total</th>
            </tr>
          </thead>
          <tbody>
            {sortedKinds.map((k) => {
              const row = breakdown.get(k)!;
              const total = STATUSES.reduce((acc, s) => acc + row[s], 0);
              return (
                <tr key={k}>
                  <td className="border px-2 py-1 font-mono">{k}</td>
                  {STATUSES.map((s) => (
                    <td key={s} className={`border px-2 py-1 text-right ${row[s] > 0 && s === 'failed' ? 'bg-red-50 text-red-800' : row[s] > 0 && (s === 'queued' || s === 'running') ? 'bg-amber-50' : ''}`}>
                      {row[s] || ''}
                    </td>
                  ))}
                  <td className="border px-2 py-1 text-right font-semibold">{total}</td>
                </tr>
              );
            })}
            {sortedKinds.length === 0 && (
              <tr><td colSpan={STATUSES.length + 2} className="border px-2 py-1 text-neutral-500">No jobs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {inFlight.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">In flight (queued + running)</h3>
          <table className="w-full text-xs">
            <thead className="bg-neutral-100">
              <tr>
                <th className="border px-2 py-1 text-left">ID</th>
                <th className="border px-2 py-1 text-left">Kind</th>
                <th className="border px-2 py-1 text-left">Status</th>
                <th className="border px-2 py-1 text-left">Created</th>
                <th className="border px-2 py-1 text-right">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {inFlight.map((j) => (
                <tr key={j.id}>
                  <td className="border px-2 py-1">{j.id}</td>
                  <td className="border px-2 py-1 font-mono">{j.kind}</td>
                  <td className="border px-2 py-1">{j.status}</td>
                  <td className="border px-2 py-1">{ago(j.created_at instanceof Date ? j.created_at.getTime() : Number(j.created_at))}</td>
                  <td className="border px-2 py-1 text-right">{j.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentFailed.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Recent failures</h3>
          <ul className="space-y-1 text-xs">
            {recentFailed.map((j) => (
              <li key={j.id} className="rounded bg-red-50 p-2 text-red-900">
                <p><strong>#{j.id}</strong> <span className="font-mono">{j.kind}</span> · {ago(j.created_at instanceof Date ? j.created_at.getTime() : Number(j.created_at))}</p>
                <p className="line-clamp-2">{j.last_error?.slice(0, 200) ?? ''}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Cron schedule</h3>
        <table className="w-full text-xs">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border px-2 py-1 text-left">Label</th>
              <th className="border px-2 py-1 text-left">Cron (UTC)</th>
              <th className="border px-2 py-1 text-left">Kind</th>
              <th className="border px-2 py-1 text-left">Next run</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(SCHEDULES).map(([name, s]) => {
              const next = nextRunFor(s.cron);
              return (
                <tr key={name}>
                  <td className="border px-2 py-1">{s.label}</td>
                  <td className="border px-2 py-1 font-mono">{s.cron}</td>
                  <td className="border px-2 py-1">{s.kind}</td>
                  <td className="border px-2 py-1">{next ? next.toLocaleString() : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
