import { getTiming } from './actions';
import { TimingForm } from './TimingForm';

export const dynamic = 'force-dynamic';

export default async function TimingPage() {
  const initial = await getTiming();
  return <TimingForm initial={initial} />;
}
