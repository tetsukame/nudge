import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { listAdminOrgs } from '@/domain/admin/orgs';
import { AdminOrgsTree } from '@/ui/components/admin-orgs-tree';

export const runtime = 'nodejs';

export default async function AdminOrgsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const items = await listAdminOrgs(appPool(), {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/admin`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 管理に戻る
      </Link>
      <h1 className="text-xl font-bold text-gray-900">🏢 組織管理</h1>
      <p className="text-sm text-gray-600">
        テナント内の組織ツリーを表示します。Nudge 上で手動作成された組織は編集・アーカイブが可能、
        Keycloak 同期由来の組織は read-only です（KC 側で追加・削除してください）。
      </p>

      <AdminOrgsTree tenantCode={code} initialItems={items} />
    </div>
  );
}
