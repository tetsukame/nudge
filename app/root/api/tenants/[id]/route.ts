import { NextRequest, NextResponse } from 'next/server';
import { adminPool } from '@/db/pools';
import { getRootSession } from '@/auth/root-guard';
import { getTenant, updateTenant, upsertSyncConfig } from '@/domain/platform/tenants';
import { mapDomainError } from '@/lib/respond';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getRootSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const t = await getTenant(adminPool(), id);
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(t);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getRootSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as {
    name?: string; keycloakRealm?: string; keycloakIssuerUrl?: string;
    status?: 'active' | 'suspended';
    syncConfig?: {
      enabled?: boolean;
      userSourceType?: 'keycloak' | 'csv' | 'none';
      orgSourceType?: 'keycloak' | 'csv' | 'none';
      orgGroupPrefix?: string | null;
      intervalMinutes?: number;
      syncClientId?: string;
      syncClientSecret?: string;
    };
  };

  try {
    if (b.name !== undefined || b.keycloakRealm !== undefined
        || b.keycloakIssuerUrl !== undefined || b.status !== undefined) {
      await updateTenant(adminPool(), id, {
        name: b.name,
        keycloakRealm: b.keycloakRealm,
        keycloakIssuerUrl: b.keycloakIssuerUrl,
        status: b.status,
      });
    }
    if (b.syncConfig) {
      await upsertSyncConfig(adminPool(), id, b.syncConfig);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
