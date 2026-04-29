'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TargetPicker } from '@/ui/components/target-picker';
import { MarkdownEditor } from '@/ui/components/markdown-editor';
import type { TargetSpec } from '@/domain/request/expand-targets';
import { cn } from '@/lib/utils';
import { DURATION_PRESETS, formatMinutes } from '@/lib/format-duration';

type RequestType = 'task' | 'survey';

export default function NewRequestPage() {
  const params = useParams<{ code: string }>();
  const { code } = params;
  const router = useRouter();

  const [type, setType] = useState<RequestType>('task');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(5);
  const [targets, setTargets] = useState<TargetSpec[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function countTargets(): number {
    return targets.length;
  }

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
          type,
          dueAt: dueAt || undefined,
          estimatedMinutes,
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
    <div className="max-w-2xl mx-auto px-4 py-6 pb-28 space-y-6">
      <Link
        href={`/t/${code}/requests`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 一覧に戻る
      </Link>

      <h1 className="text-xl font-bold text-gray-900">新規依頼作成</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-5">
        {/* Type toggle */}
        <div className="space-y-2">
          <Label>依頼種別</Label>
          <div className="flex rounded-md border border-gray-200 overflow-hidden w-fit">
            <button
              type="button"
              onClick={() => setType('task')}
              className={cn(
                'px-4 py-2 text-sm font-medium transition-colors',
                type === 'task'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              タスク
            </button>
            <button
              type="button"
              onClick={() => setType('survey')}
              className={cn(
                'px-4 py-2 text-sm font-medium transition-colors border-l border-gray-200',
                type === 'survey'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              アンケート
            </button>
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="req-title">タイトル <span className="text-red-500">*</span></Label>
          <Input
            id="req-title"
            placeholder="依頼のタイトルを入力..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Body */}
        <div className="space-y-2">
          <Label>本文</Label>
          <MarkdownEditor value={body} onChange={setBody} />
        </div>

        {/* Due date */}
        <div className="space-y-2">
          <Label htmlFor="req-due">期限日</Label>
          <Input
            id="req-due"
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-48"
          />
        </div>

        {/* Estimated minutes */}
        <div className="space-y-2">
          <Label htmlFor="req-estimated">想定所要時間 <span className="text-red-500">*</span></Label>
          <div className="flex flex-wrap gap-2">
            {DURATION_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setEstimatedMinutes(m)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md border transition-colors',
                  estimatedMinutes === m
                    ? 'bg-blue-600 text-white border-blue-600'
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
      </div>

      {/* Target picker */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-medium text-gray-700">送信先 <span className="text-red-500">*</span></h2>
        <TargetPicker
          tenantCode={code}
          targets={targets}
          onChange={setTargets}
          showAllTab={false}
        />
      </div>

      {/* Sticky submit bar */}
      <div className="fixed bottom-0 left-0 right-0 md:left-52 bg-white border-t border-gray-200 px-4 py-3 flex items-center justify-between gap-4 z-40">
        <p className="text-sm text-gray-600">
          送信先: <span className="font-semibold text-gray-900">{countTargets()} 件</span>
        </p>
        <div className="flex items-center gap-3">
          {error && (
            <p className="text-sm text-red-600 max-w-xs truncate">{error}</p>
          )}
          <Button
            onClick={handleSubmit}
            disabled={loading || !title.trim() || targets.length === 0}
          >
            {loading ? '送信中...' : '依頼を送信'}
          </Button>
        </div>
      </div>
    </div>
  );
}
