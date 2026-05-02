'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type FlatOrg = { id: string; name: string; level: number };
type OrgUnit = { id: string; name: string; isPrimary: boolean };
type Status = 'active' | 'inactive';
type Role = 'tenant_admin' | 'tenant_wide_requester';
const ROLES: Role[] = ['tenant_admin', 'tenant_wide_requester'];

type Props = {
  tenantCode: string;
  userId: string;
  currentUserId: string;
  initialStatus: Status;
  initialOrgUnits: OrgUnit[];
  initialRoles: string[];
  allOrgUnits: FlatOrg[];
};

const ROLE_LABEL: Record<Role, string> = {
  tenant_admin: 'テナント管理者 (tenant_admin)',
  tenant_wide_requester: '組織横断送信者 (tenant_wide_requester)',
};

export function AdminUserDetailEditor({
  tenantCode, userId, currentUserId,
  initialStatus, initialOrgUnits, initialRoles, allOrgUnits,
}: Props) {
  const router = useRouter();
  const isSelf = userId === currentUserId;

  // Status
  const [status, setStatus] = useState<Status>(initialStatus);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState('');

  // Org units (state held as array of {id, isPrimary})
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>(initialOrgUnits);
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgError, setOrgError] = useState('');
  const [addOrgId, setAddOrgId] = useState<string>('');

  // Roles
  const [roles, setRoles] = useState<Set<string>>(new Set(initialRoles));
  const [rolesBusy, setRolesBusy] = useState(false);
  const [rolesError, setRolesError] = useState('');

  async function handleStatusChange(newStatus: Status) {
    if (newStatus === status) return;
    setStatusBusy(true);
    setStatusError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'エラー');
      }
      setStatus(newStatus);
      router.refresh();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : '予期しないエラー');
    } finally {
      setStatusBusy(false);
    }
  }

  async function saveOrgUnits(next: OrgUnit[]) {
    setOrgBusy(true);
    setOrgError('');
    const primary = next.find((o) => o.isPrimary)?.id ?? null;
    if (next.length > 0 && primary === null) {
      setOrgError('主所属を 1 つ選択してください。');
      setOrgBusy(false);
      return;
    }
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/users/${userId}/org-units`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgUnitIds: next.map((o) => o.id),
          primaryOrgUnitId: primary,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'エラー');
      }
      setOrgUnits(next);
      router.refresh();
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : '予期しないエラー');
    } finally {
      setOrgBusy(false);
    }
  }

  function addOrg() {
    if (!addOrgId) return;
    if (orgUnits.some((o) => o.id === addOrgId)) {
      setAddOrgId('');
      return;
    }
    const flat = allOrgUnits.find((o) => o.id === addOrgId);
    if (!flat) return;
    const next: OrgUnit[] = [
      ...orgUnits,
      {
        id: flat.id,
        name: flat.name,
        isPrimary: orgUnits.length === 0, // first one becomes primary
      },
    ];
    setAddOrgId('');
    void saveOrgUnits(next);
  }

  function removeOrg(orgId: string) {
    const removing = orgUnits.find((o) => o.id === orgId);
    if (!removing) return;
    let next = orgUnits.filter((o) => o.id !== orgId);
    if (removing.isPrimary && next.length > 0) {
      next = [{ ...next[0], isPrimary: true }, ...next.slice(1).map((o) => ({ ...o, isPrimary: false }))];
    }
    void saveOrgUnits(next);
  }

  function setPrimary(orgId: string) {
    const next = orgUnits.map((o) => ({ ...o, isPrimary: o.id === orgId }));
    void saveOrgUnits(next);
  }

  async function saveRoles(next: Set<string>) {
    setRolesBusy(true);
    setRolesError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/users/${userId}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: [...next] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'エラー');
      }
      setRoles(next);
      router.refresh();
    } catch (err) {
      setRolesError(err instanceof Error ? err.message : '予期しないエラー');
    } finally {
      setRolesBusy(false);
    }
  }

  function toggleRole(role: Role, checked: boolean) {
    if (isSelf && role === 'tenant_admin' && !checked) {
      if (!confirm('自分の管理者ロールを外そうとしています。本当に進めますか？')) return;
    }
    const next = new Set(roles);
    if (checked) next.add(role); else next.delete(role);
    void saveRoles(next);
  }

  // Available orgs to add (not already in user's orgs)
  const addable = allOrgUnits.filter((o) => !orgUnits.some((u) => u.id === o.id));

  return (
    <div className="space-y-6">
      {/* Status */}
      <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-medium text-gray-700">ステータス</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={status === 'active' ? 'default' : 'outline'}
            onClick={() => handleStatusChange('active')}
            disabled={statusBusy || status === 'active'}
          >
            active
          </Button>
          <Button
            type="button"
            size="sm"
            variant={status === 'inactive' ? 'default' : 'outline'}
            onClick={() => handleStatusChange('inactive')}
            disabled={statusBusy || status === 'inactive' || isSelf}
          >
            inactive
          </Button>
          {isSelf && (
            <span className="text-xs text-gray-500 ml-2">（自分自身を inactive にはできません）</span>
          )}
        </div>
        {statusError && <p className="text-sm text-red-600">{statusError}</p>}
      </section>

      {/* Org units */}
      <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-medium text-gray-700">所属組織（主所属を 1 つ）</h2>
        {orgUnits.length === 0 ? (
          <p className="text-sm text-gray-500">所属が未設定です。</p>
        ) : (
          <ul className="space-y-1">
            {orgUnits.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-gray-50"
              >
                <label className="flex items-center gap-2 text-sm flex-1">
                  <input
                    type="radio"
                    name="primary-org"
                    checked={o.isPrimary}
                    onChange={() => setPrimary(o.id)}
                    disabled={orgBusy}
                    className="border-gray-300"
                  />
                  <span
                    className={cn(
                      'font-medium',
                      o.isPrimary ? 'text-gray-900' : 'text-gray-700',
                    )}
                  >
                    {o.name}
                  </span>
                  {o.isPrimary && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200">
                      主所属
                    </span>
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => removeOrg(o.id)}
                  disabled={orgBusy}
                  className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded border border-red-200 transition-colors disabled:opacity-40"
                >
                  外す
                </button>
              </li>
            ))}
          </ul>
        )}

        {addable.length > 0 && (
          <div className="flex items-end gap-2 pt-2">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-gray-600" htmlFor="add-org">所属を追加</label>
              <select
                id="add-org"
                value={addOrgId}
                onChange={(e) => setAddOrgId(e.target.value)}
                disabled={orgBusy}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">（組織を選択）</option>
                {addable.map((o) => (
                  <option key={o.id} value={o.id}>
                    {'　'.repeat(o.level)}{o.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={addOrg}
              disabled={!addOrgId || orgBusy}
            >
              追加
            </Button>
          </div>
        )}

        {orgError && <p className="text-sm text-red-600">{orgError}</p>}
      </section>

      {/* Roles */}
      <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-medium text-gray-700">ロール</h2>
        <div className="space-y-2">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={roles.has(r)}
                onChange={(e) => toggleRole(r, e.target.checked)}
                disabled={rolesBusy}
                className="rounded border-gray-300"
              />
              <span className="text-gray-700">{ROLE_LABEL[r]}</span>
            </label>
          ))}
        </div>
        {rolesError && <p className="text-sm text-red-600">{rolesError}</p>}
        <p className="text-xs text-gray-500">
          ※ テナント内の最後の管理者からロールを外すことはできません（運用継続のため）。
        </p>
      </section>
    </div>
  );
}
