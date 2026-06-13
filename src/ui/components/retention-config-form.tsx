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

  /**
   * NDG-94: 「空欄」または「1 以上の整数」を有効とする。0 / 負値 / 小数 /
   * 非数値はクライアント側で弾いてバックエンドのバリデーション文言を
   * 画面に出さない。
   */
  function isValidDaysInput(s: string): boolean {
    const t = s.trim();
    if (t === '') return true; // 空欄 = platform default
    if (!/^[0-9]+$/.test(t)) return false;
    return Number(t) >= 1;
  }

  // 各フィールドの妥当性
  const invalidFields: string[] = [];
  if (!isValidDaysInput(notificationDays)) invalidFields.push('通知履歴');
  if (!isValidDaysInput(auditLogDays)) invalidFields.push('監査ログ');
  if (!isValidDaysInput(historyDays)) invalidFields.push('対応経過履歴');
  if (!isValidDaysInput(syncLogDays)) invalidFields.push('同期ログ');
  // grace は必須 (空欄なら既定 7 を送る形で OK だが、0 / 負値 / 非数は不可)
  const graceTrim = softDeleteGraceDays.trim();
  const graceValid = graceTrim === '' || (/^[0-9]+$/.test(graceTrim) && Number(graceTrim) >= 1);
  if (!graceValid) invalidFields.push('猶予期間');
  const hasInvalid = invalidFields.length > 0;

  const save = useAsyncAction(async () => {
    setSaved(false);
    // NDG-94: クライアント側で先に弾く (バックエンドは保険として残す)
    if (hasInvalid) {
      throw new Error(
        `次の項目は「空欄（既定値）」または「1 以上の整数」を入力してください: ${invalidFields.join('、')}`,
      );
    }
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
      <details className="bg-white border border-gray-200 rounded-lg group">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 rounded-lg list-none flex items-center justify-between">
          <span>ℹ 各設定の意味と削除タイミングを見る</span>
          <span className="text-gray-400 text-xs group-open:rotate-180 transition-transform">▾</span>
        </summary>
        <div className="px-5 pb-5 pt-2 space-y-5 text-sm text-gray-700 border-t border-gray-100">
          <section className="space-y-2">
            <h3 className="font-medium text-gray-900">対象となる記録</h3>
            <dl className="space-y-2">
              <div>
                <dt className="font-medium text-gray-800">通知履歴 (notification)</dt>
                <dd className="text-gray-600 ml-4 text-xs">
                  「期限○日前」のメール送信記録、配信失敗の記録など。
                  <code className="bg-gray-100 px-1 py-0.5 rounded">status</code> が
                  <code className="bg-gray-100 px-1 py-0.5 rounded">sent</code> /
                  <code className="bg-gray-100 px-1 py-0.5 rounded">failed</code> /
                  <code className="bg-gray-100 px-1 py-0.5 rounded">skipped</code> のものだけが整理対象。
                  処理中（pending / sending）は除外
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-800">監査ログ (audit_log)</dt>
                <dd className="text-gray-600 ml-4 text-xs">
                  誰がいつ何の操作をしたかの記録（依頼作成・取消・代理完了など）。
                  業務本体ではなく操作の証跡。設定変更も別途記録
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-800">対応経過履歴 (assignment_status_history)</dt>
                <dd className="text-gray-600 ml-4 text-xs">
                  依頼に対する「未開封 → 開封 → 対応済」等の遷移記録。
                  <strong>完了・取消済みの依頼に紐づくものだけ</strong>を整理対象とする
                  （対応中の依頼の根拠は差し戻し用に保持）
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-800">同期ログ (sync_log)</dt>
                <dd className="text-gray-600 ml-4 text-xs">
                  Keycloak からの職員情報同期の実行記録。
                  エラー履歴の追跡に短期保持
                </dd>
              </div>
            </dl>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-gray-900">削除タイミングのタイムライン</h3>
            <pre className="bg-gray-50 border border-gray-200 rounded-md p-3 text-xs font-mono leading-relaxed overflow-x-auto">{`記録が作成される
   │
   │   ◀── 保持期間 (例: 通知履歴 90 日) ──▶
   │
   ▼
保持期間が経過
   │
   ▼
[第 1 段階] 論理削除 (自動)
   │   画面上の一覧から非表示になる。データベース内には残る
   │   この時点で職員の通常業務に影響なし
   │
   │   ◀── 猶予期間 (既定 7 日) ──▶
   │
   ▼
[第 2 段階] 物理削除 (既定では無効)
   ※ 「物理削除も有効化する」をチェックした場合のみ実行
   データベースから完全に削除され、バックアップからのみ復旧可能`}</pre>
            <p className="text-xs text-gray-600">
              <strong>猶予期間内（既定 7 日）</strong>に保持期間を伸ばせば、
              論理削除された記録を再表示できます。
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-gray-900">空欄の意味</h3>
            <p className="text-xs text-gray-600">
              各日数フィールドを<strong>空欄にする</strong>と、
              プラットフォーム既定値が適用されます。組織独自の保持期間を設定するときだけ
              数値を入力してください。
            </p>
          </section>
        </div>
      </details>

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
            <p className="text-xs text-gray-500">
              空欄にすると既定値（90 日）に従います
            </p>
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
            <p className="text-xs text-gray-500">
              空欄にすると既定値（730 日 = 2 年）に従います
            </p>
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
              空欄にすると既定値（365 日）に従います。完了・取消済みの依頼のみ対象
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
            <p className="text-xs text-gray-500">
              空欄にすると既定値（90 日）に従います
            </p>
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
            空欄にすると既定値（7 日）に従います。論理削除（archived_at セット）から
            物理削除までの猶予で、この期間内なら設定変更で復旧可能
          </p>
        </div>

        {hasInvalid && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            次の項目は「空欄（既定値）」または「1 以上の整数」を入力してください: {invalidFields.join('、')}
          </p>
        )}

        {save.error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {save.error}
          </p>
        )}
        {saved && (
          <p className="text-sm text-emerald-700">保存しました。</p>
        )}

        <Button onClick={() => void save.run()} disabled={save.busy || hasInvalid}>
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
