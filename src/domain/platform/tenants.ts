import type pg from 'pg';

export class PlatformTenantError extends Error {
  constructor(
    message: string,
    readonly code: 'validation' | 'not_found' | 'conflict',
  ) {
    super(message);
    this.name = 'PlatformTenantError';
  }
}

export type TenantListItem = {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'suspended';
  keycloakRealm: string;
  keycloakIssuerUrl: string;
  createdAt: string;
  userCount: number;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

export async function listTenants(pool: pg.Pool): Promise<TenantListItem[]> {
  const { rows } = await pool.query<{
    id: string;
    code: string;
    name: string;
    status: 'active' | 'suspended';
    keycloak_realm: string;
    keycloak_issuer_url: string;
    created_at: Date;
    user_count: number;
    sync_enabled: boolean;
    last_sync_at: Date | null;
    last_sync_error: string | null;
  }>(
    `SELECT t.id, t.code, t.name, t.status, t.keycloak_realm, t.keycloak_issuer_url,
            t.created_at,
            (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.status = 'active') AS user_count,
            COALESCE(sc.enabled, false) AS sync_enabled,
            GREATEST(sc.last_full_synced_at, sc.last_delta_synced_at) AS last_sync_at,
            sc.last_error AS last_sync_error
       FROM tenant t
       LEFT JOIN tenant_sync_config sc ON sc.tenant_id = t.id
      ORDER BY t.code ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    status: r.status,
    keycloakRealm: r.keycloak_realm,
    keycloakIssuerUrl: r.keycloak_issuer_url,
    createdAt: new Date(r.created_at).toISOString(),
    userCount: r.user_count,
    syncEnabled: r.sync_enabled,
    lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
    lastSyncError: r.last_sync_error,
  }));
}

export type TenantDetail = TenantListItem & {
  syncConfig: {
    userSourceType: 'keycloak' | 'csv' | 'none';
    orgSourceType: 'keycloak' | 'csv' | 'none';
    orgGroupPrefix: string | null;
    intervalMinutes: number;
    hasClientId: boolean;
    hasClientSecret: boolean;
  } | null;
};

export async function getTenant(pool: pg.Pool, id: string): Promise<TenantDetail | null> {
  const { rows } = await pool.query<{
    id: string;
    code: string;
    name: string;
    status: 'active' | 'suspended';
    keycloak_realm: string;
    keycloak_issuer_url: string;
    created_at: Date;
    user_count: number;
    sc_enabled: boolean | null;
    sc_user_source_type: string | null;
    sc_org_source_type: string | null;
    sc_org_group_prefix: string | null;
    sc_interval_minutes: number | null;
    sc_client_id: string | null;
    sc_client_secret: string | null;
    sc_last_full: Date | null;
    sc_last_delta: Date | null;
    sc_last_error: string | null;
  }>(
    `SELECT t.id, t.code, t.name, t.status, t.keycloak_realm, t.keycloak_issuer_url, t.created_at,
            (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.status = 'active') AS user_count,
            sc.enabled AS sc_enabled,
            sc.user_source_type AS sc_user_source_type,
            sc.org_source_type AS sc_org_source_type,
            sc.org_group_prefix AS sc_org_group_prefix,
            sc.interval_minutes AS sc_interval_minutes,
            sc.sync_client_id AS sc_client_id,
            sc.sync_client_secret AS sc_client_secret,
            sc.last_full_synced_at AS sc_last_full,
            sc.last_delta_synced_at AS sc_last_delta,
            sc.last_error AS sc_last_error
       FROM tenant t
       LEFT JOIN tenant_sync_config sc ON sc.tenant_id = t.id
      WHERE t.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const lastSyncAt = r.sc_last_full && r.sc_last_delta
    ? (r.sc_last_full > r.sc_last_delta ? r.sc_last_full : r.sc_last_delta)
    : (r.sc_last_full ?? r.sc_last_delta);
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    status: r.status,
    keycloakRealm: r.keycloak_realm,
    keycloakIssuerUrl: r.keycloak_issuer_url,
    createdAt: new Date(r.created_at).toISOString(),
    userCount: r.user_count,
    syncEnabled: r.sc_enabled ?? false,
    lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null,
    lastSyncError: r.sc_last_error,
    syncConfig: r.sc_enabled !== null
      ? {
          userSourceType: (r.sc_user_source_type as 'keycloak' | 'csv' | 'none') ?? 'none',
          orgSourceType: (r.sc_org_source_type as 'keycloak' | 'csv' | 'none') ?? 'none',
          orgGroupPrefix: r.sc_org_group_prefix,
          intervalMinutes: r.sc_interval_minutes ?? 60,
          hasClientId: r.sc_client_id != null && r.sc_client_id.length > 0,
          hasClientSecret: r.sc_client_secret != null && r.sc_client_secret.length > 0,
        }
      : null,
  };
}

export type CreateTenantInput = {
  code: string;
  name: string;
  keycloakRealm: string;
  keycloakIssuerUrl: string;
};

export async function createTenant(
  pool: pg.Pool,
  input: CreateTenantInput,
): Promise<{ id: string }> {
  const code = input.code.trim();
  const name = input.name.trim();
  const realm = input.keycloakRealm.trim();
  const issuer = input.keycloakIssuerUrl.trim();
  if (!/^[a-z0-9-]{2,30}$/.test(code)) {
    throw new PlatformTenantError('code must be 2-30 lowercase alphanumeric or hyphen', 'validation');
  }
  if (!name || !realm || !issuer) {
    throw new PlatformTenantError('name / realm / issuer required', 'validation');
  }
  if (!issuer.startsWith('http')) {
    throw new PlatformTenantError('issuer must be http(s) URL', 'validation');
  }
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [code, name, realm, issuer],
    );
    return { id: rows[0].id };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new PlatformTenantError(`tenant code "${code}" already exists`, 'conflict');
    }
    throw err;
  }
}

