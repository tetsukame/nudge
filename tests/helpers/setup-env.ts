/**
 * Vitest setup file: inject the minimum env vars required by loadConfig()
 * so that route handlers can be imported and exercised in integration tests
 * without a real Keycloak or production database.
 *
 * DATABASE_URL_ADMIN and DATABASE_URL_APP are set dynamically by
 * startTestDb() in pg-container.ts once the test container is running.
 */

// Provide placeholder values for fields that loadConfig() validates but that
// integration tests don't exercise (OIDC endpoints, sync key, etc.).
if (!process.env.IRON_SESSION_PASSWORD) {
  process.env.IRON_SESSION_PASSWORD = 'test-iron-session-password-at-least-32-chars!';
}
if (!process.env.OIDC_CLIENT_ID) {
  process.env.OIDC_CLIENT_ID = 'nudge-web-test';
}
if (!process.env.OIDC_CLIENT_SECRET) {
  process.env.OIDC_CLIENT_SECRET = 'test-oidc-secret';
}
if (!process.env.OIDC_REDIRECT_URI_BASE) {
  process.env.OIDC_REDIRECT_URI_BASE = 'http://localhost:3000';
}
// DATABASE_URL_ADMIN and DATABASE_URL_APP are intentionally left unset here;
// startTestDb() sets them to the testcontainer URIs at runtime.
