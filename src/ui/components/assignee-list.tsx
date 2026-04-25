'use client';

import { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from './status-badge';
import { AssigneeListFilters } from './assignee-list-filters';
import type { AssignmentStatus } from '@/domain/types';

type AssigneeItem = {
  assignmentId: string;
  userId: string;
  displayName: string;
  email: string;
  orgUnitName: string | null;
  status: AssignmentStatus;
  isOverdue: boolean;
  openedAt: string | null;
  respondedAt: string | null;
  actionAt: string | null;
  forwardedToName: string | null;
  commentCount: number;
  hasUnread: boolean;
};

type Summary = {
  unopened: number; opened: number; responded: number;
  unavailable: number; forwarded: number; substituted: number;
  exempted: number; expired: number; overdue: number;
};

type CommentItem = {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type Props = {
  tenantCode: string;
  requestId: string;
  currentUserId: string;
  canSubstitute: boolean;
};

export function AssigneeList({ tenantCode, requestId, currentUserId, canSubstitute }: Props) {
  const [items, setItems] = useState<AssigneeItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState<{
    q: string; orgUnitId: string | null; includeDescendants: boolean;
    groupId: string | null; statuses: AssignmentStatus[]; hasUnread: boolean;
  }>({
    q: '', orgUnitId: null, includeDescendants: true,
    groupId: null, statuses: [], hasUnread: false,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filters.q) qs.set('q', filters.q);
      if (filters.orgUnitId) qs.set('orgUnitId', filters.orgUnitId);
      if (filters.orgUnitId) qs.set('includeDescendants', String(filters.includeDescendants));
      if (filters.groupId) qs.set('groupId', filters.groupId);
      if (filters.statuses.length > 0) qs.set('status', filters.statuses.join(','));
      if (filters.hasUnread) qs.set('hasUnread', 'true');
      const res = await fetch(
        `/t/${tenantCode}/api/requests/${requestId}/assignees?${qs.toString()}`,
      );
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setSummary(data.summary);
      }
    } finally {
      setLoading(false);
    }
  }, [tenantCode, requestId, filters]);

  useEffect(() => { fetchList(); }, [fetchList]);

  return (
    <div className="space-y-3">
      <AssigneeListFilters tenantCode={tenantCode} onChange={setFilters} />

      {summary && (
        <div className="text-xs text-gray-600 flex gap-3 flex-wrap">
          <span>未開封: {summary.unopened}</span>
          <span>開封: {summary.opened}</span>
          <span>対応済み: {summary.responded}</span>
          <span>対応不可: {summary.unavailable}</span>
          {summary.overdue > 0 && (
            <span className="text-red-600 font-medium">期限切れ: {summary.overdue}</span>
          )}
        </div>
      )}

      {loading && <p className="text-xs text-gray-400">読み込み中...</p>}

      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.assignmentId} className="border border-gray-200 rounded-md bg-white">
            <button
              type="button"
              onClick={() => setExpanded(expanded === item.assignmentId ? null : item.assignmentId)}
              className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-50"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="font-medium text-sm truncate">{item.displayName}</span>
                <span className="text-xs text-gray-500 truncate">{item.orgUnitName ?? ''}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {item.commentCount > 0 && (
                  <span className="text-xs text-gray-500">💬 {item.commentCount}</span>
                )}
                {item.hasUnread && <span className="text-blue-500 text-xs">🔵</span>}
                <StatusBadge status={item.status} overdue={item.isOverdue} />
                {item.forwardedToName && (
                  <span className="text-xs text-purple-600">→ {item.forwardedToName}</span>
                )}
              </div>
            </button>

            {expanded === item.assignmentId && (
              <AssigneeDetail
                tenantCode={tenantCode}
                requestId={requestId}
                assignmentId={item.assignmentId}
                currentUserId={currentUserId}
                status={item.status}
                canSubstitute={canSubstitute && ['unopened', 'opened'].includes(item.status)}
                onRefresh={fetchList}
              />
            )}
          </li>
        ))}
        {items.length === 0 && !loading && (
          <li className="text-sm text-gray-500 text-center py-4">該当する assignee がいません</li>
        )}
      </ul>
    </div>
  );
}

function AssigneeDetail({
  tenantCode, requestId, assignmentId, currentUserId, status, canSubstitute, onRefresh,
}: {
  tenantCode: string; requestId: string; assignmentId: string;
  currentUserId: string; status: AssignmentStatus; canSubstitute: boolean;
  onRefresh: () => void;
}) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [newBody, setNewBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showSubstituteDialog, setShowSubstituteDialog] = useState(false);
  const [substituteReason, setSubstituteReason] = useState('');

  const loadComments = useCallback(async () => {
    const res = await fetch(`/t/${tenantCode}/api/requests/${requestId}/comments`);
    if (res.ok) {
      const data = await res.json();
      const thread = data.allThreads?.[assignmentId] ?? [];
      setComments(thread);
    }
  }, [tenantCode, requestId, assignmentId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  async function postReply() {
    if (!newBody.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/t/${tenantCode}/api/requests/${requestId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: newBody, assignmentId }),
      });
      if (res.ok) {
        setNewBody('');
        await loadComments();
      }
    } finally {
      setSending(false);
    }
  }

  async function substitute() {
    setSending(true);
    try {
      const res = await fetch(`/t/${tenantCode}/api/assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'substitute', reason: substituteReason }),
      });
      if (res.ok) {
        setShowSubstituteDialog(false);
        setSubstituteReason('');
        await loadComments();
        onRefresh();
      } else {
        const data = await res.json();
        alert(data.error ?? '代理完了に失敗しました');
      }
    } finally {
      setSending(false);
    }
  }

  // suppress unused variable warning — status is part of the public API
  void status;

  return (
    <div className="px-3 py-3 border-t border-gray-100 bg-gray-50 space-y-3">
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {comments.length === 0 && (
          <p className="text-xs text-gray-400">やり取りはありません</p>
        )}
        {comments.map((c) => {
          const isMe = c.authorUserId === currentUserId;
          return (
            <div key={c.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                isMe ? 'bg-blue-100 text-blue-900' : 'bg-white text-gray-800 border border-gray-200'
              }`}>
                <div className="text-xs font-medium mb-0.5">{c.authorName}</div>
                <div className="whitespace-pre-wrap">{c.body}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(c.createdAt).toLocaleString('ja-JP')}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && newBody.trim()) {
              e.preventDefault();
              void postReply();
            }
          }}
          placeholder="返信..."
          className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => void postReply()}
          disabled={sending || !newBody.trim()}
          className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm disabled:opacity-50"
        >
          送信
        </button>
      </div>

      {canSubstitute && (
        <>
          <button
            onClick={() => setShowSubstituteDialog(true)}
            className="text-sm px-3 py-1.5 border border-orange-300 text-orange-700 rounded-md hover:bg-orange-50"
          >
            👤 代理完了
          </button>
          {showSubstituteDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
                <h3 className="font-bold mb-3">代理完了の理由（必須）</h3>
                <textarea
                  value={substituteReason}
                  onChange={(e) => setSubstituteReason(e.target.value)}
                  className="w-full border border-gray-300 rounded-md p-2 text-sm mb-4 min-h-[60px]"
                  placeholder="代理完了する理由を入力..."
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowSubstituteDialog(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={() => void substitute()}
                    disabled={sending || !substituteReason.trim()}
                    className="px-4 py-2 bg-orange-600 text-white rounded-md text-sm disabled:opacity-50"
                  >
                    代理完了する
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
