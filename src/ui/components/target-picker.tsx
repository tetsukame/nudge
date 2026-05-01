'use client';

import { useEffect, useState } from 'react';
import type { TargetSpec } from '@/domain/request/expand-targets';
import { OrgTreePicker, type SelectedOrg } from './org-tree-picker';
import { UserSearch, type UserResult } from './user-search';

type GroupOption = {
  id: string;
  name: string;
  source: 'nudge' | 'keycloak';
  memberCount: number;
};

type Props = {
  tenantCode: string;
  targets: TargetSpec[];
  onChange: (targets: TargetSpec[]) => void;
  showAllTab?: boolean;
};

type TabKey = 'org' | 'user' | 'group' | 'all';

export function TargetPicker({ tenantCode, targets, onChange, showAllTab = false }: Props) {
  const [tab, setTab] = useState<TabKey>('org');
  // Keep metadata for display purposes (id -> name)
  const [userMeta, setUserMeta] = useState<Map<string, UserResult>>(new Map());
  const [orgMeta, setOrgMeta] = useState<Map<string, string>>(new Map());
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  useEffect(() => {
    setGroupsLoading(true);
    fetch(`/t/${tenantCode}/api/groups`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { items: GroupOption[] }) => setGroups(data.items ?? []))
      .catch(() => {})
      .finally(() => setGroupsLoading(false));
  }, [tenantCode]);

  const selectedGroupIds = new Set(
    targets.filter((t) => t.type === 'group').map((t) => (t as Extract<TargetSpec, { type: 'group' }>).groupId),
  );

  function toggleGroup(groupId: string) {
    if (selectedGroupIds.has(groupId)) {
      onChange(targets.filter((t) => !(t.type === 'group' && t.groupId === groupId)));
    } else {
      onChange([...targets, { type: 'group', groupId }]);
    }
  }

  // Derive selected orgs from targets
  const selectedOrgs: SelectedOrg[] = targets
    .filter((t): t is Extract<TargetSpec, { type: 'org_unit' }> => t.type === 'org_unit')
    .map((t) => ({
      id: t.orgUnitId,
      name: orgMeta.get(t.orgUnitId) ?? t.orgUnitId,
      includeDescendants: t.includeDescendants,
    }));

  const allEnabled = targets.some((t) => t.type === 'all');

  function handleOrgChange(orgs: SelectedOrg[]) {
    // Save org names for display
    for (const o of orgs) {
      if (o.name && o.name !== o.id) {
        setOrgMeta((prev) => new Map(prev).set(o.id, o.name));
      }
    }
    const nonOrg = targets.filter((t) => t.type !== 'org_unit');
    const orgSpecs: TargetSpec[] = orgs.map((o) => ({
      type: 'org_unit',
      orgUnitId: o.id,
      includeDescendants: o.includeDescendants,
    }));
    onChange([...nonOrg, ...orgSpecs]);
  }

  function handleUserSelect(user: UserResult) {
    const alreadySelected = targets.some(
      (t) => t.type === 'user' && t.userId === user.id,
    );
    if (alreadySelected) {
      onChange(targets.filter((t) => !(t.type === 'user' && t.userId === user.id)));
    } else {
      setUserMeta((prev) => new Map(prev).set(user.id, user));
      onChange([...targets, { type: 'user', userId: user.id }]);
    }
  }

  function removeUser(userId: string) {
    onChange(targets.filter((t) => !(t.type === 'user' && t.userId === userId)));
  }

  function handleAllToggle(checked: boolean) {
    const nonAll = targets.filter((t) => t.type !== 'all');
    if (checked) {
      onChange([...nonAll, { type: 'all' }]);
    } else {
      onChange(nonAll);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'org', label: '組織' },
    { key: 'user', label: '個人' },
    { key: 'group', label: 'グループ' },
    ...(showAllTab ? [{ key: 'all' as TabKey, label: '全社' }] : []),
  ];

  const selectedUsersFromTargets = targets.filter(
    (t): t is Extract<TargetSpec, { type: 'user' }> => t.type === 'user',
  );

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'org' && (
        <OrgTreePicker
          tenantCode={tenantCode}
          selected={selectedOrgs}
          onChange={handleOrgChange}
        />
      )}

      {tab === 'user' && (
        <div className="space-y-3">
          <UserSearch
            tenantCode={tenantCode}
            onSelect={handleUserSelect}
            selectedId={undefined}
            placeholder="ユーザーを検索して追加..."
          />
          {selectedUsersFromTargets.length > 0 && (
            <ul className="space-y-1">
              {selectedUsersFromTargets.map((t) => {
                const meta = userMeta.get(t.userId);
                return (
                  <li
                    key={t.userId}
                    className="flex items-center justify-between bg-blue-50 rounded-md px-3 py-1.5 text-sm"
                  >
                    <span className="text-blue-800">
                      {meta?.displayName ?? t.userId}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeUser(t.userId)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'group' && (
        <div className="space-y-2">
          {groupsLoading ? (
            <p className="text-xs text-gray-500 px-1 py-3">読み込み中...</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-gray-500 px-1 py-3">
              ターゲットに使えるグループがありません。
            </p>
          ) : (
            <ul className="border border-gray-200 rounded-md divide-y divide-gray-100 bg-white max-h-72 overflow-y-auto">
              {groups.map((g) => {
                const checked = selectedGroupIds.has(g.id);
                return (
                  <li key={g.id}>
                    <label className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleGroup(g.id)}
                        className="rounded border-gray-300"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-900 truncate">{g.name}</p>
                          {g.source === 'keycloak' && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              KC連携
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">{g.memberCount} 名</p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'all' && showAllTab && (
        <div className="py-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allEnabled}
              onChange={(e) => handleAllToggle(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm text-gray-700">全職員に送信</span>
          </label>
          {allEnabled && (
            <p className="mt-2 text-xs text-orange-600">
              ⚠️ テナント全職員が対象になります。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
