import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { getTenantAuthConfigView } from '@/domain/auth/config';
import { PageHeader } from '@/ui/components/page-header';
import { AuthConfigForm } from '@/ui/components/auth-config-form';

export const runtime = 'nodejs';

export default async function AuthConfigPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const isAdmin = await withTenant(appPool(), session.tenantId, async (client) => {
    const { rows } = await client.query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1`,
      [session.userId],
    );
    return rows.some((r) => r.role === 'tenant_admin');
  });
  if (!isAdmin) redirect(`/t/${code}/requests`);

  const view = await getTenantAuthConfigView(appPool(), {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/admin`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 管理に戻る
      </Link>

      <PageHeader
        icon={<KeyRound />}
        title="認証プロバイダの設定"
        description="Keycloak または汎用 OIDC (Pocket ID / Authentik / Entra ID 等) を tenant ごとに設定します。"
      />

      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
        ⚠️ 設定を誤ると tenant 内の全ユーザーがログインできなくなる可能性があります。
        保存前に「接続テスト」で Discovery Endpoint に到達できることを必ず確認してください。
        {view === null && (
          <>
            <br />
            現在この tenant は環境変数 (<code>OIDC_CLIENT_ID/SECRET</code>) と
            <code> tenant.keycloak_issuer_url</code> を使う既定の設定で動いています。
          </>
        )}
      </div>

      <AuthConfigForm tenantCode={code} initial={view} />
    </div>
  );
}
