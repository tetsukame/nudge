'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type CommentItem = {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type CommentsData = {
  broadcasts: CommentItem[];
  myThread: CommentItem[];
  allThreads?: Record<string, CommentItem[]>;
};

type Props = {
  tenantCode: string;
  requestId: string;
  assignmentId: string | null;
  isRequester: boolean;
  currentUserId: string;
};

function formatTime(s: string): string {
  const d = new Date(s);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function BroadcastNotice({ comment }: { comment: CommentItem }) {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-yellow-700">📢 お知らせ</span>
        <span className="text-xs text-gray-400">{comment.authorName}</span>
        <span className="text-xs text-gray-400 ml-auto">{formatTime(comment.createdAt)}</span>
      </div>
      <p className="text-sm text-gray-800 whitespace-pre-wrap">{comment.body}</p>
    </div>
  );
}

function ChatBubble({
  comment,
  isMine,
}: {
  comment: CommentItem;
  isMine: boolean;
}) {
  return (
    <div className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-xs lg:max-w-md', isMine ? 'items-end' : 'items-start')}>
        {!isMine && (
          <p className="text-xs text-gray-500 mb-0.5 px-1">{comment.authorName}</p>
        )}
        <div
          className={cn(
            'px-3 py-2 rounded-lg text-sm',
            isMine
              ? 'bg-blue-600 text-white rounded-br-none'
              : 'bg-gray-100 text-gray-800 rounded-bl-none',
          )}
        >
          <p className="whitespace-pre-wrap">{comment.body}</p>
        </div>
        <p className={cn('text-xs text-gray-400 mt-0.5 px-1', isMine && 'text-right')}>
          {formatTime(comment.createdAt)}
        </p>
      </div>
    </div>
  );
}

function ThreadInput({
  onSend,
  placeholder,
  loading,
}: {
  onSend: (text: string) => Promise<void>;
  placeholder?: string;
  loading: boolean;
}) {
  const [text, setText] = useState('');

  async function submit() {
    if (!text.trim()) return;
    await onSend(text.trim());
    setText('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="flex gap-2 mt-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'メッセージを入力... (Enter で送信)'}
        rows={2}
        className="flex-1 resize-none"
        disabled={loading}
      />
      <Button
        onClick={() => void submit()}
        disabled={loading || !text.trim()}
        size="sm"
        className="self-end"
      >
        送信
      </Button>
    </div>
  );
}

export function CommentSection({
  tenantCode,
  requestId,
  assignmentId,
  isRequester,
  currentUserId,
}: Props) {
  const [data, setData] = useState<CommentsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [sendingThread, setSendingThread] = useState(false);
  const [sendingReply, setSendingReply] = useState<string | null>(null);
  const [error, setError] = useState('');
  const threadEndRef = useRef<HTMLDivElement>(null);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/t/${tenantCode}/api/requests/${requestId}/comments`);
      if (res.ok) {
        const json = await res.json() as CommentsData;
        setData(json);
      }
    } catch {
      setError('コメントの取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, [tenantCode, requestId]);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.myThread]);

  async function postComment(body: string, asgId: string | null) {
    const res = await fetch(`/t/${tenantCode}/api/requests/${requestId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, assignmentId: asgId }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error((d as { error?: string }).error ?? `エラー (${res.status})`);
    }
    await fetchComments();
  }

  async function sendBroadcast(text: string) {
    setSendingBroadcast(true);
    setError('');
    try {
      await postComment(text, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setSendingBroadcast(false);
    }
  }

  async function sendThreadMessage(text: string) {
    if (!assignmentId) return;
    setSendingThread(true);
    setError('');
    try {
      await postComment(text, assignmentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setSendingThread(false);
    }
  }

  async function sendReply(text: string, asgId: string) {
    setSendingReply(asgId);
    setError('');
    try {
      await postComment(text, asgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setSendingReply(null);
    }
  }

  if (!data && loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <p className="text-sm text-gray-500">コメントを読み込み中...</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-5">
      <h2 className="text-sm font-medium text-gray-700">コメント</h2>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>
      )}

      {/* Section 1: Broadcasts */}
      {data.broadcasts.length > 0 && (
        <div className="space-y-2">
          {data.broadcasts.map((c) => (
            <BroadcastNotice key={c.id} comment={c} />
          ))}
        </div>
      )}

      {/* Section 2: Requester broadcast input */}
      {isRequester && (
        <div className="border border-yellow-200 rounded-md p-3 bg-yellow-50 space-y-2">
          <p className="text-xs font-medium text-yellow-700">📢 全体にお知らせを送る</p>
          <ThreadInput
            onSend={sendBroadcast}
            placeholder="全員へのお知らせを入力... (Enter で送信)"
            loading={sendingBroadcast}
          />
        </div>
      )}

      {/* Section 3: Assignee chat thread */}
      {!isRequester && assignmentId && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 border-b pb-1">依頼者とのやりとり</p>
          <div className="space-y-3 max-h-72 overflow-y-auto px-1 py-1">
            {data.myThread.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">
                まだメッセージはありません。
              </p>
            )}
            {data.myThread.map((c) => (
              <ChatBubble
                key={c.id}
                comment={c}
                isMine={c.authorUserId === currentUserId}
              />
            ))}
            <div ref={threadEndRef} />
          </div>
          <ThreadInput
            onSend={sendThreadMessage}
            placeholder="メッセージを入力... (Enter で送信)"
            loading={sendingThread}
          />
        </div>
      )}

      {/* Section 4: Requester — all individual threads in accordion */}
      {isRequester && data.allThreads && Object.keys(data.allThreads).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 border-b pb-1">個別スレッド</p>
          {Object.entries(data.allThreads).map(([asgId, thread]) => {
            const firstAuthor = thread[0]?.authorName ?? asgId;
            return (
              <details key={asgId} className="border border-gray-200 rounded-md">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-between">
                  <span>{firstAuthor} のスレッド</span>
                  <span className="text-xs text-gray-400">({thread.length} 件)</span>
                </summary>
                <div className="px-3 pb-3 space-y-3">
                  <div className="space-y-3 max-h-60 overflow-y-auto py-2">
                    {thread.map((c) => (
                      <ChatBubble
                        key={c.id}
                        comment={c}
                        isMine={c.authorUserId === currentUserId}
                      />
                    ))}
                  </div>
                  <ThreadInput
                    onSend={(text) => sendReply(text, asgId)}
                    placeholder="返信を入力... (Enter で送信)"
                    loading={sendingReply === asgId}
                  />
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
