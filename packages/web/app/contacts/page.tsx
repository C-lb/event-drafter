import { listContactsAll } from './actions';
import { enqueueImport, importStatus } from '../setup/import/actions';
import { ContactsTable } from './ContactsTable';
import { ResyncButton, type ResyncJobView } from './ResyncButton';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const all = await listContactsAll();
  const { job } = await importStatus();

  async function resync() {
    'use server';
    await enqueueImport();
  }

  const jobView: ResyncJobView = job
    ? {
        status: job.status,
        finishedAtMs: job.finished_at ? new Date(job.finished_at).getTime() : null,
      }
    : null;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Contacts ({all.length})</h2>
        <ResyncButton action={resync} job={jobView} />
      </div>
      <p className="text-sm text-ink-2">
        Hand-edits override the Sheet locally. A re-sync will pull fresh values for any row whose Sheet content has changed since.
      </p>
      <ContactsTable rows={all.map((c) => ({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        phone_e164: c.phone_e164,
        secondary_phone_e164: c.secondary_phone_e164,
        email: c.email,
        remarks: c.remarks,
      }))} />
    </section>
  );
}
