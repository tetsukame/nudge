import { NextRequest, NextResponse } from 'next/server';
import { adminPool } from '@/db/pools';
import { getRootSession } from '@/auth/root-guard';
import { listTenants, createTenant, PlatformTenantError } from '@/domain/platform/tenants';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getRootSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const items = await listTenants(adminPool());
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const session = await getRootSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as {
    code?: string; name?: string; keycloakRealm?: string; keycloakIssuerUrl?: string;
  };
  if (!b.code || !b.name || !b.keycloakRealm || !b.keycloakIssuerUrl) {
    return NextResponse.json({ error: 'code/name/keycloakRealm/keycloakIssuerUrl required' }, { status: 400 });
  }
  try {
    const result = await createTenant(adminPool(), {
      code: b.code, name: b.name,
      keycloakRealm: b.keycloakRealm, keycloakIssuerUrl: b.keycloakIssuerUrl,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PlatformTenantError) {
      return NextResponse.json({ error: err.message, code: err.code },
        { status: err.code === 'conflict' ? 409 : 400 });
    }
    throw err;
  }
}
