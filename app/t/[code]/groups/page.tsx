import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { listGroups } from '@/domain/group/list';

export const runtime = 'nodejs';

export default async function GroupListPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

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

  const items = await listGroups(appPool(), {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin,
    isTenantWideRequester: false,
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">グループ</h1>
        <Link
          href={`/t/${code}/groups/new`}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
        >
          ➕ 新規作成
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-center text-gray-500 py-12">
          表示できるグループはありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((g) => (
            <li key={g.id}>
              <Link
                href={`/t/${code}/groups/${g.id}`}
                className="block bg-white rounded-lg border border-gray-200 px-4 py-3 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {g.name}
                      </p>
                      {g.isCreator && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                          👤 作成者
                        </span>
                      )}
                      {g.isMember && !g.isCreator && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                          👥 メンバー
                        </span>
                      )}
                      {g.source === 'keycloak' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                          🔄 KC連携
                        </span>
                      )}
                    </div>
                    {g.description && (
                      <p className="text-xs text-gray-600 truncate mt-0.5">
                        {g.description}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      {g.memberCount} 名
                      {g.createdByName && (
                        <span className="ml-2">作成: {g.createdByName}</span>
                      )}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
