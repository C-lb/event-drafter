import parser from 'cron-parser';

export function nextRunFor(cronExpr: string): Date | null {
  try {
    const it = parser.parseExpression(cronExpr, { tz: 'UTC' });
    return it.next().toDate();
  } catch {
    return null;
  }
}

export function ago(ms: number | undefined | null): string {
  if (!ms) return '—';
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
