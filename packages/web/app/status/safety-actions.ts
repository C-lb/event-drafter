'use server';
import { setSetting } from '@event-drafter/core/settings';

export async function engageSafetyStop() {
  setSetting('worker_safety_stop', { engaged: true, ts: Date.now() });
}

export async function releaseSafetyStop() {
  setSetting('worker_safety_stop', { engaged: false, ts: Date.now() });
}
