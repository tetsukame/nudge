import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL_ADMIN: z.string().url().or(z.string().startsWith('postgresql://')),
  DATABASE_URL_APP: z.string().url().or(z.string().startsWith('postgresql://')),
  IRON_SESSION_PASSWORD: z
    .string()
    .min(32, 'IRON_SESSION_PASSWORD must be at least 32 characters'),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI_BASE: z.string().url(),
  SYNC_API_KEY: z.string().min(1).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

let _cached: Config | undefined;

export function loadConfig(): Config {
  if (_cached) return _cached;
  const parsed = ConfigSchema.safeParse({
    DATABASE_URL_ADMIN: process.env.DATABASE_URL_ADMIN,
    DATABASE_URL_APP: process.env.DATABASE_URL_APP,
    IRON_SESSION_PASSWORD: process.env.IRON_SESSION_PASSWORD,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
    OIDC_REDIRECT_URI_BASE: process.env.OIDC_REDIRECT_URI_BASE,
    SYNC_API_KEY: process.env.SYNC_API_KEY,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  _cached = parsed.data;
  return _cached;
}

/**
 * Test helper: reset the cache so tests can change env and re-load.
 */
export function resetConfigCache(): void {
  _cached = undefined;
}
