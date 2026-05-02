import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { getGroup } from '@/domain/group/list';
import { listMembers } from '@/domain/group/actions';
import { GroupDetailActions } from '@/ui/components/group-detail-actions';
import { RemoveMemberButton } from '@/ui/components/remove-member-button';

export const runtime = 'nodejs';

export default async function GroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { code, id } = await params;
  const { from } = await searchParams;
  const backHref =
    from === 'admin/groups' ? `/t/${code}/admin/groups`
    : `/t/${code}/groups`;
  const backLabel =
    from === 'admin/groups' ? '← 管理: グループ一覧に戻る'
    : '← 一覧に戻る';

  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const isTenantAdmin = await withTenant(appPool(), session.tenantId, async (client) => {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM user_role
          WHERE user_id = $1 AND role = 'tenant_admin'
       ) AS ok`,
      [session.userId],
    );
    return rows[0].ok;
  });

  const actor = {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin,
    isTenantWideRequester: false,
  };

  const group = await getGroup(appPool(), actor, id);
  if (!group) notFound();

  const members = await listMembers(appPool(), actor, id);

  const canEdit = (group.isCreator || isTenantAdmin) && group.source === 'nudge';

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        {backLabel}
      </Link>

      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-gray-900">{group.name}</h1>
              {group.source === 'keycloak' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  🔄 KC連携（read-only）
                </span>
              )}
            </div>
            {group.description && (
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{group.description}</p>
            )}
            <p className="text-xs text-gray-500 mt-2">
              {group.createdByName && <>作成: {group.createdByName} · </>}
              {group.memberCount} 名
            </p>
          </div>
          {canEdit && (
            <GroupDetailActions tenantCode={code} groupId={group.id} groupName={group.name} groupDescription={group.description ?? ''} />
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-medium text-gray-700">メンバー（{members.length} 名）</h2>
          {canEdit && (
            <Link
              href={`/t/${code}/groups/${id}/members${from ? `?from=${encodeURIComponent(from)}` : ''}`}
              className="text-sm text-blue-600 hover:underline"
            >
              ➕ メンバーを追加
            </Link>
          )}
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-gray-500 px-5 py-6 text-center">メンバーがいません。</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between px-5 py-3 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{m.displayName}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {m.email}
                    {m.orgUnitName && ` · ${m.orgUnitName}`}
                  </p>
                </div>
                {canEdit && (
                  <RemoveMemberButton tenantCode={code} groupId={id} userId={m.userId} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
