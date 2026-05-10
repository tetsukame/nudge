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
  const [commentSending, setCommentSending] = useState(false);
  const [commentError, setCommentError] = useState('');

  const [remindOpen, setRemindOpen] = useState(false);
  const [remindSending, setRemindSending] = useState(false);
  const [remindError, setRemindError] = useState('');
  const [remindResult, setRemindResult] = useState<string | null>(null);

  const detailBase = `/t/${tenantCode}/requests/${requestId}?from=${fromQuery}`;

  async function postBroadcast() {
    if (!commentBody.trim()) return;
    setCommentSending(true);
    setCommentError('');
    try {
      const res = await fetch(
        `/t/${tenantCode}/api/requests/${requestId}/comments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: commentBody, assignmentId: null }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `エラー (${res.status})`,
        );
      }
      setCommentBody('');
      setCommentOpen(false);
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setCommentSending(false);
    }
  }

  async function sendRemind() {
    setRemindSending(true);
    setRemindError('');
    setRemindResult(null);
    try {
      const res = await fetch(
        `/t/${tenantCode}/api/requests/${requestId}/remind`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) {
          throw new Error(
            '前回のリマインドから 1 時間以上空けてから再送してください',
          );
        }
        throw new Error(
          (data as { error?: string }).error ?? `エラー (${res.status})`,
        );
      }
      const recipients = (data as { recipients?: number }).recipients ?? 0;
      setRemindResult(`${recipients} 名にリマインドを送りました`);
    } catch (err) {
      setRemindError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setRemindSending(false);
    }
  }

  return (
    <>
      <ActionLink
        href={`/t/${tenantCode}/requests/new?copyFrom=${requestId}`}
        icon={<Copy className="h-3.5 w-3.5" />}
        label="コピーして作成"
      />
      <ActionButton
        onClick={() => setCommentOpen(true)}
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        label="全員にコメント"
      />
      {pendingCount > 0 && (
        <ActionButton
          onClick={() => {
            setRemindOpen(true);
            setRemindResult(null);
            setRemindError('');
          }}
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
      <Dialog open={commentOpen} onOpenChange={setCommentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>全員にコメント</DialogTitle>
            <DialogDescription>
              依頼を受け取った全員に表示されるコメントを送信します。
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="例: 期限が近づいています。お忙しいところ恐縮ですがご対応をお願いします。"
            rows={4}
            className="w-full border border-gray-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {commentError && (
            <p className="text-xs text-red-600">{commentError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCommentOpen(false)}
              disabled={commentSending}
            >
              キャンセル
            </Button>
            <Button
              onClick={() => void postBroadcast()}
              disabled={commentSending || !commentBody.trim()}
            >
              {commentSending ? '送信中...' : '送信'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remind confirmation dialog */}
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
          {remindResult && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              {remindResult}
            </p>
          )}
          {remindError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {remindError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemindOpen(false)}
              disabled={remindSending}
            >
              {remindResult ? '閉じる' : 'キャンセル'}
            </Button>
            {!remindResult && (
              <Button
                onClick={() => void sendRemind()}
                disabled={remindSending}
              >
                {remindSending ? '送信中...' : '送信'}
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
