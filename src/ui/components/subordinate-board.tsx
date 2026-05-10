'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Bell,
  CalendarClock,
  Inbox,
  TriangleAlert,
  User as UserIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/ui/components/status-badge';
import { cn } from '@/lib/utils';

type Cell = {
  userId: string;
  requestId: string;
  assignmentId: string;
  status: string;
  isOverdue: boolean;
  hasUnread: boolean;
};
type UserRow = {
  userId: string;
  displayName: string;
  orgUnitName: string | null;
  pendingCount: number;
  overdueCount: number;
};
type RequestRow = {
  requestId: string;
  title: string;
  dueAt: string | null;
  pendingCount: number;
  overdueCount: number;
  subtreeTotal: number;
  subtreeDone: number;
};
type MatrixData = {
  users: UserRow[];
  requests: RequestRow[];
  cells: Cell[];
};

type GroupBy = 'task' | 'user';
type Filter = 'all' | 'in_progress' | 'done';

type Props = { tenantCode: string };

export function SubordinateBoard({ tenantCode }: Props) {
  return (
    <Suspense fallback={null}>
      <SubordinateBoardInner tenantCode={tenantCode} />
    </Suspense>
  );
}

function SubordinateBoardInner({ tenantCode }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [groupBy, setGroupBy] = useState<GroupBy>(
    () => (searchParams?.get('groupBy') === 'user' ? 'user' : 'task'),
  );
  const [filter, setFilter] = useState<Filter>(() => {
    const f = searchParams?.get('filter');
    return f === 'all' || f === 'done' ? f : 'in_progress';
  });
  const [overdueOnly, setOverdueOnly] = useState<boolean>(
    () => searchParams?.get('overdue') === '1',
  );
  const [dueSoon, setDueSoon] = useState<boolean>(
    () => searchParams?.get('dueWithinDays') === '7',
  );
  const [q, setQ] = useState<string>(() => searchParams?.get('q') ?? '');

  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Sync state → URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (groupBy !== 'task') params.set('groupBy', groupBy);
    if (filter !== 'in_progress') params.set('filter', filter);
    if (overdueOnly) params.set('overdue', '1');
    if (dueSoon) params.set('dueWithinDays', '7');
    if (q.trim()) params.set('q', q.trim());
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [groupBy, filter, overdueOnly, dueSoon, q, pathname, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('filter', filter);
      if (overdueOnly) params.set('overdue', '1');
      if (dueSoon) params.set('dueWithinDays', '7');
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(
        `/t/${tenantCode}/api/subordinates/matrix?${params.toString()}`,
      );
      if (!res.ok) throw new Error(`エラー (${res.status})`);
      const body = (await res.json()) as MatrixData;
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラー');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [tenantCode, filter, overdueOnly, dueSoon, q]);

  // Debounce 検索 by reusing q in deps; small delay to avoid hammering
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => { void fetchData(); }, 250);
    return () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
    };
  }, [fetchData]);

  const cellMap = useMemo(() => {
    if (!data) return new Map<string, Cell[]>();
    if (groupBy === 'task') {
      const m = new Map<string, Cell[]>();
      for (const c of data.cells) {
        const arr = m.get(c.requestId) ?? [];
        arr.push(c);
        m.set(c.requestId, arr);
      }
      return m;
    }
    const m = new Map<string, Cell[]>();
    for (const c of data.cells) {
      const arr = m.get(c.userId) ?? [];
      arr.push(c);
      m.set(c.userId, arr);
    }
    return m;
  }, [data, groupBy]);

  const usersById = useMemo(() => {
    const m = new Map<string, UserRow>();
    if (data) for (const u of data.users) m.set(u.userId, u);
    return m;
  }, [data]);

  const requestsById = useMemo(() => {
    const m = new Map<string, RequestRow>();
    if (data) for (const r of data.requests) m.set(r.requestId, r);
    return m;
  }, [data]);

  return (
    <div className="space-y-4">
      {/* Toggle + filters */}
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-lg border border-gray-200 p-3">
        <GroupByToggle value={groupBy} onChange={setGroupBy} />

        <div className="flex gap-1">
          {(['in_progress', 'all', 'done'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'text-xs px-2.5 py-1 rounded-md border transition-colors',
                filter === f
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {f === 'in_progress' ? '進行中' : f === 'done' ? '完了' : 'すべて'}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          期限切れのみ
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={dueSoon}
            onChange={(e) => setDueSoon(e.target.checked)}
            className="rounded border-gray-300"
          />
          期限が近い (一週間以内)
        </label>

        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="タイトル検索"
          className="ml-auto text-sm border border-gray-300 rounded-md px-2 py-1 w-48"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {loading && !data && (
        <p className="text-sm text-gray-500 py-12 text-center">読み込み中...</p>
      )}

      {data && data.cells.length === 0 && !loading && (
        <p className="text-sm text-gray-500 py-12 text-center">
          該当する{filter === 'done' ? '完了' : '未処理'}案件はありません
        </p>
      )}

      {data && data.cells.length > 0 && groupBy === 'task' && (
        <div className="space-y-3">
          {data.requests.map((r) => (
            <TaskGroup
              key={r.requestId}
              tenantCode={tenantCode}
              request={r}
              cells={cellMap.get(r.requestId) ?? []}
              usersById={usersById}
            />
          ))}
        </div>
      )}

      {data && data.cells.length > 0 && groupBy === 'user' && (
        <div className="space-y-3">
          {data.users.map((u) => (
            <UserGroup
              key={u.userId}
              tenantCode={tenantCode}
              user={u}
              cells={cellMap.get(u.userId) ?? []}
              requestsById={requestsById}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupByToggle({
  value, onChange,
}: {
  value: GroupBy;
  onChange: (v: GroupBy) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
      <button
        type="button"
        onClick={() => onChange('task')}
        className={cn(
          'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded transition-colors',
          value === 'task'
            ? 'bg-white text-foreground shadow-sm'
            : 'text-gray-500 hover:text-foreground',
        )}
      >
        <Inbox className="h-3.5 w-3.5" />
        タスク
      </button>
      <button
        type="button"
        onClick={() => onChange('user')}
        className={cn(
          'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded transition-colors',
          value === 'user'
            ? 'bg-white text-foreground shadow-sm'
            : 'text-gray-500 hover:text-foreground',
        )}
      >
        <UserIcon className="h-3.5 w-3.5" />
        人
      </button>
    </div>
  );
}

function TaskGroup({
  tenantCode, request, cells, usersById,
}: {
  tenantCode: string;
  request: RequestRow;
  cells: Cell[];
  usersById: Map<string, UserRow>;
}) {
  const [open, setOpen] = useState(true);
  const due = request.dueAt ? new Date(request.dueAt) : null;
  const completionPct =
    request.subtreeTotal > 0
      ? Math.round((request.subtreeDone / request.subtreeTotal) * 100)
      : 0;

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <Inbox className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{request.title}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            {due && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                期限 {due.toLocaleDateString('ja-JP')}
              </span>
            )}
            {request.subtreeTotal > 0 && (
              <span title="自組織内の完了率">
                完了 {completionPct}%（{request.subtreeDone}/{request.subtreeTotal}）
              </span>
            )}
            <span>未処理 {request.pendingCount}</span>
            {request.overdueCount > 0 && (
              <span className="text-destructive">
                期限切れ {request.overdueCount}
              </span>
            )}
          </div>
        </div>
        <RemindRequestButton tenantCode={tenantCode} requestId={request.requestId} />
      </button>
      {open && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {cells.map((c) => {
            const u = usersById.get(c.userId);
            return (
              <CellRow
                key={c.assignmentId}
                tenantCode={tenantCode}
                cell={c}
                primaryLabel={u?.displayName ?? '—'}
                secondaryLabel={u?.orgUnitName ?? ''}
                requestId={c.requestId}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function UserGroup({
  tenantCode, user, cells, requestsById,
}: {
  tenantCode: string;
  user: UserRow;
  cells: Cell[];
  requestsById: Map<string, RequestRow>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <UserIcon className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {user.displayName}
            {user.orgUnitName && (
              <span className="ml-1 text-xs text-muted-foreground font-normal">
                ＠{user.orgUnitName}
              </span>
            )}
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span>未処理 {user.pendingCount} 件</span>
            {user.overdueCount > 0 && (
              <span className="text-destructive">
                期限切れ {user.overdueCount}
              </span>
            )}
          </div>
        </div>
      </button>
      {open && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {[...cells]
            .sort((a, b) => {
              const ra = requestsById.get(a.requestId)?.dueAt ?? null;
              const rb = requestsById.get(b.requestId)?.dueAt ?? null;
              // due_at ASC, NULLS LAST
              if (ra && rb) return ra < rb ? -1 : ra > rb ? 1 : 0;
              if (ra && !rb) return -1;
              if (!ra && rb) return 1;
              return 0;
            })
            .map((c) => {
              const r = requestsById.get(c.requestId);
              const due = r?.dueAt ? new Date(r.dueAt) : null;
              const dueText = due
                ? `[期限 ${due.toLocaleDateString('ja-JP')}]`
                : '[期限なし]';
              return (
                <CellRow
                  key={c.assignmentId}
                  tenantCode={tenantCode}
                  cell={c}
                  primaryLabel={`${dueText} ${r?.title ?? '—'}`}
                  secondaryLabel=""
                  requestId={c.requestId}
                />
              );
            })}
        </ul>
      )}
    </section>
  );
}

function CellRow({
  tenantCode, cell, primaryLabel, secondaryLabel, requestId,
}: {
  tenantCode: string;
  cell: Cell;
  primaryLabel: string;
  secondaryLabel: string;
  requestId: string;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      {cell.isOverdue && (
        <TriangleAlert className="h-3.5 w-3.5 text-destructive shrink-0" />
      )}
      <Link
        href={`/t/${tenantCode}/requests/${requestId}#assignees`}
        className="flex-1 min-w-0 text-sm text-foreground no-underline hover:underline"
      >
        <span className="truncate">{primaryLabel}</span>
        {secondaryLabel && (
          <span className="text-xs text-muted-foreground ml-2">
            {secondaryLabel}
          </span>
        )}
      </Link>
      <StatusBadge status={cell.status} overdue={cell.isOverdue} />
      {cell.hasUnread && (
        <Badge variant="info" className="text-[10px]">未読</Badge>
      )}
      <RemindAssignmentButton
        tenantCode={tenantCode}
        assignmentId={cell.assignmentId}
      />
    </li>
  );
}

function RemindRequestButton({
  tenantCode, requestId,
}: {
  tenantCode: string;
  requestId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('この依頼の未対応者全員にリマインドを送りますか？')) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(
        `/t/${tenantCode}/api/requests/${requestId}/remind`,
        { method: 'POST' },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason =
          res.status === 429
            ? '前回のリマインドから 1 時間以上空けてください'
            : (body as { error?: string }).error ?? `エラー (${res.status})`;
        throw new Error(reason);
      }
      const recipients = (body as { recipients?: number }).recipients ?? 0;
      setMsg(`${recipients} 名に送信`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'エラー');
    } finally {
      setBusy(false);
      setTimeout(() => { setMsg(null); setErr(null); }, 3000);
    }
  }

  return (
    <span className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border bg-white text-foreground hover:border-primary/40 hover:bg-emerald-50/40 disabled:opacity-50"
      >
        <Bell className="h-3 w-3" />
        {busy ? '...' : '全員にリマインド'}
      </button>
      {msg && <span className="text-xs text-emerald-700">{msg}</span>}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </span>
  );
}

function RemindAssignmentButton({
  tenantCode, assignmentId,
}: {
  tenantCode: string;
  assignmentId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/t/${tenantCode}/api/assignments/${assignmentId}/remind`,
        { method: 'POST' },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason =
          res.status === 429
            ? '1 時間以内は再送できません'
            : (body as { error?: string }).error ?? `エラー (${res.status})`;
        throw new Error(reason);
      }
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'エラー');
      setTimeout(() => setErr(null), 3000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border bg-white text-foreground hover:border-primary/40 hover:bg-emerald-50/40 disabled:opacity-50"
      >
        <Bell className="h-3 w-3" />
        {busy ? '...' : done ? '送信済み' : 'リマインド'}
      </button>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
