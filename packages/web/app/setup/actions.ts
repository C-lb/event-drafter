'use server';

import { setSetting, getSetting } from '@vip/core/settings';

export async function markAnthropicKeySet(set: boolean): Promise<void> {
  setSetting('anthropic_key_set', set);
}

export async function markSetupCompleted(): Promise<void> {
  setSetting('setup_completed', true);
}

export async function getSetupStatus() {
  return {
    anthropic: getSetting('anthropic_key_set') === true,
    google: getSetting('google_tokens') !== null,
    sheet: getSetting('contacts_sheet') !== null,
    completed: getSetting('setup_completed') === true,
  };
}
