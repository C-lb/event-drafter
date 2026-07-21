'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ResolveButton({
  replyId,
  action,
}: {
  replyId: number;
  action: (input: { reply_id: number; resolved: boolean }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [isPending, start] = useTransition();

  const run = () => {
    start(async () => {
      await action({ reply_id: replyId, resolved: true });
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={isPending}
      className="btn-ghost btn-sm flex-none"
      title="Mark this reply as resolved"
    >
      {isPending ? 'Resolving…' : 'Mark as resolved'}
    </button>
  );
}
