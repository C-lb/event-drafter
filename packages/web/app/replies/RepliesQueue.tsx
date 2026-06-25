'use client';

import { QueueProvider } from './QueueProvider';
import { ReplyCard, type ReplyRow } from './ReplyCard';

export function RepliesQueue({ replies, active }: { replies: ReplyRow[]; active: boolean }) {
  const orderedIds = replies.map((r) => r.reply_id);
  return (
    <QueueProvider orderedIds={orderedIds} active={active}>
      <ul className="space-y-3">
        {replies.map((r) => (
          <ReplyCard key={r.reply_id} r={r} />
        ))}
      </ul>
    </QueueProvider>
  );
}
