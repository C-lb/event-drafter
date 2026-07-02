import { getRateLimitMs } from './actions';
import { fromMs } from '@/lib/rate-limit-form';
import { SendingForm } from './SendingForm';

export const dynamic = 'force-dynamic';

export default async function SendingPage() {
  const ms = await getRateLimitMs();
  const initial = fromMs(ms);
  return <SendingForm initial={initial} />;
}
