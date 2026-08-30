import { NextRequest } from 'next/server';
import { requireScimAuth, scimJson } from '@/scim/guard';

export const runtime = 'nodejs';

/**
 * NDG-115: SCIM ServiceProviderConfig。IdP が最初に叩いて機能を確認する。
 * 実装している機能だけ supported=true にする。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireScimAuth(req, code);
  if (!guard.ok) return guard.response;

  return scimJson(200, {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri:
      'https://github.com/tetsukame/nudge/blob/main/docs/auth/oidc-generic.md',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'per-tenant static bearer token',
        primary: true,
      },
    ],
    meta: { resourceType: 'ServiceProviderConfig' },
  });
}
