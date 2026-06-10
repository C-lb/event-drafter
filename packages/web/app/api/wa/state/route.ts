import { NextResponse } from 'next/server';
import { getLoginState, shutdownWa } from '@vip/worker/wa/driver';

export async function GET() {
  try {
    const state = await getLoginState();
    return NextResponse.json({ state });
  } catch (err) {
    return NextResponse.json({ state: 'error', error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally {
    await shutdownWa();
  }
}
