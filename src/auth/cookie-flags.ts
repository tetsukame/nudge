/**
 * Determine whether session cookies should be set with the Secure attribute.
 *
 * Production over HTTPS: Secure should be true (browsers reject Secure cookies
 * over HTTP, but production is HTTPS so this is correct).
 *
 * OSS demo over HTTP: Secure must be false because browsers refuse to store
 * Secure cookies over plain HTTP, breaking the OIDC state round-trip.
 *
 * Env precedence:
 *  1. `COOKIE_SECURE=true|false` — explicit override (used by .env.demo to
 *     force false in HTTP demos that still run with NODE_ENV=production).
 *  2. `NODE_ENV === 'production'` — historical default for production deploys.
 */
export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE !== undefined) {
    return process.env.COOKIE_SECURE === 'true';
  }
  return process.env.NODE_ENV === 'production';
}
