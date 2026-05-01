'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

type Props = {
  tenantCode: string;
  groupId: string;
  groupName: string;
  groupDescription: string;
};

export function GroupDetailActions({ tenantCode, groupId, groupName, groupDescription }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(groupName);
  const [description, setDescription] = useState(groupDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) {
      setError('名前を入力してください。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラー');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`グループ「${groupName}」を削除しますか？ メンバー紐付けも削除されます。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/t/${tenantCode}/api/groups/${groupId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      router.push(`/t/${tenantCode}/groups`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラー');
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>
          ✏️ 編集
        </Button>
        <Button variant="outline" size="sm" onClick={handleDelete} disabled={busy} className="text-red-600 border-red-200 hover:bg-red-50">
          🗑️ 削除
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3 mt-2">
      <div className="space-y-1">
        <Label htmlFor="edit-name">名前</Label>
        <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="edit-desc">説明</Label>
        <Textarea id="edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => { setEditing(false); setError(''); setName(groupName); setDescription(groupDescription); }} disabled={busy}>
          キャンセル
        </Button>
        <Button size="sm" onClick={handleSave} disabled={busy || !name.trim()}>
          {busy ? '保存中...' : '保存'}
        </Button>
      </div>
    </div>
  );
}
