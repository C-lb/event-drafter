import { getDb } from '@/lib/db';
import { jobs } from '@vip/core/schema';
import { getSetting } from '@vip/core/settings';
import { SCHEDULES } from '@vip/worker/scheduler';
import { nextRunFor, ago } from '@/lib/cron-format';
import { sql } from 'drizzle-orm';

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

  const lastOk = getSetting('anthropic_last_ok');
  const lastErr = getSetting('anthropic_last_error');
  const anthropicOk = lastOk !== null && (lastErr === null || (lastOk?.ts ?? 0) >= lastErr.ts);

  const queueRows = db
    .select({ status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.status)
    .all();
  const queue: Record<string, number> = { queued: 0, running: 0, succeeded: 0, failed: 0 };
  for (const r of queueRows) queue[r.status] = Number(r.count);

  return (
    <section className="max-w-3xl space-y-6">
      <h2 className="text-xl font-semibold">Status</h2>

      <div className="flex flex-wrap gap-2">
        <HealthTag ok={workerOk} label={`worker ${workerOk ? heartbeat?.node ?? '' : 'down'}`} />
        <HealthTag ok={googleOk} label={googleOk ? 'google auth ok' : 'google needs re-auth'} />
        <HealthTag ok={anthropicOk} label={anthropicOk ? 'anthropic ok' : 'anthropic error'} />
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
          <h3 className="text-sm font-semibold">Anthropic</h3>
          <p className="text-xs text-neutral-700">Last OK: {ago(lastOk?.ts ?? null)}</p>
          <p className="text-xs text-neutral-700">Last error: {lastErr ? `${ago(lastErr.ts)} — ${lastErr.message}` : 'none'}</p>
        </div>
        <div className="rounded border border-neutral-200 bg-white p-3">
          <h3 className="text-sm font-semibold">Job queue</h3>
          <ul className="text-xs">
            {Object.entries(queue).map(([k, v]) => (
              <li key={k}>{k}: <strong>{v}</strong></li>
            ))}
          </ul>
        </div>
      </div>

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
