/**
 * Build the Microsoft Teams app package from the template.
 *
 * Reads docker/teams/manifest.template.json, substitutes placeholders
 * from environment variables, and writes:
 *   - docker/teams/manifest.json (substituted, gitignored)
 *   - dist/nudge-teams-app.zip (manifest.json + icons, gitignored)
 *
 * Required env vars:
 *   - TEAMS_APP_ID (a fresh GUID, distinct from ENTRA_APP_ID)
 *   - ENTRA_APP_ID (Entra/Azure AD app registration's Application ID)
 *   - NUDGE_DOMAIN (e.g. nudge.example.com, no scheme)
 *   - NUDGE_TENANT_CODE (e.g. dev)
 *   - ORG_NAME (organization display name in manifest)
 *
 * Run with: pnpm tsx scripts/build-teams-manifest.ts
 * Or: pnpm build:teams-manifest
 */
import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import archiver from 'archiver';

const ROOT = process.cwd();
const TEMPLATE_PATH = join(ROOT, 'docker', 'teams', 'manifest.template.json');
const MANIFEST_OUT = join(ROOT, 'docker', 'teams', 'manifest.json');
const DIST_DIR = join(ROOT, 'dist');
const ZIP_OUT = join(DIST_DIR, 'nudge-teams-app.zip');

const REQUIRED_ENV = [
  'TEAMS_APP_ID',
  'ENTRA_APP_ID',
  'NUDGE_DOMAIN',
  'NUDGE_TENANT_CODE',
  'ORG_NAME',
] as const;

async function main(): Promise<void> {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    console.error('Set them in .env or pass via shell. See docs/teams-integration.md.');
    process.exit(1);
  }

  const template = await readFile(TEMPLATE_PATH, 'utf8');
  const substituted = template
    .replaceAll('{{TEAMS_APP_ID}}', process.env.TEAMS_APP_ID!)
    .replaceAll('{{ENTRA_APP_ID}}', process.env.ENTRA_APP_ID!)
    .replaceAll('{{NUDGE_DOMAIN}}', process.env.NUDGE_DOMAIN!)
    .replaceAll('{{NUDGE_TENANT_CODE}}', process.env.NUDGE_TENANT_CODE!)
    .replaceAll('{{ORG_NAME}}', process.env.ORG_NAME!);

  // Validate JSON before writing
  JSON.parse(substituted);

  await writeFile(MANIFEST_OUT, substituted, 'utf8');
  console.log(`✓ wrote ${MANIFEST_OUT}`);

  if (!existsSync(DIST_DIR)) await mkdir(DIST_DIR, { recursive: true });

  const colorPath = join(ROOT, 'docker', 'teams', 'color.png');
  const outlinePath = join(ROOT, 'docker', 'teams', 'outline.png');

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(ZIP_OUT);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(substituted, { name: 'manifest.json' });
    archive.file(colorPath, { name: 'color.png' });
    archive.file(outlinePath, { name: 'outline.png' });
    void archive.finalize();
  });
  console.log(`✓ wrote ${ZIP_OUT}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Open Microsoft Teams (admin or with sideload permissions)');
  console.log('  2. Apps → Manage your apps → Upload an app → Upload for me');
  console.log(`  3. Select ${ZIP_OUT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
