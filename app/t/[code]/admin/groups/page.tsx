import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { listGroups } from '@/domain/group/list';

export const runtime = 'nodejs';

export default async function AdminGroupsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const items = await listGroups(
    appPool(),
    {
      userId: session.userId,
      tenantId: session.tenantId,
      isTenantAdmin: true,
      isTenantWideRequester: false,
    },
    { scope: 'all_tenant' },
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/admin`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 管理に戻る
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">👨‍👩‍👧‍👦 グループ管理（テナント全体）</h1>
        <Link
          href={`/t/${code}/groups/new`}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
        >
          ➕ 新規作成
        </Link>
      </div>
      <p className="text-sm text-gray-600">
        テナント内のすべてのグループを表示します。Nudge 独自グループは tenant_admin が編集・削除できます。
        Keycloak 連携グループは KC 側で管理してください。
      </p>

      {items.length === 0 ? (
        <p className="text-center text-gray-500 py-12">グループはまだ存在しません。</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">名前</th>
                <th className="px-3 py-2 font-medium">種別</th>
                <th className="px-3 py-2 font-medium">作成者</th>
                <th className="px-3 py-2 font-medium w-20">人数</th>
                <th className="px-3 py-2 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((g) => (
                <tr key={g.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{g.name}</p>
                    {g.description && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{g.description}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {g.source === 'keycloak' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        🔄 KC連携 (read-only)
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                        Nudge
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {g.createdByName ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{g.memberCount}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/t/${code}/groups/${g.id}`}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      詳細 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
