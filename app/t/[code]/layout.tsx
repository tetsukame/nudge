import { cookies } from 'next/headers';
import Link from 'next/link';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { Sidebar } from '@/ui/components/sidebar';
import { BottomTabs } from '@/ui/components/bottom-tabs';
import { countFailedNotifications } from '@/domain/admin/dashboard';

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center space-y-4">
          <p className="text-gray-600">セッションが無効です。</p>
          <Link
            href={`/t/${code}/login`}
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            ログイン
          </Link>
        </div>
      </div>
    );
  }

  const { isManager, isTenantAdmin } = await withTenant(appPool(), session.tenantId, async (client) => {
    const [managerResult, roleResult] = await Promise.all([
      client.query(
        `SELECT 1 FROM org_unit_manager WHERE user_id = $1 LIMIT 1`,
        [session.userId],
      ),
      client.query<{ role: string }>(
        `SELECT role FROM user_role WHERE user_id = $1`,
        [session.userId],
      ),
    ]);
    const roles = new Set(roleResult.rows.map((r) => r.role));
    return {
      isManager: managerResult.rows.length > 0,
      isTenantAdmin: roles.has('tenant_admin'),
    };
  });

  const failedNotifications = isTenantAdmin
    ? await countFailedNotifications(appPool(), session.tenantId).catch(() => 0)
    : 0;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar
        tenantCode={code}
        displayName={session.displayName}
        isManager={isManager}
        isTenantAdmin={isTenantAdmin}
        failedNotifications={failedNotifications}
      />
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {children}
      </main>
      <BottomTabs tenantCode={code} />
    </div>
  );
}
