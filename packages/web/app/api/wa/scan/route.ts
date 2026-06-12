import { NextResponse } from 'next/server';
import { setSetting } from '@vip/core/settings';
import { waitForLogin, shutdownWa } from '@vip/worker/wa/driver';

export async function POST() {
  try {
    await waitForLogin(5 * 60 * 1000);
    setSetting('wa_ready', true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    await shutdownWa();
  }
}
