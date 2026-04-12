import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

export type KeycloakSetup = {
  container: StartedTestContainer;
  issuerUrl: string;      // e.g. http://localhost:PORT/realms/nudge-test
  realmName: string;
  clientId: string;
  clientSecret: string;
  adminUsername: string;
  adminPassword: string;
  testUserEmail: string;
  testUserPassword: string;
  baseUrl: string;        // e.g. http://localhost:PORT
};

const REALM = 'nudge-test';
const CLIENT_ID = 'nudge-web';
const CLIENT_SECRET = 'test-client-secret';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';
const TEST_USER = 'alice@example.com';
const TEST_PASS = 'alice-pass';

export async function startKeycloak(redirectUri: string): Promise<KeycloakSetup> {
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
    .withStartupTimeout(120_000)
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

  return {
    container,
    issuerUrl: `${baseUrl}/realms/${REALM}`,
    realmName: REALM,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    adminUsername: ADMIN_USER,
    adminPassword: ADMIN_PASS,
    testUserEmail: TEST_USER,
    testUserPassword: TEST_PASS,
    baseUrl,
  };
}

export async function stopKeycloak(setup: KeycloakSetup): Promise<void> {
  await setup.container.stop();
}
