import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Bell } from 'lucide-react';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { getTenantPositionConfig } from '@/domain/admin/positions';
import { PageHeader } from '@/ui/components/page-header';
import { PositionConfigForm } from '@/ui/components/position-config-form';

export const runtime = 'nodejs';

export default async function PositionSettingsPage({
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

  const { managerPositions } = await getTenantPositionConfig(appPool(), {
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
        icon={<Bell />}
        title="職位と管理職の設定"
        description="Keycloak の position 属性のうち、どの職位を「管理職」とみなすかを設定します。"
      />

      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
        <p className="text-sm text-gray-600">
          ここに登録した職位名と一致するユーザーは、Keycloak 同期時に自動で
          「管理職」ロールが付与され、主所属が「部下の依頼」の管理対象になります。
          管理画面で手動トグルしたユーザーは <strong>手動ロック</strong> され、
          同期で上書きされません。
        </p>
        <PositionConfigForm
          tenantCode={code}
          initialPositions={managerPositions}
        />
      </div>
    </div>
  );
}
