'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/ui/components/confirm-dialog';
import { useAsyncAction } from '@/ui/hooks/use-async-action';
import { apiSend } from '@/lib/api-fetch';

type Initial = {
  enabled: boolean;
  hardDeleteEnabled: boolean;
  notificationDays: number;
  auditLogDays: number;
  historyDays: number;
  syncLogDays: number;
  softDeleteGraceDays: number;
  isUsingPlatformDefault: boolean;
};

type Props = {
  tenantCode: string;
  initial: Initial;
};

/**
 * NDG-90: tenant_admin が自テナントの retention 設定を編集する。
 *
 * - 既定では enabled=false。tenant_admin が明示的に有効化するまで動かない
 * - hard_delete_enabled は別フラグ (デフォルト false)。有効化時に
 *   ConfirmDialog で警告を出してから確定
 * - 各 *_days は数値入力。空欄なら platform default fallback (バックエンド側)
 * - 初回有効化時に platform default の表示を提示
 */
export function RetentionConfigForm({ tenantCode, initial }: Props) {
  const router = useRouter();

  const [enabled, setEnabled] = useState(initial.enabled);
  const [hardDeleteEnabled, setHardDeleteEnabled] = useState(initial.hardDeleteEnabled);
  const [notificationDays, setNotificationDays] = useState<string>(String(initial.notificationDays));
  const [auditLogDays, setAuditLogDays] = useState<string>(String(initial.auditLogDays));
  const [historyDays, setHistoryDays] = useState<string>(String(initial.historyDays));
  const [syncLogDays, setSyncLogDays] = useState<string>(String(initial.syncLogDays));
  const [softDeleteGraceDays, setSoftDeleteGraceDays] = useState<string>(
    String(initial.softDeleteGraceDays),
  );

  const [hardDeleteDialogOpen, setHardDeleteDialogOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  function parseDaysOrNull(s: string): number | null {
    const t = s.trim();
    if (t === '') return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return Math.floor(n);
  }

  const save = useAsyncAction(async () => {
    setSaved(false);
    await apiSend(`/t/${tenantCode}/api/admin/settings/retention`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled,
        hardDeleteEnabled,
        notificationDays: parseDaysOrNull(notificationDays),
        auditLogDays: parseDaysOrNull(auditLogDays),
        historyDays: parseDaysOrNull(historyDays),
        syncLogDays: parseDaysOrNull(syncLogDays),
        softDeleteGraceDays: parseDaysOrNull(softDeleteGraceDays) ?? undefined,
      }),
    });
    setSaved(true);
    router.refresh();
  });

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-5">
        {initial.isUsingPlatformDefault && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-900">
            このテナントには保存済みの設定がありません。下記の値は
            <strong>プラットフォーム既定値</strong>で、保存するまで適用されません。
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={save.busy}
          />
          <span className="font-medium">このテナントでデータ保持を有効化する</span>
        </label>

        <div className="space-y-1">
          <Label className="text-sm">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={hardDeleteEnabled}
                onChange={(e) => {
                  if (e.target.checked) {
                    // 警告ダイアログを出してから確定
                    setHardDeleteDialogOpen(true);
                  } else {
                    setHardDeleteEnabled(false);
                  }
                }}
                disabled={save.busy}
              />
              物理削除（ハード削除）も有効化する
            </span>
          </Label>
          <p className="text-xs text-gray-500 ml-6">
            既定では論理削除のみ（archived_at をセット）。物理削除を有効にすると、
            猶予期間 ({initial.softDeleteGraceDays} 日) 経過後にデータベースから完全に削除されます。
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
          <div className="space-y-1">
            <Label htmlFor="ret-notif">通知履歴 (日数)</Label>
            <Input
              id="ret-notif"
              type="number"
              min="1"
              value={notificationDays}
              onChange={(e) => setNotificationDays(e.target.value)}
              disabled={save.busy}
            />
            <p className="text-xs text-gray-500">プラットフォーム既定: 90 日</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ret-audit">監査ログ (日数)</Label>
            <Input
              id="ret-audit"
              type="number"
              min="1"
              value={auditLogDays}
              onChange={(e) => setAuditLogDays(e.target.value)}
              disabled={save.busy}
            />
            <p className="text-xs text-gray-500">プラットフォーム既定: 730 日 (2 年)</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ret-history">対応経過履歴 (日数)</Label>
            <Input
              id="ret-history"
              type="number"
              min="1"
              value={historyDays}
              onChange={(e) => setHistoryDays(e.target.value)}
              disabled={save.busy}
            />
            <p className="text-xs text-gray-500">
              既定: 365 日。完了・取消済みの依頼のみ対象
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ret-sync">同期ログ (日数)</Label>
            <Input
              id="ret-sync"
              type="number"
              min="1"
              value={syncLogDays}
              onChange={(e) => setSyncLogDays(e.target.value)}
              disabled={save.busy}
            />
            <p className="text-xs text-gray-500">プラットフォーム既定: 90 日</p>
          </div>
        </div>

        <div className="space-y-1 pt-2 border-t border-gray-100">
          <Label htmlFor="ret-grace">論理 → 物理 削除の猶予期間 (日数)</Label>
          <Input
            id="ret-grace"
            type="number"
            min="1"
            value={softDeleteGraceDays}
            onChange={(e) => setSoftDeleteGraceDays(e.target.value)}
            className="max-w-xs"
            disabled={save.busy}
          />
          <p className="text-xs text-gray-500">
            既定: 7 日。論理削除（archived_at セット）から物理削除までの猶予。
            この期間内なら設定変更で復旧可能
          </p>
        </div>

        {save.error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {save.error}
          </p>
        )}
        {saved && (
          <p className="text-sm text-emerald-700">保存しました。</p>
        )}

        <Button onClick={() => void save.run()} disabled={save.busy}>
          {save.busy ? '保存中...' : '保存'}
        </Button>
      </div>

      <ConfirmDialog
        open={hardDeleteDialogOpen}
        onOpenChange={setHardDeleteDialogOpen}
        title="物理削除を有効化する"
        description={
          <>
            物理削除を有効にすると、論理削除から猶予期間 (
            {initial.softDeleteGraceDays} 日) 経過後に
            <strong>データベースから完全に削除</strong>されます。<br />
            <br />
            <span className="text-xs text-gray-500">
              ※ 物理削除後はデータベースバックアップからのみ復旧可能となります。
              組織の規程と運用体制を整えた上で有効化してください。
            </span>
          </>
        }
        confirmLabel="物理削除を有効化"
        cancelLabel="やめておく"
        danger
        onConfirm={() => {
          setHardDeleteEnabled(true);
          setHardDeleteDialogOpen(false);
        }}
      />
    </>
  );
}
