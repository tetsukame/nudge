import { NextResponse, type NextRequest } from 'next/server';
import { adminPool } from '../db/pools';
import { resolveTenant, type Tenant } from '../tenant/resolver';
import { verifyScimToken } from './token';
import { scimError } from './schemas';

/**
 * NDG-115 (v0.26): SCIM リクエストの Bearer 認証ガード。
 *
 * 期待するヘッダ: `Authorization: Bearer <plain-token>`
 *
 * 成否とも SCIM Error スキーマ (schemas: [urn:...Error]) で返す
 * (IdP 側が SCIM 仕様通りにパースするため)。
 *
 * 実装ノート:
 *   - tenant コードは URL param (`/t/<code>/scim/v2/...`) から来る
 *   - token 検証は admin pool (RLS 経由しない、bcrypt 比較のみ)
 *   - path traversal 対策で resolveTenant を必ず通す
 */

export type ScimGuardResult =
  | { ok: true; tenant: Tenant }
  | { ok: false; response: NextResponse };

export async function requireScimAuth(
  req: NextRequest,
  tenantCode: string,
): Promise<ScimGuardResult> {
  const tenant = await resolveTenant(adminPool(), tenantCode);
  if (!tenant) {
    return {
      ok: false,
      response: scimJsonError(404, 'tenant not found'),
    };
  }

  const authz = req.headers.get('authorization');
  if (!authz || !authz.toLowerCase().startsWith('bearer ')) {
    return {
      ok: false,
      response: scimJsonError(401, 'Bearer token required', {
        'www-authenticate': 'Bearer realm="SCIM"',
      }),
    };
  }
  const token = authz.slice(7).trim();
  if (!token) {
    return { ok: false, response: scimJsonError(401, 'empty token') };
  }

  const ok = await verifyScimToken(adminPool(), tenant.id, token);
  if (!ok) {
    return { ok: false, response: scimJsonError(401, 'invalid token') };
  }

  return { ok: true, tenant };
}

export function scimJsonError(
  status: number,
  detail: string,
  extraHeaders?: Record<string, string>,
): NextResponse {
  const body = scimError(status, detail);
  const headers = new Headers({ 'content-type': 'application/scim+json' });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }
  return new NextResponse(JSON.stringify(body), { status, headers });
}

export function scimJson(status: number, body: unknown): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/scim+json' },
  });
}
