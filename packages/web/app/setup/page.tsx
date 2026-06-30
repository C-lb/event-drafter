import Link from 'next/link';
import { getSetupStatus } from './actions';

export const dynamic = 'force-dynamic';

interface Step {
  href: string;
  label: string;
  description: string;
  done: boolean;
}

export default async function SetupHome() {
  const s = await getSetupStatus();
  const steps: Step[] = [
    {
      href: '/setup/llm',
      label: 'LLM Provider',
      description: 'Pick between local Ollama (private, free) or the Anthropic API (cloud, paid).',
      done: s.llm,
    },
    {
      href: '/setup/google',
      label: 'Connect Google Account',
      description: 'OAuth into your Gmail + Sheets for reading the contacts list and event emails.',
      done: s.google,
    },
    {
      href: '/setup/sheet',
      label: 'Pick Contacts Sheet',
      description: 'Choose the Google Sheet that holds your VIP contacts and map its columns.',
      done: s.sheet,
    },
    {
      href: '/setup/import',
      label: 'Import Contacts',
      description: 'Pull the rows from the Sheet into the local database for use across events.',
      done: s.completed,
    },
    {
      href: '/setup/wa',
      label: 'Connect WhatsApp Web',
      description: 'Scan the QR with your phone so the worker can pre-fill messages and read replies.',
      done: s.wa,
    },
  ];

  const completedCount = steps.filter((step) => step.done).length;
  const allDone = completedCount === steps.length;

  return (
    <section className="mx-auto max-w-2xl space-y-7">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Setup wizard</h2>
        <span className="text-xs text-ink-3">
          {completedCount} of {steps.length} complete
        </span>
      </div>

      <p className="text-sm text-ink-2">
        Walk through these steps once. Setup state is stored locally, so you only repeat a step when
        something material changes (new API key, new Sheet, WhatsApp logged out, etc.).
      </p>

      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li
            key={step.href}
            className={`flex items-start gap-3 p-4 transition-colors ${
              step.done ? 'rounded-card bg-emerald-50 ring-1 ring-inset ring-emerald-600/20' : 'card hover:bg-surface-2'
            }`}
          >
            <span
              className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs ${
                step.done ? 'bg-emerald-600 text-white' : 'bg-surface-2 text-ink-2'
              }`}
            >
              {step.done ? '✓' : i + 1}
            </span>
            <Link href={step.href} className="flex-1">
              <p className="text-sm font-medium hover:text-accent">{step.label}</p>
              <p className="text-xs text-ink-2">{step.description}</p>
            </Link>
          </li>
        ))}
      </ol>

      {allDone && (
        <p className="rounded-card bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          Setup is complete. <Link href="/" className="font-medium text-accent hover:text-accent-hover">Back to dashboard</Link>.
        </p>
      )}

      <div className="border-t border-surface-2 pt-6">
        <p className="mb-3 text-xs font-medium text-ink-3">Settings</p>
        <Link
          href="/settings/sending"
          className="card flex items-start gap-3 p-4 hover:bg-surface-2 transition-colors"
        >
          <div className="flex-1">
            <p className="text-sm font-medium">Sending cadence</p>
            <p className="text-xs text-ink-2">Tune the WhatsApp send rate limiter.</p>
          </div>
          <span className="mt-0.5 text-ink-3">&#8250;</span>
        </Link>
      </div>
    </section>
  );
}
