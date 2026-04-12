import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

export type KeycloakSetup = {
  container: StartedTestContainer;
  issuerUrl: string;      // e.g. http://localhost:PORT/realms/nudge-test
  realmName: string;
  clientId: string;
  clientSecret: string;
  syncClientId: string;
  syncClientSecret: string;
  adminUsername: string;
  adminPassword: string;
  testUserEmail: string;
  testUserPassword: string;
  baseUrl: string;        // e.g. http://localhost:PORT
};

const REALM = 'nudge-test';
const CLIENT_ID = 'nudge-web';
const CLIENT_SECRET = 'test-client-secret';
const SYNC_CLIENT_ID = 'nudge-sync';
const SYNC_CLIENT_SECRET = 'test-sync-secret';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';
const TEST_USER = 'alice@example.com';
const TEST_PASS = 'alice-pass';

const _global = globalThis as unknown as { __kcSetup?: KeycloakSetup };

export async function startKeycloak(redirectUri: string): Promise<KeycloakSetup> {
  if (_global.__kcSetup) return _global.__kcSetup;
  const container = await new GenericContainer('quay.io/keycloak/keycloak:26.0')
    .withEnvironment({
      KC_BOOTSTRAP_ADMIN_USERNAME: ADMIN_USER,
      KC_BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASS,
    })
    .withCommand(['start-dev', '--http-port=8080'])
    .withExposedPorts(8080)
    .withWaitStrategy(
      Wait.forHttp('/realms/master/.well-known/openid-configuration', 8080)
        .forStatusCode(200),
    )
    .withStartupTimeout(180_000)
    .start();

  const baseUrl = `http://${container.getHost()}:${container.getMappedPort(8080)}`;

  // Get admin token
  const tokenRes = await fetch(
    `${baseUrl}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: ADMIN_USER,
        password: ADMIN_PASS,
      }),
    },
  );
  if (!tokenRes.ok) {
    throw new Error(`Failed to obtain admin token: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const authed = (init: RequestInit = {}) => ({
    ...init,
    headers: {
      authorization: `Bearer ${access_token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });

  // Create realm
  const createRealm = await fetch(`${baseUrl}/admin/realms`, authed({
    method: 'POST',
    body: JSON.stringify({ realm: REALM, enabled: true }),
  }));
  if (!createRealm.ok && createRealm.status !== 409) {
    throw new Error(`Failed to create realm: ${createRealm.status} ${await createRealm.text()}`);
  }

  // Create client
  const createClient = await fetch(`${baseUrl}/admin/realms/${REALM}/clients`, authed({
    method: 'POST',
    body: JSON.stringify({
      clientId: CLIENT_ID,
      secret: CLIENT_SECRET,
      redirectUris: [redirectUri],
      publicClient: false,
      directAccessGrantsEnabled: true,
      standardFlowEnabled: true,
      serviceAccountsEnabled: false,
      protocol: 'openid-connect',
    }),
  }));
  if (!createClient.ok && createClient.status !== 409) {
    throw new Error(`Failed to create client: ${createClient.status} ${await createClient.text()}`);
  }

  // Create user
  const createUser = await fetch(`${baseUrl}/admin/realms/${REALM}/users`, authed({
    method: 'POST',
    body: JSON.stringify({
      username: TEST_USER,
      email: TEST_USER,
      firstName: 'Alice',
      lastName: 'Example',
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: TEST_PASS, temporary: false }],
    }),
  }));
  if (!createUser.ok && createUser.status !== 409) {
    throw new Error(`Failed to create user: ${createUser.status} ${await createUser.text()}`);
  }

  // Create sync client (service account enabled)
  const syncClientRes = await fetch(`${baseUrl}/admin/realms/${REALM}/clients`, authed({
    method: 'POST',
    body: JSON.stringify({
      clientId: SYNC_CLIENT_ID,
      secret: SYNC_CLIENT_SECRET,
      publicClient: false,
      serviceAccountsEnabled: true,
      directAccessGrantsEnabled: false,
      standardFlowEnabled: false,
      protocol: 'openid-connect',
    }),
  }));
  if (!syncClientRes.ok && syncClientRes.status !== 409) {
    throw new Error(`Failed to create sync client: ${syncClientRes.status}`);
  }

  // Assign view-users + view-events roles to the sync client's service account
  const clientsListRes = await fetch(
    `${baseUrl}/admin/realms/${REALM}/clients?clientId=${SYNC_CLIENT_ID}`,
    authed(),
  );
  const clientsList = (await clientsListRes.json()) as { id: string }[];
  const syncInternalId = clientsList[0]?.id;

  if (syncInternalId) {
    const saUserRes = await fetch(
      `${baseUrl}/admin/realms/${REALM}/clients/${syncInternalId}/service-account-user`,
      authed(),
    );
    const saUser = (await saUserRes.json()) as { id: string };

    const rmListRes = await fetch(
      `${baseUrl}/admin/realms/${REALM}/clients?clientId=realm-management`,
      authed(),
    );
    const rmList = (await rmListRes.json()) as { id: string }[];
    const rmId = rmList[0]?.id;

    if (rmId) {
      const rolesRes = await fetch(
        `${baseUrl}/admin/realms/${REALM}/clients/${rmId}/roles`,
        authed(),
      );
      const allRoles = (await rolesRes.json()) as { id: string; name: string }[];
      const rolesToAssign = allRoles.filter(
        (r) => r.name === 'view-users' || r.name === 'view-events',
      );
      if (rolesToAssign.length > 0) {
        await fetch(
          `${baseUrl}/admin/realms/${REALM}/users/${saUser.id}/role-mappings/clients/${rmId}`,
          authed({
            method: 'POST',
            body: JSON.stringify(rolesToAssign),
          }),
        );
      }
    }
  }

  // Enable admin events on the realm
  await fetch(`${baseUrl}/admin/realms/${REALM}`, authed({
    method: 'PUT',
    body: JSON.stringify({
      realm: REALM,
      adminEventsEnabled: true,
      adminEventsDetailsEnabled: true,
      eventsExpiration: 86400,
    }),
  }));

  _global.__kcSetup = {
    container,
    issuerUrl: `${baseUrl}/realms/${REALM}`,
    realmName: REALM,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    syncClientId: SYNC_CLIENT_ID,
    syncClientSecret: SYNC_CLIENT_SECRET,
    adminUsername: ADMIN_USER,
    adminPassword: ADMIN_PASS,
    testUserEmail: TEST_USER,
    testUserPassword: TEST_PASS,
    baseUrl,
  };
  return _global.__kcSetup;
}

export async function stopKeycloak(_setup: KeycloakSetup): Promise<void> {
  // No-op: the singleton container is reused across test files and cleaned up
  // automatically by testcontainers' resource reaper when the process exits.
}

export async function kcCreateUser(
  setup: KeycloakSetup,
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const token = await getAdminToken(setup);
  const res = await fetch(`${setup.baseUrl}/admin/realms/${setup.realmName}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      username: email,
      email,
      firstName,
      lastName,
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: 'test', temporary: false }],
    }),
  });
  const location = res.headers.get('location') ?? '';
  return location.split('/').pop() ?? '';
}

export async function kcDeleteUser(setup: KeycloakSetup, userId: string): Promise<void> {
  const token = await getAdminToken(setup);
  await fetch(`${setup.baseUrl}/admin/realms/${setup.realmName}/users/${userId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
}

async function getAdminToken(setup: KeycloakSetup): Promise<string> {
  const res = await fetch(`${setup.baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: setup.adminUsername,
      password: setup.adminPassword,
    }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}
