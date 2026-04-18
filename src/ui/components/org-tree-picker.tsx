'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

type OrgNode = {
  id: string;
  name: string;
  memberCount: number;
  children: OrgNode[];
};

type SelectedOrg = {
  id: string;
  name: string;
  includeDescendants: boolean;
};

type Props = {
  tenantCode: string;
  selected: SelectedOrg[];
  onChange: (selected: SelectedOrg[]) => void;
};

function OrgNodeRow({
  node,
  depth,
  selected,
  onToggle,
}: {
  node: OrgNode;
  depth: number;
  selected: Map<string, SelectedOrg>;
  onToggle: (id: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isSelected = selected.has(node.id);

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-gray-50 select-none',
          isSelected && 'bg-blue-50',
        )}
        style={{ paddingLeft: `${(depth + 1) * 12}px` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-700 shrink-0"
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onToggle(node.id, node.name)}
          className={cn(
            'flex-1 text-left text-sm',
            isSelected ? 'text-blue-700 font-medium' : 'text-gray-700',
          )}
        >
          {node.name}
          <span className="ml-1 text-xs text-gray-400">({node.memberCount}名)</span>
        </button>
      </div>
      {expanded && node.children.map((child) => (
        <OrgNodeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selected}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

export function OrgTreePicker({ tenantCode, selected, onChange }: Props) {
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/t/${tenantCode}/api/org-tree`)
      .then((r) => r.json())
      .then((data: OrgNode[]) => setTree(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tenantCode]);

  const selectedMap = new Map(selected.map((s) => [s.id, s]));

  function toggleOrg(id: string, name: string) {
    if (selectedMap.has(id)) {
      onChange(selected.filter((s) => s.id !== id));
    } else {
      onChange([...selected, { id, name, includeDescendants: false }]);
    }
  }

  function toggleDescendants(id: string) {
    onChange(
      selected.map((s) =>
        s.id === id ? { ...s, includeDescendants: !s.includeDescendants } : s,
      ),
    );
  }

  function removeOrg(id: string) {
    onChange(selected.filter((s) => s.id !== id));
  }

  if (loading) {
    return <p className="text-sm text-gray-500 py-2">読み込み中...</p>;
  }

  return (
    <div className="flex gap-4">
      {/* Tree panel */}
      <div className="flex-1 border border-gray-200 rounded-md overflow-y-auto max-h-72 bg-white">
        {tree.length === 0 ? (
          <p className="text-sm text-gray-500 p-3">組織データがありません。</p>
        ) : (
          tree.map((node) => (
            <OrgNodeRow
              key={node.id}
              node={node}
              depth={0}
              selected={selectedMap}
              onToggle={toggleOrg}
            />
          ))
        )}
      </div>

      {/* Selected panel */}
      <div className="w-52 shrink-0">
        {selected.length === 0 ? (
          <p className="text-xs text-gray-400 pt-2">左の組織をクリックして選択</p>
        ) : (
          <ul className="space-y-2">
            {selected.map((s) => (
              <li key={s.id} className="bg-blue-50 rounded-md px-3 py-2 text-sm">
                <div className="flex items-start justify-between gap-1">
                  <span className="font-medium text-blue-800 text-xs">{s.name}</span>
                  <button
                    type="button"
                    onClick={() => removeOrg(s.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors leading-none"
                  >
                    ✕
                  </button>
                </div>
                <label className="flex items-center gap-1 mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={s.includeDescendants}
                    onChange={() => toggleDescendants(s.id)}
                    className="rounded"
                  />
                  <span className="text-xs text-blue-700">配下含む</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export type { SelectedOrg };
