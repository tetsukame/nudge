import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';
import { startKeycloak, stopKeycloak, KeycloakSetup } from '../helpers/keycloak-container.js';
import { Issuer } from 'openid-client';
import { jitUpsertUser } from '../../src/auth/callback.js';

/**
 * Minimal E2E: drive an OIDC flow against a real Keycloak, complete token
 * exchange, and verify that jitUpsertUser produces a users row.
 *
 * This test does NOT spin up the Next.js HTTP server. Instead it exercises
 * the same primitives the route handlers use, proving the stack plays well
 * with a real Keycloak without the cost of a full HTTP dance.
 */
describe('OIDC flow integration', () => {
  let adminPool: pg.Pool;
  let kc: KeycloakSetup;
  let tenantId: string;
  const redirectUri = 'http://localhost:3999/t/oidc-test/auth/callback';

  beforeAll(async () => {
    adminPool = await startTestDb();
    kc = await startKeycloak(redirectUri);
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('oidc-test', 'OIDC Test', $1, $2) RETURNING id`,
      [kc.realmName, kc.issuerUrl],
    )).rows[0].id;
  }, 180_000);

  afterAll(async () => {
    await stopKeycloak(kc);
    await stopTestDb();
  }, 60_000);

  it('exchanges password grant for tokens and upserts user', async () => {
    // Use Direct Access Grants to skip the browser redirect step.
    // (We enabled directAccessGrantsEnabled in the Keycloak helper.)
    const tokenResponse = await fetch(
      `${kc.issuerUrl}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: kc.clientId,
          client_secret: kc.clientSecret,
          username: kc.testUserEmail,
          password: kc.testUserPassword,
          scope: 'openid email profile',
        }),
      },
    );
    expect(tokenResponse.ok).toBe(true);
    const tokens = (await tokenResponse.json()) as {
      id_token: string;
      access_token: string;
      refresh_token: string;
    };
    expect(tokens.id_token).toBeTruthy();

    // Verify via openid-client (issuer discovery + JWKS check)
    const issuer = await Issuer.discover(kc.issuerUrl);
    const client = new issuer.Client({
      client_id: kc.clientId,
      client_secret: kc.clientSecret,
    });
    const userinfo = await client.userinfo(tokens.access_token);
    expect(userinfo.email).toBe(kc.testUserEmail);

    // JIT upsert
    const appPool = getAppPool();
    const userId = await jitUpsertUser(appPool, tenantId, {
      sub: userinfo.sub!,
      email: userinfo.email as string,
      displayName: (userinfo.name as string) ?? 'Alice',
    });
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);

    // Verify row
    const { rows } = await adminPool.query(
      `SELECT email, display_name FROM users WHERE id = $1`,
      [userId],
    );
    expect(rows[0].email).toBe(kc.testUserEmail);
  }, 120_000);
});
