'use server';

import { getSetupSteps } from '../../setup/status';

export interface SetupStatus {
  ok: boolean;
  total: number;
  missing: { label: string; href: string }[];
}

/** Setup readiness for the boot toast. On any read error (e.g. no DB during a
 *  prerender) returns ok:false so the client just skips the toast. */
export async function getSetupStatus(): Promise<SetupStatus> {
  try {
    const steps = getSetupSteps();
    const missing = steps.filter((s) => !s.done).map((s) => ({ label: s.label, href: s.href }));
    return { ok: true, total: steps.length, missing };
  } catch {
    return { ok: false, total: 0, missing: [] };
  }
}
