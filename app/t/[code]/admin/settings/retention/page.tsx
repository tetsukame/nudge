import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Archive } from 'lucide-react';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { getRetentionConfigView } from '@/domain/retention/config';
import { PageHeader } from '@/ui/components/page-header';
import { RetentionConfigForm } from '@/ui/components/retention-config-form';

export const runtime = 'nodejs';

export default async function RetentionConfigPage({
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

  const view = await getRetentionConfigView(appPool(), {
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
        icon={<Archive />}
        title="データ保持の設定"
        description="通知履歴・監査ログ・遷移履歴・同期ログの保持期間を組織のルールに沿って設定します。"
      />

      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
        ⚠️ 既定では <strong>無効化</strong> されています。有効化するまでは
        何も削除されません。
      </div>

      <RetentionConfigForm tenantCode={code} initial={view} />
    </div>
  );
}
