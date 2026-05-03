'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Item = {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  status: 'active' | 'archived';
  externalId: string | null;
  archivedAt: string | null;
  memberCount: number;
};

type Props = {
  tenantCode: string;
  initialItems: Item[];
};

type TreeNode = Item & { children: TreeNode[] };

function buildTree(items: Item[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const it of items) {
    map.set(it.id, { ...it, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // sort: active first, then by name
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) sortNodes(n.children);
  }
  sortNodes(roots);
  return roots;
}

export function AdminOrgsTree({ tenantCode, initialItems }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [showArchived, setShowArchived] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function reload() {
    const res = await fetch(`/t/${tenantCode}/api/admin/orgs`);
    if (!res.ok) return;
    const data = await res.json() as { items: Item[] };
    setItems(data.items);
  }

  async function handleCreate(parentId: string | null) {
    if (!newName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/orgs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), parentId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setNewName('');
      setCreating(null);
      await reload();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラー');
    } finally { setBusy(false); }
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/orgs/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setEditing(null);
      await reload();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラー');
    } finally { setBusy(false); }
  }

  async function handleArchive(node: TreeNode) {
    const descendants = countDescendantsActive(node);
    const msg = descendants > 1
      ? `「${node.name}」配下に ${descendants - 1} 件の子組織があります。すべて一緒にアーカイブされます。よろしいですか？`
      : `「${node.name}」をアーカイブしますか？`;
    if (!confirm(msg)) return;

    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/orgs/${node.id}/archive`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      await reload();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラー');
    } finally { setBusy(false); }
  }

  async function handleRestore(id: string) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/orgs/${id}/archive`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      await reload();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラー');
    } finally { setBusy(false); }
  }

  const tree = buildTree(items);
  const visibleTree = showArchived ? tree : filterArchived(tree);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="rounded border-gray-300"
          />
          アーカイブ済みも表示
        </label>
        <Button
          size="sm"
          onClick={() => { setCreating({ parentId: null }); setNewName(''); }}
          disabled={busy}
        >
          ➕ ルート組織を追加
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {creating && creating.parentId === null && (
        <CreateForm
          parentLabel="ルート"
          name={newName}
          onChangeName={setNewName}
          onCancel={() => setCreating(null)}
          onSubmit={() => handleCreate(null)}
          busy={busy}
        />
      )}

      <div className="bg-white rounded-lg border border-gray-200">
        {visibleTree.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-8">組織がありません。</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visibleTree.map((node) => (
              <TreeRow
                key={node.id}
                node={node}
                tenantCode={tenantCode}
                busy={busy}
                editing={editing}
                editName={editName}
                onSetEditing={(id) => { setEditing(id); setEditName(items.find((i) => i.id === id)?.name ?? ''); }}
                onChangeEditName={setEditName}
                onRename={handleRename}
                onArchive={handleArchive}
                onRestore={handleRestore}
                onStartCreate={(parentId) => { setCreating({ parentId }); setNewName(''); }}
                creatingParentId={creating?.parentId ?? null}
                newName={newName}
                onChangeNewName={setNewName}
                onSubmitCreate={handleCreate}
                onCancelCreate={() => setCreating(null)}
                onCancelEditing={() => setEditing(null)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function countDescendantsActive(node: TreeNode): number {
  let n = node.status === 'active' ? 1 : 0;
  for (const c of node.children) n += countDescendantsActive(c);
  return n;
}

function filterArchived(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  for (const n of nodes) {
    if (n.status === 'active') {
      result.push({ ...n, children: filterArchived(n.children) });
    }
  }
  return result;
}

type RowProps = {
  node: TreeNode;
  tenantCode: string;
  busy: boolean;
  editing: string | null;
  editName: string;
  onSetEditing: (id: string) => void;
  onChangeEditName: (v: string) => void;
  onRename: (id: string) => void;
  onArchive: (node: TreeNode) => void;
  onRestore: (id: string) => void;
  onStartCreate: (parentId: string) => void;
  creatingParentId: string | null;
  newName: string;
  onChangeNewName: (v: string) => void;
  onSubmitCreate: (parentId: string) => void;
  onCancelCreate: () => void;
  onCancelEditing: () => void;
};

function TreeRow(props: RowProps) {
  const { node, busy } = props;
  const isKc = node.externalId !== null;
  const isArchived = node.status === 'archived';
  const isEditing = props.editing === node.id;
  const isCreatingChild = props.creatingParentId === node.id;
  const indent = node.level * 24;

  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-2 hover:bg-gray-50',
          isArchived && 'bg-gray-50',
        )}
        style={{ paddingLeft: `${indent + 16}px` }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isEditing ? (
              <input
                type="text"
                value={props.editName}
                onChange={(e) => props.onChangeEditName(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm flex-1 min-w-0"
                autoFocus
              />
            ) : (
              <span className={cn(
                'text-sm font-medium',
                isArchived ? 'text-gray-400 line-through' : 'text-gray-900',
              )}>
                {node.name}
              </span>
            )}
            {isKc && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                🔄 KC連携
              </span>
            )}
            {isArchived && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 border border-gray-300">
                📁 archived
              </span>
            )}
          </div>
          {!isEditing && (
            <p className="text-xs text-gray-500">
              level {node.level} / {node.memberCount} 名
              {node.archivedAt && ` / ${new Date(node.archivedAt).toLocaleString('ja-JP')} archived`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isEditing ? (
            <>
              <Button size="sm" variant="outline" onClick={props.onCancelEditing} disabled={busy}>
                キャンセル
              </Button>
              <Button size="sm" onClick={() => props.onRename(node.id)} disabled={busy || !props.editName.trim()}>
                保存
              </Button>
            </>
          ) : (
            <>
              {!isKc && !isArchived && (
                <>
                  <button
                    type="button" onClick={() => props.onSetEditing(node.id)} disabled={busy}
                    className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  >
                    ✏️ 名前変更
                  </button>
                  <button
                    type="button" onClick={() => props.onStartCreate(node.id)} disabled={busy}
                    className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  >
                    ➕ 子追加
                  </button>
                  <button
                    type="button" onClick={() => props.onArchive(node)} disabled={busy}
                    className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    📁 アーカイブ
                  </button>
                </>
              )}
              {!isKc && isArchived && (
                <button
                  type="button" onClick={() => props.onRestore(node.id)} disabled={busy}
                  className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                >
                  ↩️ 復活
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {isCreatingChild && (
        <div style={{ paddingLeft: `${indent + 40}px`, paddingRight: 16 }}>
          <CreateForm
            parentLabel={node.name}
            name={props.newName}
            onChangeName={props.onChangeNewName}
            onCancel={props.onCancelCreate}
            onSubmit={() => props.onSubmitCreate(node.id)}
            busy={busy}
          />
        </div>
      )}

      {node.children.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {node.children.map((child) => (
            <TreeRow {...props} key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function CreateForm({
  parentLabel, name, onChangeName, onCancel, onSubmit, busy,
}: {
  parentLabel: string;
  name: string;
  onChangeName: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="text-xs text-gray-500 shrink-0">{parentLabel} の下に追加 →</span>
      <input
        type="text" value={name} onChange={(e) => onChangeName(e.target.value)}
        placeholder="組織名"
        className="border border-gray-300 rounded-md px-2 py-1 text-sm flex-1 min-w-0"
        autoFocus
      />
      <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
        キャンセル
      </Button>
      <Button size="sm" onClick={onSubmit} disabled={busy || !name.trim()}>
        作成
      </Button>
    </div>
  );
}
