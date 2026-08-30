import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { adminPool, appPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { withTenant } from '@/db/with-tenant';
import { enterLogContext } from '@/lib/logger';
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

  // NDG-115: SCIM 経由で status='inactive' にされたユーザーはログイン継続を止める。
  // 期限切れ session cookie は消すため 401 を返す。
  const userState = await withTenant(appPool(), tenant.id, async (client) => {
    const userRes = await client.query<{ status: string }>(
      `SELECT status FROM users WHERE id = $1`,
      [session.userId],
    );
    if (userRes.rows.length === 0) return { status: 'missing' as const };
    if (userRes.rows[0].status !== 'active') return { status: 'inactive' as const };
    const { rows } = await client.query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1`,
      [session.userId],
    );
    const roles = new Set(rows.map((r) => r.role));
    return {
      status: 'active' as const,
      isTenantAdmin: roles.has('tenant_admin'),
      isTenantWideRequester: roles.has('tenant_wide_requester'),
    };
  });
  if (userState.status !== 'active') {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const flags = {
    isTenantAdmin: userState.isTenantAdmin,
    isTenantWideRequester: userState.isTenantWideRequester,
  };

  // NDG-99: 以降の await チェーンで発行されるログに tenantId/userId/requestId を自動付加。
  // requestId は route を跨いだ一連の処理を辿るためのもので、client からのヘッダは信用せず
  // 常にサーバ側で新規生成する。
  enterLogContext({
    tenantId: tenant.id,
    userId: session.userId,
    requestId: req.headers.get('x-request-id') ?? randomUUID(),
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
