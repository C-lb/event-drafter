'use server';

import { setSetting, getSetting } from '@event-drafter/core/settings';

export async function markLLMReady(ready: boolean): Promise<void> {
  setSetting('llm_ready', ready);
}

export async function markSetupCompleted(): Promise<void> {
  setSetting('setup_completed', true);
}

export async function getSetupStatus() {
  return {
    llm: getSetting('llm_ready') === true,
    google: getSetting('google_tokens') !== null,
    sheet: getSetting('contacts_sheet') !== null,
    completed: getSetting('setup_completed') === true,
    wa: getSetting('wa_ready') === true,
  };
}
