import { getDb } from '@/lib/db';
import { contacts } from '@vip/core/schema';
import { desc } from 'drizzle-orm';
import { enqueueImport } from '../setup/import/actions';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const db = getDb();
  const all = db.select().from(contacts).orderBy(desc(contacts.created_at)).all();

  async function resync() {
    'use server';
    await enqueueImport();
  }

  return (
    <section className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Contacts ({all.length})</h2>
        <form action={resync}>
          <button type="submit" className="rounded border border-neutral-300 px-3 py-1 text-sm">Re-sync from Sheet</button>
        </form>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-100">
          <tr>
            <th className="border px-2 py-1 text-left">First name</th>
            <th className="border px-2 py-1 text-left">Last name</th>
            <th className="border px-2 py-1 text-left">Phone</th>
            <th className="border px-2 py-1 text-left">Secondary phone</th>
            <th className="border px-2 py-1 text-left">Email</th>
            <th className="border px-2 py-1 text-left">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {all.map((c) => (
            <tr key={c.id}>
              <td className="border px-2 py-1">{c.first_name}</td>
              <td className="border px-2 py-1">{c.last_name ?? ''}</td>
              <td className="border px-2 py-1">{c.phone_e164}</td>
              <td className="border px-2 py-1">{c.secondary_phone_e164 ?? ''}</td>
              <td className="border px-2 py-1">{c.email ?? ''}</td>
              <td className="border px-2 py-1">{c.remarks ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
