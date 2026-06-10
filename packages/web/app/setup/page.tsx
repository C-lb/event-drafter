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
      done: false,
    },
  ];

  const completedCount = steps.filter((step) => step.done).length;
  const allDone = completedCount === steps.length;

  return (
    <section className="max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">Setup Wizard</h2>
        <span className="text-xs text-neutral-600">
          {completedCount} of {steps.length} complete
        </span>
      </div>

      <p className="text-sm text-neutral-700">
        Walk through these steps once. Setup state is stored locally — you only repeat a step when
        something material changes (new API key, new Sheet, WhatsApp logged out, etc.).
      </p>

      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li
            key={step.href}
            className={`flex items-start gap-3 rounded border p-3 transition-colors ${
              step.done ? 'border-green-200 bg-green-50' : 'border-neutral-200 bg-white hover:bg-neutral-50'
            }`}
          >
            <span
              className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs ${
                step.done ? 'bg-green-600 text-white' : 'bg-neutral-200 text-neutral-700'
              }`}
            >
              {step.done ? '✓' : i + 1}
            </span>
            <Link href={step.href} className="flex-1">
              <p className="text-sm font-medium hover:underline">{step.label}</p>
              <p className="text-xs text-neutral-600">{step.description}</p>
            </Link>
          </li>
        ))}
      </ol>

      {allDone && (
        <p className="rounded bg-green-50 p-3 text-sm text-green-800">
          Setup is complete. <Link href="/" className="underline">Back to dashboard</Link>.
        </p>
      )}
    </section>
  );
}
