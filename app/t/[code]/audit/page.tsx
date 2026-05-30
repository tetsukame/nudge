import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { listAuditLog } from '@/domain/audit-log/list';
import { AuditLogBrowser } from '@/ui/components/audit-log-browser';

export const runtime = 'nodejs';

/**
 * NDG-67 / NDG-77: 監査ログ画面は /admin/ の外に出している。
 * 理由: /admin/* レイアウトが tenant_admin で gate するため、
 * auditor 専任ユーザーが /admin/audit に到達できなくなる。
 * 概念的にも「auditor は admin ではない」ので URL を分離する。
 */
export default async function AuditPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  // Roles: drives both gate and the back-link target.
  const { isTenantAdmin, isAuditor } = await withTenant(
    appPool(),
    session.tenantId,
    async (client) => {
      const { rows } = await client.query<{ role: string }>(
        `SELECT role FROM user_role WHERE user_id = $1`,
        [session.userId],
      );
      const roles = new Set(rows.map((r) => r.role));
      return {
        isTenantAdmin: roles.has('tenant_admin'),
        isAuditor: roles.has('auditor'),
      };
    },
  );
  if (!isTenantAdmin && !isAuditor) redirect(`/t/${code}`);

  const initial = await listAuditLog(
    appPool(),
    {
      userId: session.userId,
      tenantId: session.tenantId,
      isTenantAdmin: false, // listAuditLog re-checks via user_role; this flag is ignored
      isTenantWideRequester: false,
    },
    { page: 1, pageSize: 50 },
  );

  const backHref = isTenantAdmin ? `/t/${code}/admin` : `/t/${code}`;
  const backLabel = isTenantAdmin ? '← 管理に戻る' : '← トップに戻る';

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        {backLabel}
      </Link>
      <h1 className="text-xl font-bold text-gray-900">📋 監査ログ</h1>

      <AuditLogBrowser
        tenantCode={code}
        initialItems={initial.items}
        initialTotal={initial.total}
        actions={initial.actions}
        targetTypes={initial.targetTypes}
      />
    </div>
  );
}
