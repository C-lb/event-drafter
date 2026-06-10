import { listContactsAll } from './actions';
import { enqueueImport } from '../setup/import/actions';
import { ContactsTable } from './ContactsTable';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const all = await listContactsAll();

  async function resync() {
    'use server';
    await enqueueImport();
  }

  return (
    <section className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Contacts ({all.length})</h2>
        <form action={resync}>
          <button type="submit" className="rounded border border-neutral-300 px-3 py-1 text-sm">Re-sync from Sheet</button>
        </form>
      </div>
      <p className="text-xs text-neutral-600">
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
