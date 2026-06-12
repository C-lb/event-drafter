import { NextResponse, type NextRequest } from 'next/server';
import { getSetting, setSetting } from '@vip/core/settings';
import { getLoginState, shutdownWa } from '@vip/worker/wa/driver';

export async function GET(req: NextRequest) {
  const live = req.nextUrl.searchParams.get('live') === '1';

  if (!live) {
    const ready = getSetting('wa_ready') === true;
    return NextResponse.json({ state: ready ? 'logged-in' : 'unknown', cached: true });
  }

  try {
    const state = await getLoginState();
    if (state === 'logged-in') setSetting('wa_ready', true);
    else if (state === 'needs-qr') setSetting('wa_ready', false);
    return NextResponse.json({ state, cached: false });
  } catch (err) {
    return NextResponse.json(
      { state: 'error', error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    await shutdownWa();
  }
}
