import { NextRequest } from 'next/server';
import { appPool } from '@/db/pools';
import { requireScimAuth, scimJson, scimJsonError } from '@/scim/guard';
import { parseScimUserInput, serializeUser } from '@/scim/schemas';
import type { ScimListResponse, ScimUserResource } from '@/scim/schemas';
import {
  createScimUser,
  listScimUsers,
  ScimError,
} from '@/domain/scim/users';

export const runtime = 'nodejs';

function locationOf(req: NextRequest, tenantCode: string, userId: string): string {
  const origin = new URL(req.url).origin;
  return `${origin}/t/${tenantCode}/scim/v2/Users/${userId}`;
}

/**
 * GET /t/[code]/scim/v2/Users?filter=userName eq "..."
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireScimAuth(req, code);
  if (!guard.ok) return guard.response;
  const filter = req.nextUrl.searchParams.get('filter') ?? undefined;
  const users = await listScimUsers(appPool(), guard.tenant.id, filter);
  const resources: ScimUserResource[] = users.map((u) =>
    serializeUser(u, locationOf(req, code, u.id)),
  );
  const body: ScimListResponse<ScimUserResource> = {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: resources.length,
    Resources: resources,
    startIndex: 1,
    itemsPerPage: resources.length,
  };
  return scimJson(200, body);
}

/**
 * POST /t/[code]/scim/v2/Users
 * body: SCIM User (userName + emails + active + externalId)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireScimAuth(req, code);
  if (!guard.ok) return guard.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return scimJsonError(400, 'invalid JSON');
  }
  const input = parseScimUserInput(raw);
  if (!input) return scimJsonError(400, 'invalid User payload');

  try {
    const user = await createScimUser(appPool(), guard.tenant.id, input);
    const resource = serializeUser(user, locationOf(req, code, user.id));
    return scimJson(201, resource);
  } catch (err) {
    if (err instanceof ScimError) {
      return scimJsonError(err.status, err.message, err.scimType ? { 'X-SCIM-Type': err.scimType } : undefined);
    }
    throw err;
  }
}
