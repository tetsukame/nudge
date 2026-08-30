import { NextRequest } from 'next/server';
import { appPool } from '@/db/pools';
import { requireScimAuth, scimJson, scimJsonError } from '@/scim/guard';
import {
  parseScimUserInput,
  parseScimPatch,
  extractActiveFromPatch,
  serializeUser,
} from '@/scim/schemas';
import {
  getScimUser,
  replaceScimUser,
  setScimUserActive,
  ScimError,
} from '@/domain/scim/users';

export const runtime = 'nodejs';

function locationOf(req: NextRequest, tenantCode: string, userId: string): string {
  const origin = new URL(req.url).origin;
  return `${origin}/t/${tenantCode}/scim/v2/Users/${userId}`;
}

/** GET /t/[code]/scim/v2/Users/{id} */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireScimAuth(req, code);
  if (!guard.ok) return guard.response;

  const user = await getScimUser(appPool(), guard.tenant.id, id);
  if (!user) return scimJsonError(404, 'user not found');
  return scimJson(200, serializeUser(user, locationOf(req, code, user.id)));
}

/** PUT /t/[code]/scim/v2/Users/{id} — 全体置換 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
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
    const user = await replaceScimUser(appPool(), guard.tenant.id, id, input);
    if (!user) return scimJsonError(404, 'user not found');
    return scimJson(200, serializeUser(user, locationOf(req, code, user.id)));
  } catch (err) {
    if (err instanceof ScimError) {
      return scimJsonError(err.status, err.message);
    }
    throw err;
  }
}

/** PATCH /t/[code]/scim/v2/Users/{id} — 実質 active toggle 用 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireScimAuth(req, code);
  if (!guard.ok) return guard.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return scimJsonError(400, 'invalid JSON');
  }
  const patch = parseScimPatch(raw);
  if (!patch) return scimJsonError(400, 'invalid PatchOp payload');

  const active = extractActiveFromPatch(patch);
  if (active === null) {
    // active 以外の op は今のところ no-op。IdP を止めないため 200 で既存を返す。
    const existing = await getScimUser(appPool(), guard.tenant.id, id);
    if (!existing) return scimJsonError(404, 'user not found');
    return scimJson(
      200,
      serializeUser(existing, locationOf(req, code, existing.id)),
    );
  }

  const user = await setScimUserActive(appPool(), guard.tenant.id, id, active);
  if (!user) return scimJsonError(404, 'user not found');
  return scimJson(200, serializeUser(user, locationOf(req, code, user.id)));
}
