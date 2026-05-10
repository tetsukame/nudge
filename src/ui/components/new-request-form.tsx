'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  FileText,
  Send,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TargetPicker } from '@/ui/components/target-picker';
import { MarkdownEditor } from '@/ui/components/markdown-editor';
import type { TargetSpec } from '@/domain/request/expand-targets';
import { cn } from '@/lib/utils';
import { DURATION_PRESETS, formatMinutes } from '@/lib/format-duration';

type OrgUnitOption = { id: string; name: string; isPrimary: boolean };

type Props = {
  tenantCode: string;
  initialGroupId?: string | null;
  /** 「コピーして作成」で渡されるプリフィル値。期限はコピー対象外。 */
  initialValues?: {
    title?: string;
    body?: string;
    estimatedMinutes?: number;
    senderOrgUnitId?: string | null;
    targets?: TargetSpec[];
  };
  /** コピー由来のときに UI 上で出すバナー文言。 */
  copySourceTitle?: string | null;
};

function formatDateLabel(value: string): string {
  if (!value) return '未設定';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
}

export function NewRequestForm({
  tenantCode, initialGroupId, initialValues, copySourceTitle,
}: Props) {
  const code = tenantCode;
  const router = useRouter();

  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [body, setBody] = useState(initialValues?.body ?? '');
  const [dueAt, setDueAt] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(
    initialValues?.estimatedMinutes ?? 5,
  );
  const [targets, setTargets] = useState<TargetSpec[]>(
    initialValues?.targets ??
      (initialGroupId ? [{ type: 'group', groupId: initialGroupId }] : []),
  );
  const [orgUnits, setOrgUnits] = useState<OrgUnitOption[]>([]);
  const [senderOrgUnitId, setSenderOrgUnitId] = useState<string | null>(
    initialValues?.senderOrgUnitId ?? null,
  );
  const [isPersonal, setIsPersonal] = useState(
    initialValues?.senderOrgUnitId === null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/t/${code}/api/me/org-units`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { orgUnits: OrgUnitOption[]; primaryOrgUnitId: string | null }) => {
        setOrgUnits(data.orgUnits);
        // Only seed primary when no copy source explicitly chose one.
        if (initialValues?.senderOrgUnitId === undefined) {
          setSenderOrgUnitId(data.primaryOrgUnitId);
        }
      })
      .catch(() => {
        // ignore — leave dropdown empty
      });
  }, [code, initialValues?.senderOrgUnitId]);

  const senderLabel = useMemo(() => {
    if (isPersonal) return '個人として（所属を表示しない）';
    if (orgUnits.length === 0) return '主所属を使用';
    const match = orgUnits.find((o) => o.id === senderOrgUnitId);
    return match?.name ?? orgUnits[0]?.name ?? '主所属を使用';
  }, [isPersonal, orgUnits, senderOrgUnitId]);

  const missingReasons: string[] = [];
  if (!title.trim()) missingReasons.push('タイトルを入力してください');
  if (targets.length === 0) missingReasons.push('送信先を 1 つ以上選択してください');
  const canSubmit = missingReasons.length === 0 && !loading;

  async function handleSubmit() {
    if (!title.trim()) {
      setError('タイトルを入力してください。');
      return;
    }
    if (targets.length === 0) {
      setError('送信先を1つ以上選択してください。');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/t/${code}/api/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          dueAt: dueAt || undefined,
          estimatedMinutes,
          senderOrgUnitId: isPersonal ? null : senderOrgUnitId,
          targets,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      router.push(`/t/${code}/requests`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-3 lg:gap-6 gap-4">
      {/* Form column */}
      <div className="lg:col-span-2 space-y-4">
        {copySourceTitle && (
          <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span>
              「{copySourceTitle}」をコピーして作成しています。期限は新しく指定してください。
            </span>
          </div>
        )}

        {/* Section: 依頼内容 */}
        <Card>
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              依頼内容
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="req-title">
                タイトル <span className="text-red-500">*</span>
              </Label>
              <Input
                id="req-title"
                placeholder="依頼のタイトルを入力..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>本文</Label>
              <MarkdownEditor value={body} onChange={setBody} />
            </div>
          </CardContent>
        </Card>

        {/* Section: 期限・想定時間 */}
        <Card>
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              期限・想定時間
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="req-due">期限日</Label>
              <Input
                id="req-due"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="req-estimated">
                想定所要時間 <span className="text-red-500">*</span>
              </Label>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setEstimatedMinutes(m)}
                    className={cn(
                      'px-3 py-1.5 text-sm rounded-md border transition-colors',
                      estimatedMinutes === m
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
                    )}
                  >
                    {formatMinutes(m)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Input
                  id="req-estimated"
                  type="number"
                  min={1}
                  step={1}
                  value={estimatedMinutes}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0) setEstimatedMinutes(Math.floor(n));
                  }}
                  className="w-24"
                />
                <span className="text-sm text-gray-600">
                  分（{formatMinutes(estimatedMinutes)}）
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section: 依頼元 */}
        {orgUnits.length > 0 && (
          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                依頼元
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 space-y-3">
              {isPersonal ? (
                <p className="text-sm text-gray-400 line-through">
                  {orgUnits.find((o) => o.id === senderOrgUnitId)?.name ??
                    orgUnits[0]?.name ??
                    '（所属なし）'}
                  <span className="text-xs ml-1">（あなたの所属）</span>
                </p>
              ) : orgUnits.length === 1 ? (
                <p className="text-sm text-gray-700">
                  {orgUnits[0].name}
                  <span className="text-xs text-gray-500 ml-1">（あなたの所属）</span>
                </p>
              ) : (
                <select
                  id="req-sender-org"
                  value={senderOrgUnitId ?? ''}
                  onChange={(e) => setSenderOrgUnitId(e.target.value || null)}
                  className="w-full max-w-sm px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {orgUnits.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.isPrimary ? '（主所属）' : ''}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={isPersonal}
                  onChange={(e) => setIsPersonal(e.target.checked)}
                  className="rounded border-gray-300"
                />
                個人として依頼（所属を表示しない）
              </label>
            </CardContent>
          </Card>
        )}

        {/* Section: 送信先 */}
        <Card>
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              送信先 <span className="text-red-500">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <TargetPicker
              tenantCode={code}
              targets={targets}
              onChange={setTargets}
              showAllTab={false}
              initialTab={initialGroupId ? 'group' : undefined}
            />
          </CardContent>
        </Card>
      </div>

      {/* Summary column */}
      <aside className="lg:col-span-1 lg:self-start lg:sticky lg:top-6">
        <div className="space-y-3">
          <Card className="border-primary/20">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                送信前の確認
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 space-y-3">
              <SummaryRow label="タイトル">
                {title.trim() ? (
                  <span className="text-foreground">{title.trim()}</span>
                ) : (
                  <span className="text-red-500">未入力</span>
                )}
              </SummaryRow>

              <SummaryRow label="送信先">
                {targets.length > 0 ? (
                  <span className="text-foreground">{targets.length} 件</span>
                ) : (
                  <span className="text-red-500">未選択</span>
                )}
              </SummaryRow>

              <SummaryRow label="期限">
                {dueAt ? (
                  <span className="text-foreground">{formatDateLabel(dueAt)}</span>
                ) : (
                  <span className="text-red-500">未設定</span>
                )}
              </SummaryRow>

              <SummaryRow label="想定時間">
                <span className="text-foreground">{formatMinutes(estimatedMinutes)}</span>
              </SummaryRow>

              <SummaryRow label="依頼元">
                <span className="text-foreground">{senderLabel}</span>
              </SummaryRow>

              <SummaryRow label="通知">
                <span className="text-muted-foreground text-xs">
                  対象者にテナント設定の経路（メール / Teams 等）で送信されます
                </span>
              </SummaryRow>

              {!canSubmit && !loading && missingReasons.length > 0 && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-0.5">
                  <p className="font-medium">送信するには次の項目が必要です</p>
                  <ul className="list-disc pl-4">
                    {missingReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="w-full mt-2"
              >
                <Send className="h-4 w-4 mr-1.5" />
                {loading ? '送信中...' : '依頼を送信'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </aside>
    </div>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <div className="text-right break-words min-w-0">{children}</div>
    </div>
  );
}
