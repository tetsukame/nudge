'use client';

import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * NDG-92 (A2 E6): 共通 ConfirmDialog プリミティブ。
 *
 * 5 箇所で `Dialog → DialogContent → DialogHeader (title/description) →
 * (任意 children) → エラー表示 → DialogFooter (キャンセル + 確定)` の同じ
 * 構造を書いていたのを集約する。
 *
 * - `danger=true` で確定ボタンを destructive (赤系) に
 * - children を渡すと description と footer の間に追加コンテンツを置ける
 *   (例: UserSearch などのフォーム要素)
 * - 確定ボタンの活性は busy + (任意 disabled) を AND
 */
type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string;
  danger?: boolean;
  /** 確定ボタンを追加で disable したい場合 (busy とは別の条件) */
  disabled?: boolean;
  onConfirm: () => void;
  /** description と footer の間に挟む任意のコンテンツ (フォーム等) */
  children?: ReactNode;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busyLabel,
  cancelLabel = 'キャンセル',
  busy = false,
  error,
  danger = false,
  disabled = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        {children}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={busy || disabled}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
