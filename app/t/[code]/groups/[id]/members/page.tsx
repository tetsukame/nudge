import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { getGroup } from '@/domain/group/list';
import { listMembers } from '@/domain/group/actions';
import { AddMembersForm } from '@/ui/components/add-members-form';

export const runtime = 'nodejs';

export default async function AddMembersPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;

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
  if (group.source === 'keycloak' || (!group.isCreator && !isTenantAdmin)) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <p className="text-gray-500">編集権限がありません。</p>
      </div>
    );
  }

  // 既存メンバーの ID 集合 (フロントの初期チェック / 重複追加抑止)
  const existingMembers = await listMembers(appPool(), actor, id);
  const existingIds = existingMembers.map((m) => m.userId);

  // org_unit ツリー (フィルタ用)
  const orgUnits = await withTenant(appPool(), session.tenantId, async (client) => {
    const { rows } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM org_unit ORDER BY name ASC`,
    );
    return rows;
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/groups/${id}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← グループ詳細に戻る
      </Link>
      <h1 className="text-xl font-bold text-gray-900">
        メンバーを追加: <span className="text-gray-600">{group.name}</span>
      </h1>

      <AddMembersForm
        tenantCode={code}
        groupId={id}
        existingUserIds={existingIds}
        orgUnits={orgUnits}
      />
    </div>
  );
}
