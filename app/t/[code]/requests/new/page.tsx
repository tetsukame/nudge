'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
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

function formatDateLabel(value: string): string {
  if (!value) return '未設定';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
}

export default function NewRequestPage() {
  const params = useParams<{ code: string }>();
  const { code } = params;
  const router = useRouter();
  const searchParams = useSearchParams();

  // NDG-37: グループ画面から ?group=<id> で飛んできた場合は、その group を
  // 初期 target として preselect し、TargetPicker を group タブで開く。
  const initialGroupId = searchParams?.get('group') ?? null;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(5);
  const [targets, setTargets] = useState<TargetSpec[]>(
    initialGroupId ? [{ type: 'group', groupId: initialGroupId }] : [],
  );
  const [orgUnits, setOrgUnits] = useState<OrgUnitOption[]>([]);
  const [senderOrgUnitId, setSenderOrgUnitId] = useState<string | null>(null);
  const [isPersonal, setIsPersonal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/t/${code}/api/me/org-units`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { orgUnits: OrgUnitOption[]; primaryOrgUnitId: string | null }) => {
        setOrgUnits(data.orgUnits);
        setSenderOrgUnitId(data.primaryOrgUnitId);
      })
      .catch(() => {
        // Fallback: leave dropdown empty; the request will be sent as personal.
      });
  }, [code]);

  const senderLabel = useMemo(() => {
    if (isPersonal) return '個人として（所属を表示しない）';
    if (orgUnits.length === 0) return '主所属を使用';
    const match = orgUnits.find((o) => o.id === senderOrgUnitId);
    return match?.name ?? orgUnits[0]?.name ?? '主所属を使用';
  }, [isPersonal, orgUnits, senderOrgUnitId]);

  const canSubmit = title.trim().length > 0 && targets.length > 0 && !loading;

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
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/requests`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 一覧に戻る
      </Link>

      <h1 className="text-xl font-bold text-gray-900">新規依頼作成</h1>

      <div className="grid lg:grid-cols-3 lg:gap-6 gap-4">
        {/* Form column */}
        <div className="lg:col-span-2 space-y-4">
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
                  // NDG-35: 個人として依頼を選択したときは取消線で隠す
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
        <aside className="lg:col-span-1">
          <div className="lg:sticky lg:top-6 space-y-3">
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
                  <span className={dueAt ? 'text-foreground' : 'text-muted-foreground'}>
                    {formatDateLabel(dueAt)}
                  </span>
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
