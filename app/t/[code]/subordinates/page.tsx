import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { PageHeader } from '@/ui/components/page-header';
import { SubordinateBoard } from '@/ui/components/subordinate-board';

export const runtime = 'nodejs';

export default async function SubordinatesPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const isManager = await withTenant(appPool(), session.tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT 1 FROM org_unit_manager WHERE user_id = $1 LIMIT 1`,
      [session.userId],
    );
    return rows.length > 0;
  });
  if (!isManager) redirect(`/t/${code}/requests`);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        icon={<Users />}
        title="部下の依頼"
        description="配下メンバーの未処理状況をタスク／人の 2 軸で確認し、リマインドできます。"
      />
      <SubordinateBoard tenantCode={code} />
    </div>
  );
}
