'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function NewGroupPage() {
  const params = useParams<{ code: string }>();
  const { code } = params;
  const router = useRouter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!name.trim()) {
      setError('グループ名を入力してください。');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/t/${code}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      const data = await res.json() as { id: string };
      router.push(`/t/${code}/groups/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/groups`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 一覧に戻る
      </Link>
      <h1 className="text-xl font-bold text-gray-900">グループの新規作成</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="grp-name">名前 <span className="text-red-500">*</span></Label>
          <Input
            id="grp-name"
            placeholder="例: 担当者勉強会"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="grp-desc">説明（任意）</Label>
          <Textarea
            id="grp-desc"
            placeholder="どんなグループか短くメモしておくと、後で探しやすくなります。"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={loading || !name.trim()}>
            {loading ? '作成中...' : 'グループを作成'}
          </Button>
        </div>
      </div>
    </div>
  );
}
