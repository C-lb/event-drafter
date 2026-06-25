import Link from 'next/link';
import { getSetting } from '@event-drafter/core/settings';

interface StepStatus {
  label: string;
  done: boolean;
  href: string;
}

export async function SetupBanner() {
  let steps: StepStatus[];
  try {
    steps = [
      { label: 'LLM Provider', done: getSetting('llm_ready') === true, href: '/setup/llm' },
      { label: 'Google Account', done: getSetting('google_tokens') !== null, href: '/setup/google' },
      { label: 'Contacts Sheet', done: getSetting('contacts_sheet') !== null, href: '/setup/sheet' },
      { label: 'Import Contacts', done: getSetting('setup_completed') === true, href: '/setup/import' },
      { label: 'WhatsApp Web', done: getSetting('wa_ready') === true, href: '/setup/wa' },
    ];
  } catch {
    // The root layout renders this banner, so it also runs during the static
    // prerender of /_not-found at `next build` time — when no migrated DB
    // exists. Don't crash the build over it; at runtime the DB is always there.
    return null;
  }

  const missing = steps.filter((s) => !s.done);
  if (missing.length === 0) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 text-amber-900">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-2.5 text-sm">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-none text-amber-600" aria-hidden>
            <path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
          <strong className="font-semibold">Setup incomplete.</strong>
          <span>
            {missing.length} of {steps.length} step{missing.length === 1 ? '' : 's'} left:{' '}
            {missing.map((m, i) => (
              <span key={m.href}>
                {i > 0 && ', '}
                <Link href={m.href} className="font-medium underline underline-offset-2 hover:text-amber-700">
                  {m.label}
                </Link>
              </span>
            ))}
          </span>
        </p>
        <Link href="/setup" className="btn btn-sm shrink-0">
          Finish setup
        </Link>
      </div>
    </div>
  );
}
