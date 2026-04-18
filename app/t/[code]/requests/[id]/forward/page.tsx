'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { UserSearch, type UserResult } from '@/ui/components/user-search';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export default function ForwardPage() {
  const params = useParams<{ code: string; id: string }>();
  const { code, id: requestId } = params;
  const router = useRouter();

  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [initError, setInitError] = useState('');

  // Load pending assignments to find our assignment for this request
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/t/${code}/api/assignments?status=pending&pageSize=100`);
        if (!res.ok) {
          setInitError('依頼情報の取得に失敗しました。');
          return;
        }
        const data = await res.json() as {
          items: Array<{ id: string; request: { id: string } }>;
        };
        const match = data.items.find((a) => a.request.id === requestId);
        if (match) {
          setAssignmentId(match.id);
        } else {
          setInitError('転送可能な依頼が見つかりません。');
        }
      } catch {
        setInitError('依頼情報の取得中にエラーが発生しました。');
      }
    }
    void load();
  }, [code, requestId]);

  async function handleForward() {
    if (!selectedUser || !assignmentId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/t/${code}/api/assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'forward',
          toUserId: selectedUser.id,
          reason: reason || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      router.push(`/t/${code}/requests/${requestId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラーが発生しました');
      setConfirmOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/requests/${requestId}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 依頼詳細に戻る
      </Link>

      <h1 className="text-xl font-bold text-gray-900">依頼を転送する</h1>

      {initError && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
          {initError}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-5">
        <div className="space-y-2">
          <Label>転送先ユーザー</Label>
          <UserSearch
            tenantCode={code}
            onSelect={setSelectedUser}
            selectedId={selectedUser?.id}
          />
          {selectedUser && (
            <div className="mt-2 px-3 py-2 bg-blue-50 rounded-md text-sm">
              <p className="font-medium text-blue-900">{selectedUser.displayName}</p>
              <p className="text-blue-700 text-xs">{selectedUser.email}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="forward-reason">理由・メモ（任意）</Label>
          <Textarea
            id="forward-reason"
            placeholder="転送の理由や引き継ぎ事項を入力..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={!selectedUser || !assignmentId || !!initError}
          className="w-full"
        >
          ↗️ 転送する
        </Button>
      </div>

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={(v) => !v && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>転送の確認</DialogTitle>
            <DialogDescription>
              {selectedUser?.displayName} に依頼を転送します。よろしいですか？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={loading}>
              キャンセル
            </Button>
            <Button onClick={handleForward} disabled={loading}>
              {loading ? '転送中...' : '転送する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
