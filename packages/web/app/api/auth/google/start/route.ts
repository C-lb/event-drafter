import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { buildAuthUrl } from '@event-drafter/worker/google/oauth';

export async function GET() {
  const state = randomUUID();
  const url = buildAuthUrl(state);
  return NextResponse.redirect(url);
}
