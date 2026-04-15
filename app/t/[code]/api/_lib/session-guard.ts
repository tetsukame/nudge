import { NextRequest, NextResponse } from 'next/server';
import { adminPool, appPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { withTenant } from '@/db/with-tenant';
import type { ActorContext } from '@/domain/types';

export type GuardedContext = {
  tenantId: string;
  tenantCode: string;
  actor: ActorContext;
};

export async function requireSession(
  req: NextRequest,
  code: string,
): Promise<GuardedContext | NextResponse> {
  const tenant = await resolveTenant(adminPool(), code);
  if (!tenant) return new NextResponse('Tenant not found', { status: 404 });

  const cfg = loadConfig();
  const sealed = req.cookies.get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  if (session.tenantId !== tenant.id) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const flags = await withTenant(appPool(), tenant.id, async (client) => {
    const { rows } = await client.query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1`,
      [session.userId],
    );
    const roles = new Set(rows.map((r) => r.role));
    return {
      isTenantAdmin: roles.has('tenant_admin'),
      isTenantWideRequester: roles.has('tenant_wide_requester'),
    };
  });

  return {
    tenantId: tenant.id,
    tenantCode: tenant.code,
    actor: {
      userId: session.userId,
      tenantId: tenant.id,
      ...flags,
    },
  };
}

export function isGuardFailure(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}
