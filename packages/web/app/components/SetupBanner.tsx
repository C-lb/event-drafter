import Link from 'next/link';
import { getSetting } from '@vip/core/settings';

interface StepStatus {
  label: string;
  done: boolean;
  href: string;
}

export async function SetupBanner() {
  const steps: StepStatus[] = [
    { label: 'LLM Provider', done: getSetting('llm_ready') === true, href: '/setup/llm' },
    { label: 'Google Account', done: getSetting('google_tokens') !== null, href: '/setup/google' },
    { label: 'Contacts Sheet', done: getSetting('contacts_sheet') !== null, href: '/setup/sheet' },
    { label: 'Import Contacts', done: getSetting('setup_completed') === true, href: '/setup/import' },
    { label: 'WhatsApp Web', done: getSetting('wa_ready') === true, href: '/setup/wa' },
  ];

  const missing = steps.filter((s) => !s.done);
  if (missing.length === 0) return null;

  return (
    <div className="border-b border-red-300 bg-red-50 px-6 py-2 text-sm text-red-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <span aria-hidden className="mr-2 inline-flex h-2 w-2 rounded-full bg-red-600" />
          <strong>Setup incomplete</strong> — {missing.length} of {steps.length} step
          {missing.length === 1 ? '' : 's'} remaining:{' '}
          {missing.map((m, i) => (
            <span key={m.href}>
              {i > 0 && ', '}
              <Link href={m.href} className="underline underline-offset-2 hover:text-red-700">
                {m.label}
              </Link>
            </span>
          ))}
        </p>
        <Link
          href="/setup"
          className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
        >
          Finish setup →
        </Link>
      </div>
    </div>
  );
}
