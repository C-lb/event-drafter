import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { buildAuthUrl } from '@vip/worker/google/oauth';

export async function GET() {
  const state = randomUUID();
  const url = buildAuthUrl(state);
  return NextResponse.redirect(url);
}
