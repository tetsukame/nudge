'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Copy,
  Eye,
  MessageSquare,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/ui/components/confirm-dialog';
import { useAsyncAction } from '@/ui/hooks/use-async-action';
import { apiFetch, apiSend } from '@/lib/api-fetch';

type Props = {
  tenantCode: string;
  requestId: string;
  fromQuery: 'sent' | 'admin/sent';
  pendingCount: number;
  overdueCount: number;
};

/**
 * 送信した依頼一覧カード右下の追加アクション群:
 *  - 全員にコメント (broadcast)
 *  - リマインド (manual re_notify)
 *  - 未対応者を見る (詳細ページに ?status=unopened,opened で deep-link)
 *  - 期限切れを確認 (詳細ページに ?overdue=1 で deep-link)
 *
 * 完了済み (pendingCount === 0 && overdueCount === 0) の依頼ではこの
 * コンポーネント自体をレンダーしないこと前提。
 */
export function SentRequestCardActions({
  tenantCode, requestId, fromQuery, pendingCount, overdueCount,
}: Props) {
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [remindOpen, setRemindOpen] = useState(false);

  const detailBase = `/t/${tenantCode}/requests/${requestId}?from=${fromQuery}`;

  const broadcast = useAsyncAction(async () => {
    if (!commentBody.trim()) return;
    await apiSend(`/t/${tenantCode}/api/requests/${requestId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: commentBody, assignmentId: null }),
    });
    setCommentBody('');
    setCommentOpen(false);
  });

  const remind = useAsyncAction(async () => {
    try {
      const data = await apiFetch<{ recipients?: number }>(
        `/t/${tenantCode}/api/requests/${requestId}/remind`,
        { method: 'POST' },
      );
      return `${data.recipients ?? 0} 名にリマインドを送りました`;
    } catch (err) {
      // 429 を分かりやすい日本語に置換
      if (err instanceof Error && /\(429\)/.test(err.message)) {
        throw new Error('前回のリマインドから 1 時間以上空けてから再送してください');
      }
      throw err;
    }
  });

  return (
    <>
      <ActionLink
        href={`/t/${tenantCode}/requests/new?copyFrom=${requestId}`}
        icon={<Copy className="h-3.5 w-3.5" />}
        label="コピーして作成"
      />
      <ActionButton
        onClick={() => { setCommentOpen(true); broadcast.reset(); }}
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        label="全員にコメント"
      />
      {pendingCount > 0 && (
        <ActionButton
          onClick={() => { setRemindOpen(true); remind.reset(); }}
          icon={<Bell className="h-3.5 w-3.5" />}
          label="リマインド"
        />
      )}
      {overdueCount > 0 ? (
        <ActionLink
          href={`${detailBase}&overdue=1`}
          icon={<TriangleAlert className="h-3.5 w-3.5" />}
          label="期限切れを確認"
          tone="destructive"
        />
      ) : (
        pendingCount > 0 && (
          <ActionLink
            href={`${detailBase}&status=unopened,opened`}
            icon={<Eye className="h-3.5 w-3.5" />}
            label="未対応者を見る"
          />
        )
      )}

      {/* Broadcast comment dialog */}
      <ConfirmDialog
        open={commentOpen}
        onOpenChange={setCommentOpen}
        title="全員にコメント"
        description="依頼を受け取った全員に表示されるコメントを送信します。"
        confirmLabel="送信"
        busyLabel="送信中..."
        busy={broadcast.busy}
        error={broadcast.error}
        disabled={!commentBody.trim()}
        onConfirm={() => void broadcast.run()}
      >
        <textarea
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          placeholder="例: 期限が近づいています。お忙しいところ恐縮ですがご対応をお願いします。"
          rows={4}
          className="w-full border border-gray-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </ConfirmDialog>

      {/* Remind dialog: 成功後は結果メッセージを表示して「閉じる」のみ。
          ConfirmDialog の二段階遷移は守備範囲外なので生 Dialog を残す。 */}
      <Dialog open={remindOpen} onOpenChange={setRemindOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>リマインドを送信</DialogTitle>
            <DialogDescription>
              未対応の {pendingCount} 名に再通知を送ります。
              {overdueCount > 0 && `（うち期限超過 ${overdueCount} 名）`}
              <br />
              <span className="text-xs">
                同じ依頼へのリマインドは 1 時間に 1 回までです。
              </span>
            </DialogDescription>
          </DialogHeader>
          {remind.result && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              {remind.result}
            </p>
          )}
          {remind.error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {remind.error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemindOpen(false)}
              disabled={remind.busy}
            >
              {remind.result ? '閉じる' : 'キャンセル'}
            </Button>
            {!remind.result && (
              <Button onClick={() => void remind.run()} disabled={remind.busy}>
                {remind.busy ? '送信中...' : '送信'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActionButton({
  onClick, icon, label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border bg-white text-foreground hover:border-primary/40 hover:bg-emerald-50/40 transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}

function ActionLink({
  href, icon, label, tone = 'default',
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  tone?: 'default' | 'destructive';
}) {
  return (
    <Link
      href={href}
      className={
        tone === 'destructive'
          ? 'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 transition-colors no-underline'
          : 'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border bg-white text-foreground hover:border-primary/40 hover:bg-emerald-50/40 transition-colors no-underline'
      }
    >
      {icon}
      {label}
    </Link>
  );
}
