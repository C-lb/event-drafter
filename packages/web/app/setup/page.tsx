import Link from 'next/link';
import { getSetupStatus } from './actions';

export const dynamic = 'force-dynamic';

export default async function SetupHome() {
  const s = await getSetupStatus();
  const steps: { href: string; label: string; done: boolean }[] = [
    { href: '/setup/llm', label: 'Local LLM (Ollama)', done: s.llm },
    { href: '/setup/google', label: 'Connect Google', done: s.google },
    { href: '/setup/sheet', label: 'Pick contacts Sheet', done: s.sheet },
    { href: '/setup/import', label: 'Import contacts', done: s.completed },
  ];
  return (
    <section className="max-w-xl space-y-4">
      <h2 className="text-xl font-semibold">Setup</h2>
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li key={step.href} className="flex items-center gap-3 rounded border border-neutral-200 bg-white p-3">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${step.done ? 'bg-green-600 text-white' : 'bg-neutral-200 text-neutral-700'}`}>
              {step.done ? '✓' : i + 1}
            </span>
            <Link href={step.href} className="flex-1 hover:underline">{step.label}</Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
