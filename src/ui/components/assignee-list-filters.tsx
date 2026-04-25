'use client';

import { useState, useEffect } from 'react';
import type { AssignmentStatus } from '@/domain/types';

type OrgNode = { id: string; name: string; memberCount: number; children: OrgNode[] };

type Props = {
  tenantCode: string;
  onChange: (filters: {
    q: string;
    orgUnitId: string | null;
    includeDescendants: boolean;
    groupId: string | null;
    statuses: AssignmentStatus[];
    hasUnread: boolean;
  }) => void;
};

type GroupItem = { id: string; name: string };

function flattenOrgs(nodes: OrgNode[], depth = 0): Array<{ id: string; label: string }> {
  return nodes.flatMap((n) => [
    { id: n.id, label: '　'.repeat(depth) + n.name },
    ...flattenOrgs(n.children, depth + 1),
  ]);
}

export function AssigneeListFilters({ tenantCode, onChange }: Props) {
  const [q, setQ] = useState('');
  const [orgUnitId, setOrgUnitId] = useState<string>('');
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [groupId, setGroupId] = useState<string>('');
  const [statuses, setStatuses] = useState<AssignmentStatus[]>([]);
  const [hasUnread, setHasUnread] = useState(false);
  const [orgs, setOrgs] = useState<Array<{ id: string; label: string }>>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);

  useEffect(() => {
    fetch(`/t/${tenantCode}/api/org-tree`)
      .then((r) => r.json())
      .then((data: OrgNode[]) => setOrgs(flattenOrgs(data)))
      .catch(() => {});
  }, [tenantCode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onChange({
        q,
        orgUnitId: orgUnitId || null,
        includeDescendants,
        groupId: groupId || null,
        statuses,
        hasUnread,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [q, orgUnitId, includeDescendants, groupId, statuses, hasUnread, onChange]);

  const statusOptions: Array<{ value: AssignmentStatus; label: string }> = [
    { value: 'unopened', label: '未開封' },
    { value: 'opened', label: '開封済み' },
    { value: 'responded', label: '対応済み' },
    { value: 'unavailable', label: '対応不可' },
    { value: 'forwarded', label: '転送済み' },
    { value: 'substituted', label: '代理完了' },
    { value: 'exempted', label: '免除' },
  ];

  return (
    <div className="space-y-2 p-3 bg-gray-50 rounded-md border border-gray-200">
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={orgUnitId}
          onChange={(e) => setOrgUnitId(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
        >
          <option value="">すべての組織</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={includeDescendants}
            onChange={(e) => setIncludeDescendants(e.target.checked)}
          />
          配下含む
        </label>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
        >
          <option value="">グループ指定なし</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1">
        {statusOptions.map((opt) => {
          const active = statuses.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setStatuses((prev) =>
                  active ? prev.filter((s) => s !== opt.value) : [...prev, opt.value],
                );
              }}
              className={`text-xs px-2 py-1 rounded-full border ${
                active
                  ? 'bg-blue-100 border-blue-400 text-blue-800'
                  : 'bg-white border-gray-300 text-gray-600'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="名前・メールで検索"
          className="flex-1 min-w-[180px] text-sm border border-gray-300 rounded px-2 py-1"
        />
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={hasUnread}
            onChange={(e) => setHasUnread(e.target.checked)}
          />
          未読のみ
        </label>
      </div>
    </div>
  );
}
