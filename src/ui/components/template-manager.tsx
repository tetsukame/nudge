'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MarkdownEditor } from './markdown-editor';
import type { TemplateRow } from '@/domain/template/template';

type FlatOrg = { id: string; name: string; level: number; parentId: string | null };

type OrgTreeNode = FlatOrg & { children: OrgTreeNode[] };

function buildTree(flat: FlatOrg[]): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>();
  flat.forEach((o) => byId.set(o.id, { ...o, children: [] }));
  const roots: OrgTreeNode[] = [];
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function OrgTreeSingleSelect({
  orgs, allowableIds, value, onChange,
}: {
  orgs: FlatOrg[];
  allowableIds: Set<string> | null; // null = 全許可 (tenant_admin)
  value: string;
  onChange: (id: string) => void;
}) {
  const tree = useMemo(() => buildTree(orgs), [orgs]);
  return (
    <div className="border border-gray-200 rounded-md max-h-60 overflow-y-auto bg-white">
      {tree.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          value={value}
          allowableIds={allowableIds}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function TreeRow({
  node, depth, value, allowableIds, onChange,
}: {
  node: OrgTreeNode;
  depth: number;
  value: string;
  allowableIds: Set<string> | null;
  onChange: (id: string) => void;
}) {
  const allowed = allowableIds === null || allowableIds.has(node.id);
  const selected = value === node.id;
  return (
    <div>
      <button
        type="button"
        onClick={() => allowed && onChange(node.id)}
        disabled={!allowed}
        className={cn(
          'w-full text-left text-sm py-1 px-2 flex items-center gap-1 select-none',
          selected ? 'bg-primary/10 text-primary font-medium' : '',
          allowed ? 'hover:bg-gray-50 cursor-pointer' : 'text-gray-400 cursor-not-allowed',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className="text-gray-400 shrink-0">{node.children.length > 0 ? '▸' : '・'}</span>
        <span className="truncate">{node.name}</span>
      </button>
      {node.children.map((c) => (
        <TreeRow
          key={c.id} node={c} depth={depth + 1}
          value={value} allowableIds={allowableIds} onChange={onChange}
        />
      ))}
    </div>
  );
}

type Props = {
  tenantCode: string;
  templates: TemplateRow[];
  orgUnits: FlatOrg[];
  currentUserOrgUnitIds: string[];
  isTenantAdmin: boolean;
};

type FormState = {
  id?: string;
  orgUnitId: string;
  title: string;
  body: string;
  estimatedMinutes: string;
  defaultDueOffsetDays: string;
};

const EMPTY_FORM = (orgUnitId: string): FormState => ({
  orgUnitId,
  title: '',
  body: '',
  estimatedMinutes: '',
  defaultDueOffsetDays: '',
});

export function TemplateManager({
  tenantCode, templates, orgUnits, currentUserOrgUnitIds, isTenantAdmin,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // For non-admin: only their own org_units are valid for the org-unit select.
  const allowableOrgs = isTenantAdmin
    ? orgUnits
    : orgUnits.filter((o) => currentUserOrgUnitIds.includes(o.id));
  const allowableIds = isTenantAdmin ? null : new Set(currentUserOrgUnitIds);

  function startCreate() {
    setError('');
    setEditing(EMPTY_FORM(allowableOrgs[0]?.id ?? ''));
  }

  function startEdit(t: TemplateRow) {
    setError('');
    setEditing({
      id: t.id,
      orgUnitId: t.orgUnitId,
      title: t.title,
      body: t.body ?? '',
      estimatedMinutes: t.estimatedMinutes != null ? String(t.estimatedMinutes) : '',
      defaultDueOffsetDays: t.defaultDueOffsetDays != null ? String(t.defaultDueOffsetDays) : '',
    });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError('');
    const payload = {
      orgUnitId: editing.orgUnitId,
      title: editing.title,
      body: editing.body || null,
      estimatedMinutes: editing.estimatedMinutes ? Number(editing.estimatedMinutes) : null,
      defaultDueOffsetDays: editing.defaultDueOffsetDays
        ? Number(editing.defaultDueOffsetDays) : null,
      defaultTargets: [],
    };
    try {
      const url = editing.id
        ? `/t/${tenantCode}/api/admin/templates/${editing.id}`
        : `/t/${tenantCode}/api/admin/templates`;
      const res = await fetch(url, {
        method: editing.id ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? '保存に失敗しました');
      }
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function archive(t: TemplateRow) {
    if (!confirm(`「${t.title}」を削除（アーカイブ）しますか？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/templates/${t.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? '削除に失敗しました');
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={startCreate}
          disabled={busy || allowableOrgs.length === 0}
        >
          ＋ 新規テンプレ
        </Button>
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">
          テンプレートはまだありません。「新規テンプレ」から作成してください。
        </p>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900">{t.title}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    所有: {t.orgUnitName ?? '(不明)'} ／ 作成: {t.createdByName ?? '?'}
                  </div>
                  {t.body && (
                    <div className="mt-2 text-xs text-gray-600 line-clamp-2 whitespace-pre-wrap">
                      {t.body}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                    {t.estimatedMinutes != null && <span>想定 {t.estimatedMinutes} 分</span>}
                    {t.defaultDueOffsetDays != null && (
                      <span>期限: 送信日 +{t.defaultDueOffsetDays} 日</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(t)}
                    disabled={busy}
                    className="text-xs px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => void archive(t)}
                    disabled={busy}
                    className="text-xs px-3 py-1.5 border border-red-300 text-red-600 rounded-md hover:bg-red-50 disabled:opacity-40"
                  >
                    削除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold mb-3">
              {editing.id ? 'テンプレ編集' : '新規テンプレ'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-700">所有課（必須）</label>
                <div className="mt-1">
                  <OrgTreeSingleSelect
                    orgs={orgUnits}
                    allowableIds={allowableIds}
                    value={editing.orgUnitId}
                    onChange={(id) => setEditing({ ...editing, orgUnitId: id })}
                  />
                </div>
                {!isTenantAdmin && (
                  <p className="text-xs text-gray-500 mt-1">
                    ※ 自分が所属する課のみ選択できます
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">タイトル（必須）</label>
                <input
                  type="text"
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mt-1"
                  placeholder="例: 月次データ提出依頼"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">本文（Markdown）</label>
                <div className="mt-1">
                  <MarkdownEditor
                    value={editing.body}
                    onChange={(body) => setEditing({ ...editing, body })}
                    rows={6}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">想定所要時間（分）</label>
                  <input
                    type="number"
                    min={0}
                    value={editing.estimatedMinutes}
                    onChange={(e) => setEditing({ ...editing, estimatedMinutes: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">期限: 送信日 +N 日</label>
                  <input
                    type="number"
                    min={0}
                    value={editing.defaultDueOffsetDays}
                    onChange={(e) => setEditing({ ...editing, defaultDueOffsetDays: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mt-1"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                ※ デフォルト宛先は今回はサポートしません（テンプレ展開後に手動で選択）。
              </p>
            </div>
            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setEditing(null); setError(''); }}
                disabled={busy}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => void save()}
                disabled={busy || !editing.title.trim() || !editing.orgUnitId}
                className="px-4 py-2 bg-primary text-white rounded-md text-sm disabled:opacity-50"
              >
                {busy ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
