import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { getNotificationSettings } from '@/domain/settings/get';
import { SettingsForm } from '@/ui/components/settings-form';

export const runtime = 'nodejs';

export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);

  if (!session) {
    redirect(`/t/${code}/login`);
  }

  const isTenantAdmin = await withTenant(appPool(), session.tenantId, async (client) => {
    const { rows } = await client.query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1`,
      [session.userId],
    );
    return rows.some((r) => r.role === 'tenant_admin');
  });

  if (!isTenantAdmin) {
    redirect(`/t/${code}/requests`);
  }

  const actor = {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  };

  const initial = await getNotificationSettings(appPool(), actor);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">通知設定</h1>
      <SettingsForm tenantCode={code} initial={initial} />
    </div>
  );
}
