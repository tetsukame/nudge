'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
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
  /** 現在のタイトル/本文を渡しておくと、空でない場合に採用時警告を出す */
  currentTitle: string;
  currentBody: string;
  /** 採用ボタンで呼ばれる。既存値の上書き判断は呼び出し側がする */
  onAdopt: (result: { title: string; body: string }) => void;
};

type Result = { title: string; body: string };

export function AIFormatModal({ tenantCode, currentTitle, currentBody, onAdopt }: Props) {
  const [open, setOpen] = useState(false);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  function reset() {
    setMemo('');
    setBusy(false);
    setError('');
    setResult(null);
  }

  function close() {
    setOpen(false);
    setTimeout(reset, 200);
  }

  async function generate() {
    if (!memo.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/requests/format`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setResult(data as Result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setBusy(false);
    }
  }

  function adopt() {
    if (!result) return;
    const willOverwrite = !!currentTitle.trim() || !!currentBody.trim();
    if (willOverwrite) {
      const ok = window.confirm(
        '入力済みのタイトル / 本文を AI 提案で上書きしますか？',
      );
      if (!ok) return;
    }
    onAdopt(result);
    close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5" />
        AI で整形
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI で整形
            </DialogTitle>
            <DialogDescription>
              要件メモを入力すると、AI がタイトル + 本文を整えて提案します。
              <br />
              <span className="text-xs text-amber-700">
                ※ メモは設定された AI プロバイダに送信されます。
              </span>
            </DialogDescription>
          </DialogHeader>

          {!result && (
            <div className="space-y-2">
              <label className="text-xs text-gray-600" htmlFor="ai-memo">
                要件メモ
              </label>
              <textarea
                id="ai-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="例: 来週月曜までに月次の勤怠アンケートに回答してもらう"
                rows={6}
                className="w-full border border-gray-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={busy}
              />
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-xs text-gray-500">提案タイトル</div>
                <div className="text-sm font-medium text-gray-900 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
                  {result.title}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-gray-500">提案本文</div>
                <pre className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 whitespace-pre-wrap font-sans max-h-64 overflow-auto">
                  {result.body}
                </pre>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter className="flex gap-2 sm:gap-2">
            {!result && (
              <>
                <Button variant="outline" onClick={close} disabled={busy}>
                  キャンセル
                </Button>
                <Button onClick={() => void generate()} disabled={busy || !memo.trim()}>
                  {busy ? '生成中...' : '提案を生成'}
                </Button>
              </>
            )}
            {result && (
              <>
                <Button variant="outline" onClick={() => setResult(null)} disabled={busy}>
                  破棄
                </Button>
                <Button variant="outline" onClick={() => void generate()} disabled={busy}>
                  {busy ? '生成中...' : '再生成'}
                </Button>
                <Button onClick={adopt} disabled={busy}>
                  採用
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
