import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';

export const runtime = 'nodejs';

type OrgUnitRow = {
  id: string;
  name: string;
  is_primary: boolean;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const orgUnits = await withTenant(appPool(), guard.actor.tenantId, async (client) => {
    const { rows } = await client.query<OrgUnitRow>(
      `SELECT ou.id, ou.name, uou.is_primary
         FROM user_org_unit uou
         JOIN org_unit ou ON ou.id = uou.org_unit_id
        WHERE uou.user_id = $1
        ORDER BY uou.is_primary DESC, ou.name ASC`,
      [guard.actor.userId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isPrimary: r.is_primary,
    }));
  });

  const primary = orgUnits.find((o) => o.isPrimary) ?? null;
  return NextResponse.json({
    orgUnits,
    primaryOrgUnitId: primary?.id ?? null,
  });
}
