import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import { logger } from '../../lib/logger';
import type { ScimUserInput, NudgeUserRow } from '../../scim/schemas';

/**
 * NDG-115 (v0.26): SCIM /Users の DB 操作。
 *
 * externalId が SCIM 上のユーザー識別子 (IdP 側の stable ID)。
 * Nudge は users.keycloak_sub に "scim:<externalId>" 名前空間で保存する
 * (KC 経由 pull sync / OIDC login / emergency login と衝突しない)。
 *
 * SCIM は tenant 内でユーザーを create/replace/deactivate する。実装は
 * 冪等性優先: 同じ externalId で 2 回 POST が来たら 409 で既存を返す (RFC
 * 7644 §3.3 準拠)。
 */

export class ScimError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly scimType?: string,
  ) {
    super(message);
    this.name = 'ScimError';
  }
}

const NAMESPACE_PREFIX = 'scim:';

function primaryEmail(input: ScimUserInput): string {
  if (input.emails && input.emails.length > 0) {
    const primary = input.emails.find((e) => e.primary && e.value);
    if (primary?.value) return primary.value;
    const anyEmail = input.emails.find((e) => e.value)?.value;
    if (anyEmail) return anyEmail;
  }
  // fallback: userName が email 形式ならそれを使う (Entra 等の一般的な運用)
  if (input.userName.includes('@')) return input.userName;
  throw new ScimError('email required', 400, 'invalidValue');
}

function displayName(input: ScimUserInput, email: string): string {
  if (input.displayName?.trim()) return input.displayName.trim();
  if (input.name?.formatted?.trim()) return input.name.formatted.trim();
  const gn = input.name?.givenName?.trim();
  const fn = input.name?.familyName?.trim();
  if (fn && gn) return `${fn} ${gn}`;
  if (fn) return fn;
  if (gn) return gn;
  return email;
}

function externalId(input: ScimUserInput): string {
  const ext = input.externalId?.trim() || input.userName.trim();
  if (!ext) throw new ScimError('externalId or userName required', 400, 'invalidValue');
  return ext;
}

function rowToUser(row: {
  id: string;
  keycloak_sub: string;
  email: string;
  display_name: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}): NudgeUserRow {
  return {
    id: row.id,
    externalId: row.keycloak_sub.startsWith(NAMESPACE_PREFIX)
      ? row.keycloak_sub.slice(NAMESPACE_PREFIX.length)
      : row.keycloak_sub,
    email: row.email,
    displayName: row.display_name,
    active: row.status === 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * POST /Users 実装。externalId で既存判定して 409 or 新規作成。
 */
export async function createScimUser(
  appPool: pg.Pool,
  tenantId: string,
  input: ScimUserInput,
): Promise<NudgeUserRow> {
  const email = primaryEmail(input);
  const ext = externalId(input);
  const sub = NAMESPACE_PREFIX + ext;
  const dn = displayName(input, email);
  const active = input.active !== false;

  return withTenant(appPool, tenantId, async (client) => {
    const existing = await client.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND keycloak_sub = $2`,
      [tenantId, sub],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new ScimError(
        `user with externalId ${ext} already exists`,
        409,
        'uniqueness',
      );
    }
    const { rows } = await client.query<{
      id: string;
      keycloak_sub: string;
      email: string;
      display_name: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, keycloak_sub, email, display_name, status, created_at, updated_at`,
      [tenantId, sub, email, dn, active ? 'active' : 'inactive'],
    );
    logger.info({ tenantId, userId: rows[0].id, externalId: ext }, 'SCIM user created');
    return rowToUser(rows[0]);
  });
}

export async function getScimUser(
  appPool: pg.Pool,
  tenantId: string,
  userId: string,
): Promise<NudgeUserRow | null> {
  return withTenant(appPool, tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      keycloak_sub: string;
      email: string;
      display_name: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, keycloak_sub, email, display_name, status, created_at, updated_at
       FROM users WHERE tenant_id = $1 AND id = $2`,
      [tenantId, userId],
    );
    return rows.length > 0 ? rowToUser(rows[0]) : null;
  });
}

/**
 * PUT /Users/{id} 実装。既存行を input で全体置換 (email / displayName / active)。
 */
export async function replaceScimUser(
  appPool: pg.Pool,
  tenantId: string,
  userId: string,
  input: ScimUserInput,
): Promise<NudgeUserRow | null> {
  const email = primaryEmail(input);
  const dn = displayName(input, email);
  const active = input.active !== false;

  return withTenant(appPool, tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      keycloak_sub: string;
      email: string;
      display_name: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE users
          SET email = $3,
              display_name = $4,
              status = $5,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, keycloak_sub, email, display_name, status, created_at, updated_at`,
      [tenantId, userId, email, dn, active ? 'active' : 'inactive'],
    );
    if (rows.length === 0) return null;
    logger.info({ tenantId, userId, active }, 'SCIM user replaced');
    return rowToUser(rows[0]);
  });
}

/**
 * PATCH /Users/{id} active 単項目更新。他の Op は今のところ no-op。
 */
export async function setScimUserActive(
  appPool: pg.Pool,
  tenantId: string,
  userId: string,
  active: boolean,
): Promise<NudgeUserRow | null> {
  return withTenant(appPool, tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      keycloak_sub: string;
      email: string;
      display_name: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE users
          SET status = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, keycloak_sub, email, display_name, status, created_at, updated_at`,
      [tenantId, userId, active ? 'active' : 'inactive'],
    );
    if (rows.length === 0) return null;
    logger.info({ tenantId, userId, active }, 'SCIM user active updated');
    return rowToUser(rows[0]);
  });
}

/**
 * GET /Users?filter=userName eq "..." など。IdP は基本 externalId or userName
 * での dedup 検索しか投げないので、簡易 filter パーサで十分。
 * filter が無ければ 100 件以内で全件返す。
 */
export async function listScimUsers(
  appPool: pg.Pool,
  tenantId: string,
  filter?: string,
): Promise<NudgeUserRow[]> {
  const parsed = parseSimpleFilter(filter);
  return withTenant(appPool, tenantId, async (client) => {
    let sql = `SELECT id, keycloak_sub, email, display_name, status, created_at, updated_at
               FROM users WHERE tenant_id = $1`;
    const params: unknown[] = [tenantId];
    if (parsed?.field === 'userName') {
      params.push(parsed.value);
      sql += ` AND email = $${params.length}`;
    } else if (parsed?.field === 'externalId') {
      params.push(NAMESPACE_PREFIX + parsed.value);
      sql += ` AND keycloak_sub = $${params.length}`;
    }
    sql += ' ORDER BY created_at LIMIT 100';
    const { rows } = await client.query<{
      id: string;
      keycloak_sub: string;
      email: string;
      display_name: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(sql, params);
    return rows.map(rowToUser);
  });
}

/**
 * SCIM filter は結構複雑だが、実運用で IdP が投げるのは
 * `userName eq "x"` / `externalId eq "y"` くらい。それだけサポート。
 * 該当しない filter は無視 (parsed=null) して全件検索にフォールバック。
 */
export function parseSimpleFilter(
  filter?: string,
): { field: 'userName' | 'externalId'; value: string } | null {
  if (!filter) return null;
  // e.g. userName eq "x@y.com"
  const m = filter.match(/^(userName|externalId)\s+eq\s+"([^"]*)"$/i);
  if (!m) return null;
  const field = m[1].toLowerCase() === 'username' ? 'userName' : 'externalId';
  return { field, value: m[2] };
}
