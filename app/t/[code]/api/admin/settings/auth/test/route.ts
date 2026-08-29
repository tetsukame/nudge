import { NextRequest, NextResponse } from 'next/server';
import { requireSession, isGuardFailure } from '../../../../_lib/session-guard';
import { testOidcDiscovery } from '@/domain/auth/discovery-test';

export const runtime = 'nodejs';

/**
 * POST /api/admin/settings/auth/test
 * body: { issuerUrl: string }
 * OIDC Discovery Endpoint に到達できるかを検証して結果を返す。
 * 保存前の form 入力でも呼べるよう、body から issuer_url を受け取る。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  if (!guard.actor.isTenantAdmin) {
    return NextResponse.json({ error: 'tenant_admin only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const issuerUrl = (body as { issuerUrl?: unknown }).issuerUrl;
  if (typeof issuerUrl !== 'string' || !issuerUrl.trim()) {
    return NextResponse.json({ error: 'issuerUrl required' }, { status: 400 });
  }

  const result = await testOidcDiscovery(issuerUrl);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
