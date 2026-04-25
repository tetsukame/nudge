'use client';

import { AccessBanner } from './access-banner';
import { ProgressBar } from './progress-bar';
import { AssigneeList } from './assignee-list';

type Props = {
  tenantCode: string;
  requestId: string;
  currentUserId: string;
  canSubstitute: boolean;
  summary: {
    unopened: number; opened: number; responded: number;
    unavailable: number; forwarded: number; substituted: number;
    exempted: number; expired: number;
  };
  total: number;
};

export function RequesterSection({
  tenantCode, requestId, currentUserId, canSubstitute, summary, total,
}: Props) {
  const done = summary.responded + summary.unavailable + summary.forwarded
    + summary.substituted + summary.exempted + summary.expired;
  const other = summary.forwarded + summary.substituted + summary.exempted + summary.expired;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section className="mt-6 space-y-3">
      <AccessBanner text="依頼者のみ閲覧可能" />

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">全体進捗</h2>
          <span className="text-sm text-gray-600">{done}/{total}（{pct}%）</span>
        </div>
        <ProgressBar
          counts={{
            unopened: summary.unopened,
            opened: summary.opened,
            responded: summary.responded,
            unavailable: summary.unavailable,
            other,
          }}
          total={total}
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-3">👥 assignee 一覧</h2>
        <AssigneeList
          tenantCode={tenantCode}
          requestId={requestId}
          currentUserId={currentUserId}
          canSubstitute={canSubstitute}
        />
      </div>
    </section>
  );
}