export type UpdateTenantInput = {
  name?: string;
  keycloakRealm?: string;
  keycloakIssuerUrl?: string;
  status?: 'active' | 'suspended';
};

export async function updateTenant(
  pool: pg.Pool,
  id: string,
  input: UpdateTenantInput,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new PlatformTenantError('name cannot be empty', 'validation');
    values.push(input.name.trim());
    fields.push(`name = $${values.length}`);
  }
  if (input.keycloakRealm !== undefined) {
    if (!input.keycloakRealm.trim()) throw new PlatformTenantError('realm cannot be empty', 'validation');
    values.push(input.keycloakRealm.trim());
    fields.push(`keycloak_realm = $${values.length}`);
  }
  if (input.keycloakIssuerUrl !== undefined) {
    if (!input.keycloakIssuerUrl.startsWith('http')) {
      throw new PlatformTenantError('issuer must be http(s) URL', 'validation');
    }
    values.push(input.keycloakIssuerUrl.trim());
    fields.push(`keycloak_issuer_url = $${values.length}`);
  }
  if (input.status !== undefined) {
    if (input.status !== 'active' && input.status !== 'suspended') {
      throw new PlatformTenantError('status must be active|suspended', 'validation');
    }
    values.push(input.status);
    fields.push(`status = $${values.length}`);
  }
  if (fields.length === 0) return;
  values.push(id);
  const { rowCount } = await pool.query(
    `UPDATE tenant SET ${fields.join(', ')} WHERE id = $${values.length}`,
    values,
  );
  if (rowCount === 0) {
    throw new PlatformTenantError('tenant not found', 'not_found');
  }
}

export type UpdateSyncConfigInput = {
  enabled?: boolean;
  userSourceType?: 'keycloak' | 'csv' | 'none';
  orgSourceType?: 'keycloak' | 'csv' | 'none';
  orgGroupPrefix?: string | null;
  intervalMinutes?: number;
  syncClientId?: string;
  syncClientSecret?: string;
};

export async function upsertSyncConfig(
  pool: pg.Pool,
  tenantId: string,
  input: UpdateSyncConfigInput,
): Promise<void> {
  // tenant_sync_config 行が無ければ挿入、あれば部分更新
  const { rows: existing } = await pool.query(
    `SELECT 1 FROM tenant_sync_config WHERE tenant_id = $1`,
    [tenantId],
  );
  if (existing.length === 0) {
    await pool.query(
      `INSERT INTO tenant_sync_config (
         tenant_id, enabled, user_source_type, org_source_type,
         org_group_prefix, interval_minutes, sync_client_id, sync_client_secret
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenantId,
        input.enabled ?? false,
        input.userSourceType ?? 'keycloak',
        input.orgSourceType ?? 'none',
        input.orgGroupPrefix ?? null,
        input.intervalMinutes ?? 60,
        input.syncClientId ?? null,
        input.syncClientSecret ?? null,
      ],
    );
    return;
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.enabled !== undefined) { values.push(input.enabled); fields.push(`enabled = $${values.length}`); }
  if (input.userSourceType !== undefined) { values.push(input.userSourceType); fields.push(`user_source_type = $${values.length}`); }
  if (input.orgSourceType !== undefined) { values.push(input.orgSourceType); fields.push(`org_source_type = $${values.length}`); }
  if (input.orgGroupPrefix !== undefined) { values.push(input.orgGroupPrefix); fields.push(`org_group_prefix = $${values.length}`); }
  if (input.intervalMinutes !== undefined) { values.push(input.intervalMinutes); fields.push(`interval_minutes = $${values.length}`); }
  if (input.syncClientId !== undefined) { values.push(input.syncClientId); fields.push(`sync_client_id = $${values.length}`); }
  if (input.syncClientSecret !== undefined) { values.push(input.syncClientSecret); fields.push(`sync_client_secret = $${values.length}`); }
  if (fields.length === 0) return;
  fields.push(`updated_at = now()`);
  values.push(tenantId);
  await pool.query(
    `UPDATE tenant_sync_config SET ${fields.join(', ')} WHERE tenant_id = $${values.length}`,
    values,
  );
}
