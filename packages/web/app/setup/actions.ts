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

export async function saveLLMConfig(data: FormData): Promise<void> {
  const provider = String(data.get('provider') ?? '');
  const apiKey = String(data.get('anthropic_api_key') ?? '').trim();
  if (provider === 'ollama' || provider === 'anthropic') {
    setSetting('llm_provider', provider);
  }
  if (apiKey) {
    setSetting('anthropic_api_key', apiKey);
  }
}

export async function saveGoogleCredentials(data: FormData): Promise<void> {
  const clientId = String(data.get('google_client_id') ?? '').trim();
  const clientSecret = String(data.get('google_client_secret') ?? '').trim();
  if (clientId) setSetting('google_client_id', clientId);
  if (clientSecret) setSetting('google_client_secret', clientSecret);
}
