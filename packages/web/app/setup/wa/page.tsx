import { getSetting } from '@vip/core/settings';
import { WaSetupClient } from './client';

export const dynamic = 'force-dynamic';

export default async function WaSetupPage() {
  const ready = getSetting('wa_ready') === true;
  return <WaSetupClient initialReady={ready} />;
}
