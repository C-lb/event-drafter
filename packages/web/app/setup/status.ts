import { getSetting } from '@event-drafter/core/settings';

export interface SetupStep {
  label: string;
  done: boolean;
  href: string;
}

/**
 * The setup checklist, single source of truth. Reads live settings, so it can
 * throw during the static prerender of /_not-found (no migrated DB yet) —
 * callers must guard with try/catch. At runtime the DB always exists.
 */
export function getSetupSteps(): SetupStep[] {
  return [
    { label: 'LLM provider', done: getSetting('llm_ready') === true, href: '/setup/llm' },
    { label: 'Google account', done: getSetting('google_tokens') !== null, href: '/setup/google' },
    { label: 'Contacts sheet', done: getSetting('contacts_sheet') !== null, href: '/setup/sheet' },
    { label: 'Import contacts', done: getSetting('setup_completed') === true, href: '/setup/import' },
    { label: 'WhatsApp Web', done: getSetting('wa_ready') === true, href: '/setup/wa' },
  ];
}
