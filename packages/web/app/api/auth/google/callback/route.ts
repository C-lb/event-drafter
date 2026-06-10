import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCode } from '@vip/worker/google/oauth';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error) {
    return NextResponse.redirect(new URL(`/setup/google?error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL('/setup/google?error=no_code', req.url));
  }
  try {
    await exchangeCode(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.redirect(
      new URL(`/setup/google?error=${encodeURIComponent(msg)}`, req.url),
    );
  }
  return NextResponse.redirect(new URL('/setup/sheet', req.url));
}
