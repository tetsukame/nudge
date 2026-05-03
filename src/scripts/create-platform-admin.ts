/**
 * Bootstrap CLI: 初期 platform admin (root) を作成する。
 * 用法:
 *   tsx src/scripts/create-platform-admin.ts <email> <displayName> <password>
 *
 * 注意:
 * - 既に同じ email の admin が居る場合はエラー
 * - パスワードは 12 文字以上 + 英大小文字 + 数字 + 記号 を満たす必要あり
 * - DATABASE_URL_ADMIN env が必要
 */
import 'dotenv/config';
import pg from 'pg';
import { createPlatformAdmin, PlatformAuthError } from '../domain/platform/auth.js';

async function main() {
  const [email, displayName, password] = process.argv.slice(2);
  if (!email || !displayName || !password) {
    console.error('Usage: tsx src/scripts/create-platform-admin.ts <email> <displayName> <password>');
    process.exit(2);
  }

  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) {
    console.error('DATABASE_URL_ADMIN is not set');
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: url });
  try {
    const { id } = await createPlatformAdmin(pool, { email, displayName, password });
    console.log(`✅ created platform_admin id=${id} email=${email}`);
  } catch (err) {
    if (err instanceof PlatformAuthError) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
    if ((err as { code?: string }).code === '23505') {
      console.error(`❌ email "${email}" already exists`);
      process.exit(1);
    }
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
