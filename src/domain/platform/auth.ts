import type pg from 'pg';
import bcrypt from 'bcryptjs';

export class PlatformAuthError extends Error {
  constructor(message: string, readonly code: 'invalid_credentials' | 'inactive' | 'validation') {
    super(message);
    this.name = 'PlatformAuthError';
  }
}

export type PlatformAdminAccount = {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'inactive';
  createdAt: string;
  lastLoginAt: string | null;
};

const BCRYPT_COST = 12;

/**
 * v0.13 確定: 12 文字以上 + 英大小文字 + 数字 + 記号 (root admin パスワード強度)
 */
export function validateRootPassword(plain: string): void {
  if (plain.length < 12) {
    throw new PlatformAuthError('password must be at least 12 characters', 'validation');
  }
  if (!/[a-z]/.test(plain) || !/[A-Z]/.test(plain) || !/[0-9]/.test(plain)) {
    throw new PlatformAuthError(
      'password must contain lowercase, uppercase, and digit characters',
      'validation',
    );
  }
  if (!/[!-/:-@[-`{-~]/.test(plain)) {
    throw new PlatformAuthError(
      'password must contain at least one symbol',
      'validation',
    );
  }
}

export async function hashPassword(plain: string): Promise<string> {
  validateRootPassword(plain);
  return bcrypt.hash(plain, BCRYPT_COST);
}

export type LoginResult = {
  ok: true;
  admin: PlatformAdminAccount;
} | {
  ok: false;
  error: 'invalid_credentials' | 'inactive';
};

/**
 * email + password で認証。成功時は last_login_at を更新する。
 * 失敗理由は呼び出し元には公開しない（タイミング攻撃防止のため誤指定とアカウント無効を区別しない）。
 */
export async function authenticatePlatformAdmin(
  pool: pg.Pool,
  email: string,
  password: string,
): Promise<LoginResult> {
  const { rows } = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
    status: 'active' | 'inactive';
    created_at: Date;
    last_login_at: Date | null;
  }>(
    `SELECT id, email, display_name, password_hash, status, created_at, last_login_at
       FROM platform_admin
      WHERE lower(email) = lower($1)
      LIMIT 1`,
    [email],
  );

  if (rows.length === 0) {
    // 同程度の処理時間にするためダミー比較
    await bcrypt.compare(password, '$2b$12$abcdefghijklmnopqrstuv');
    return { ok: false, error: 'invalid_credentials' };
  }
  const row = rows[0];
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    return { ok: false, error: 'invalid_credentials' };
  }
  if (row.status !== 'active') {
    return { ok: false, error: 'inactive' };
  }

  await pool.query(
    `UPDATE platform_admin SET last_login_at = now() WHERE id = $1`,
    [row.id],
  );

  return {
    ok: true,
    admin: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    },
  };
}

export async function createPlatformAdmin(
  pool: pg.Pool,
  input: { email: string; displayName: string; password: string },
): Promise<{ id: string }> {
  if (!input.email.trim() || !input.email.includes('@')) {
    throw new PlatformAuthError('valid email required', 'validation');
  }
  if (!input.displayName.trim()) {
    throw new PlatformAuthError('display name required', 'validation');
  }
  const hash = await hashPassword(input.password);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO platform_admin (email, display_name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [input.email.trim(), input.displayName.trim(), hash],
  );
  return { id: rows[0].id };
}
