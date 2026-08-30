/**
 * NDG-115: SCIM Bearer token を発行 (ローテート) する CLI。
 *
 * 用法:
 *   pnpm tsx src/scripts/rotate-scim-token.ts <tenant-code>
 *
 * 出力される平文 token は stdout に 1 度だけ表示される (以降は hash しか
 * 残らない)。IdP (Entra / Okta / SCIM プラグイン等) に登録すること。
 *
 * 既に token がある tenant で実行するとローテートとなり、旧 token は
 * 即座に失効する。
 */
import 'dotenv/config';
import pg from 'pg';
import { resolveTenant } from '../tenant/resolver.js';
import { issueScimToken } from '../scim/token.js';

async function main() {
  const [code] = process.argv.slice(2);
  if (!code) {
    console.error('Usage: tsx src/scripts/rotate-scim-token.ts <tenant-code>');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) {
    console.error('DATABASE_URL_ADMIN is not set');
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: url });
  try {
    const tenant = await resolveTenant(pool, code);
    if (!tenant) {
      console.error(`tenant "${code}" not found`);
      process.exit(1);
    }
    const token = await issueScimToken(pool, tenant.id);
    console.log('');
    console.log(`✅ SCIM token issued for tenant "${tenant.code}" (${tenant.name})`);
    console.log('');
    console.log('   SCIM base URL:');
    console.log(`     https://<your-nudge-host>/t/${tenant.code}/scim/v2`);
    console.log('');
    console.log('   Bearer token (record this now, it will not be shown again):');
    console.log(`     ${token}`);
    console.log('');
    console.log('   Test with:');
    console.log(
      `     curl -H "Authorization: Bearer ${token}" https://<your-nudge-host>/t/${tenant.code}/scim/v2/ServiceProviderConfig`,
    );
    console.log('');
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
