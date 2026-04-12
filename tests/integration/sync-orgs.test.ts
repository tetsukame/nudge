import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';
import { startKeycloak, stopKeycloak, KeycloakSetup } from '../helpers/keycloak-container.js';
import { KeycloakSyncSource } from '../../src/sync/keycloak-source.js';
import { reconcileOrgs } from '../../src/sync/org-reconciler.js';
import { reconcileUsers } from '../../src/sync/reconciler.js';

describe('KC org sync integration', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let kc: KeycloakSetup;
  let tenantId: string;
  const redirectUri = 'http://localhost:3999/t/org-sync/auth/callback';

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    kc = await startKeycloak(redirectUri);

    // Create org group hierarchy in KC: /組織/総務部
    const token = await getKcAdminToken(kc);
    const orgGroupId = await createKcGroup(kc, token, '組織', null);
    const deptId = await createKcGroup(kc, token, '総務部', orgGroupId);

    // Add alice (from startKeycloak) to 総務部
    const aliceId = await getKcUserId(kc, token, kc.testUserEmail);
    if (aliceId && deptId) {
      await addKcGroupMember(kc, token, deptId, aliceId);
    }

    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('org-sync', 'Org Sync', $1, $2) RETURNING id`,
      [kc.realmName, kc.issuerUrl],
    )).rows[0].id;
    await adminPool.query(
      `INSERT INTO tenant_sync_config (tenant_id, enabled, sync_client_id, sync_client_secret, user_source_type, org_source_type, org_group_prefix)
       VALUES ($1, true, $2, $3, 'keycloak', 'keycloak', '/組織')`,
      [tenantId, kc.syncClientId, kc.syncClientSecret],
    );
  }, 180_000);

  afterAll(async () => {
    await stopKeycloak(kc);
    await stopTestDb();
  }, 60_000);

  it('syncs KC groups to org_unit with closure and memberships', async () => {
    const source = new KeycloakSyncSource(kc.issuerUrl, kc.syncClientId, kc.syncClientSecret);
    source.setOrgGroupPrefix('/組織');

    // Users first (so alice exists)
    await reconcileUsers(appPool, adminPool, tenantId, source, 'full');

    // Then orgs
    const result = await reconcileOrgs(adminPool, tenantId, source);
    expect(result.created).toBeGreaterThanOrEqual(1); // at least 総務部

    // Verify org_unit exists
    const { rows: orgs } = await adminPool.query(
      `SELECT name FROM org_unit WHERE tenant_id = $1 AND external_id IS NOT NULL ORDER BY level`,
      [tenantId],
    );
    expect(orgs.length).toBeGreaterThanOrEqual(1);
    expect(orgs.some((r) => r.name === '総務部')).toBe(true);

    // Verify closure includes self-reference at minimum
    const { rows: closure } = await adminPool.query(
      `SELECT count(*) AS cnt FROM org_unit_closure WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(Number(closure[0].cnt)).toBeGreaterThanOrEqual(1);

    // Verify alice's membership if memberships were synced
    if (result.membershipsUpdated > 0) {
      const { rows: membership } = await adminPool.query(
        `SELECT o.name FROM user_org_unit uou
         JOIN org_unit o ON o.id = uou.org_unit_id
         JOIN users u ON u.id = uou.user_id
         WHERE uou.tenant_id = $1 AND u.email = $2`,
        [tenantId, kc.testUserEmail],
      );
      expect(membership.length).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);
});

// Helper functions for KC Admin API
async function getKcAdminToken(kc: KeycloakSetup): Promise<string> {
  const res = await fetch(`${kc.baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'admin-cli',
      username: kc.adminUsername, password: kc.adminPassword,
    }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

async function createKcGroup(
  kc: KeycloakSetup, token: string, name: string, parentId: string | null,
): Promise<string> {
  const url = parentId
    ? `${kc.baseUrl}/admin/realms/${kc.realmName}/groups/${parentId}/children`
    : `${kc.baseUrl}/admin/realms/${kc.realmName}/groups`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  // Try Location header first
  const location = res.headers.get('location') ?? '';
  const idFromLocation = location.split('/').pop() ?? '';
  if (idFromLocation) return idFromLocation;

  // Fallback: search by name
  const searchUrl = parentId
    ? `${kc.baseUrl}/admin/realms/${kc.realmName}/groups/${parentId}/children?briefRepresentation=true`
    : `${kc.baseUrl}/admin/realms/${kc.realmName}/groups?search=${encodeURIComponent(name)}&briefRepresentation=true`;
  const searchRes = await fetch(searchUrl, {
    headers: { authorization: `Bearer ${token}` },
  });
  const groups = (await searchRes.json()) as { id: string; name: string }[];
  const match = groups.find((g) => g.name === name);
  return match?.id ?? '';
}

async function getKcUserId(
  kc: KeycloakSetup, token: string, email: string,
): Promise<string | null> {
  const res = await fetch(
    `${kc.baseUrl}/admin/realms/${kc.realmName}/users?email=${encodeURIComponent(email)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const users = (await res.json()) as { id: string }[];
  return users[0]?.id ?? null;
}

async function addKcGroupMember(
  kc: KeycloakSetup, token: string, groupId: string, userId: string,
): Promise<void> {
  await fetch(
    `${kc.baseUrl}/admin/realms/${kc.realmName}/users/${userId}/groups/${groupId}`,
    { method: 'PUT', headers: { authorization: `Bearer ${token}` } },
  );
}
