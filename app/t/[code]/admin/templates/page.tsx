import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { listTemplates } from '@/domain/template/template';
import { TemplateManager } from '@/ui/components/template-manager';

export const runtime = 'nodejs';

export default async function AdminTemplatesPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const { templates, orgUnits, userOrgUnitIds, isTenantAdmin } = await withTenant(
    appPool(),
    session.tenantId,
    async (client) => {
      const [{ rows: orgRows }, { rows: uouRows }, { rows: roleRows }] = await Promise.all([
        client.query<{ id: string; name: string; level: number }>(
          `SELECT id, name, level FROM org_unit WHERE status = 'active'
           ORDER BY level ASC, name ASC`,
        ),
        client.query<{ org_unit_id: string }>(
          `SELECT org_unit_id FROM user_org_unit WHERE user_id = $1`,
          [session.userId],
        ),
        client.query<{ role: string }>(
          `SELECT role FROM user_role WHERE user_id = $1`,
          [session.userId],
        ),
      ]);
      const roles = new Set(roleRows.map((r) => r.role));
      return {
        orgUnits: orgRows,
        userOrgUnitIds: uouRows.map((r) => r.org_unit_id),
        isTenantAdmin: roles.has('tenant_admin'),
      };
    },
  ).then(async (base) => {
    const templates = await listTemplates(appPool(), {
      userId: session.userId,
      tenantId: session.tenantId,
      isTenantAdmin: base.isTenantAdmin,
      isTenantWideRequester: false,
    });
    return { ...base, templates };
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/admin`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 管理に戻る
      </Link>
      <div>
        <h1 className="text-xl font-bold text-gray-900">📋 依頼テンプレ</h1>
        <p className="text-sm text-gray-500 mt-1">
          所有課のメンバーが「新規依頼作成」画面から呼び出して使えます。
          {isTenantAdmin ? '（管理者は全テナントのテンプレを編集できます）' : ''}
        </p>
      </div>

      <TemplateManager
        tenantCode={code}
        templates={templates}
        orgUnits={orgUnits}
        currentUserOrgUnitIds={userOrgUnitIds}
        isTenantAdmin={isTenantAdmin}
      />
    </div>
  );
}
