import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type StatusVariant = 'pending' | 'done' | 'overdue' | 'opened' | 'unopened';

const STATUS_VARIANT_TO_BADGE: Record<
  StatusVariant,
  React.ComponentProps<typeof Badge>['variant']
> = {
  pending: 'warning',
  done: 'success',
  overdue: 'destructive',
  opened: 'muted',
  unopened: 'info',
};

export type RequestCardProps = {
  /** クリック時の遷移先 (依頼詳細ページ等) */
  href: string;
  /** 依頼タイトル */
  title: string;
  /** 副題 (例: "送信者: 山田太郎"、"配下: 5 名対応中") */
  subtitle?: string;
  /** 期限の表示文字列 (例: "期限: 2026/05/15") */
  dueLabel?: string;
  /** 期限切れフラグ。true で dueLabel を赤強調 */
  dueOverdue?: boolean;
  /** 状態バッジに表示する文字列 (icon 込み可: "📩 未開封" 等) */
  statusLabel?: string;
  /** 状態バッジのバリアント */
  statusVariant?: StatusVariant;
  /** 追加のメタ情報 (key-value)。中点で連結表示 */
  meta?: Array<{
    label: string;
    value: string | number;
  }>;
  /** 進捗バー (送信済み・部下・管理者向けの集計) */
  progress?: {
    done: number;
    total: number;
    overdue?: number;
  };
  /** 未読インジケータ (青丸) */
  unread?: boolean;
  /** 右上に表示するアクションラベル (例: "対応する"、"開く") */
  actionLabel?: string;
};

/**
 * 業務カード共通コンポーネント。自分宛 / 送信済み / 部下 / admin sent の
 * 一覧で繰り返し書かれていたカード DOM を一本化する。
 *
 * カード全体がクリッカブル (`href` に遷移)。actionLabel はカード内の
 * 視覚的 CTA であり、独立したクリックハンドラは持たない。
 */
export function RequestCard({
  href,
  title,
  subtitle,
  dueLabel,
  dueOverdue = false,
  statusLabel,
  statusVariant,
  meta,
  progress,
  unread = false,
  actionLabel,
}: RequestCardProps) {
  const badgeVariant =
    statusVariant && STATUS_VARIANT_TO_BADGE[statusVariant];
  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <Link
      href={href}
      className="block rounded-lg border border-border bg-card text-card-foreground p-4 hover:border-primary/30 hover:shadow-sm transition-all no-underline"
    >
      {/* Top row: status badge + title + (overdue indicator + done/total) + action */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {statusLabel && badgeVariant && (
            <Badge variant={badgeVariant} className="shrink-0 mt-0.5">
              {statusLabel}
            </Badge>
          )}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {unread && (
              <span
                className="inline-block h-2 w-2 rounded-full bg-primary shrink-0"
                title="未読あり"
                aria-label="未読あり"
              />
            )}
            <p className="text-sm font-medium text-foreground truncate">
              {title}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {progress && progress.overdue && progress.overdue > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              ⚠️ 期限切れ {progress.overdue}
            </Badge>
          )}
          {progress && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {progress.done}/{progress.total}
            </span>
          )}
          {actionLabel && (
            <span className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary font-medium">
              {actionLabel}
            </span>
          )}
        </div>
      </div>

      {/* Subtitle / meta line */}
      {(subtitle || dueLabel || (meta && meta.length > 0)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
          {subtitle && <span>{subtitle}</span>}
          {dueLabel && (
            <span
              className={cn(
                dueOverdue && 'text-destructive font-medium',
              )}
            >
              {dueLabel}
              {dueOverdue && ' ⚠️'}
            </span>
          )}
          {meta?.map((m, i) => (
            <span key={i}>
              {m.label}：<span className="text-foreground">{m.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Progress bar (single-color、詳細画面と同じスタイル) */}
      {progress && progress.total > 0 && (
        <div className="mt-2.5 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>進捗</span>
            <span className="tabular-nums">{progressPct}%</span>
          </div>
          <div
            className="h-2 rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  );
}
