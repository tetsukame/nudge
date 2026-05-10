'use client';

import type { AssignmentStatus } from '@/domain/types';
import { AccessBanner } from './access-banner';
import { AssigneeList } from './assignee-list';

type Props = {
  tenantCode: string;
  requestId: string;
  currentUserId: string;
  canSubstitute: boolean;
  summary: {
    unopened: number; opened: number; responded: number;
    notNeeded: number; forwarded: number; substituted: number;
    exempted: number; expired: number;
  };
  total: number;
  initialStatuses?: AssignmentStatus[];
};

export function RequesterSection({
  tenantCode, requestId, currentUserId, canSubstitute, summary, total,
  initialStatuses,
}: Props) {
  const done = summary.responded + summary.notNeeded + summary.forwarded
    + summary.substituted + summary.exempted + summary.expired;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section className="mt-6 space-y-3">
      <AccessBanner text="依頼者のみ閲覧可能" />

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">全体進捗</h2>
          <span className="text-sm text-gray-600">{done}/{total}（{pct}%）</span>
        </div>
        {/* 一覧の RequestCard と同じシングルカラー進捗バー */}
        <div
          className="h-2 rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div id="assignees" className="bg-white border border-gray-200 rounded-lg p-4 scroll-mt-6">
        <h2 className="text-sm font-semibold mb-3">👥 assignee 一覧</h2>
        <AssigneeList
          tenantCode={tenantCode}
          requestId={requestId}
          currentUserId={currentUserId}
          canSubstitute={canSubstitute}
          initialStatuses={initialStatuses}
        />
      </div>
    </section>
  );
}
