import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../../../helpers/pg-container.js';
import {
  authenticatePlatformAdmin,
  createPlatformAdmin,
  validateRootPassword,
  PlatformAuthError,
} from '../../../../src/domain/platform/auth.js';

describe('platform/auth', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  describe('validateRootPassword', () => {
    it('accepts strong password', () => {
      expect(() => validateRootPassword('Abcdef1234!@')).not.toThrow();
    });
    it('rejects too short', () => {
      expect(() => validateRootPassword('Aa1!')).toThrow(/12 characters/);
    });
    it('rejects missing case', () => {
      expect(() => validateRootPassword('abcdef1234!@')).toThrow(/uppercase/);
    });
    it('rejects missing digit', () => {
      expect(() => validateRootPassword('Abcdefghij!@')).toThrow(/digit/);
    });
    it('rejects missing symbol', () => {
      expect(() => validateRootPassword('Abcdef123456')).toThrow(/symbol/);
    });
  });

  describe('createPlatformAdmin / authenticatePlatformAdmin', () => {
    const email = `admin-${Date.now()}@test.dev`;
    const password = 'Strong-Pwd-2026!';
    let createdId: string;

    it('creates a new admin', async () => {
      const r = await createPlatformAdmin(getPool(), {
        email, displayName: 'Test Admin', password,
      });
      expect(r.id).toBeDefined();
      createdId = r.id;
    });

    it('authenticates with correct credentials', async () => {
      const r = await authenticatePlatformAdmin(getPool(), email, password);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.admin.id).toBe(createdId);
        expect(r.admin.email).toBe(email);
      }
    });

    it('rejects wrong password', async () => {
      const r = await authenticatePlatformAdmin(getPool(), email, 'Wrong-Pwd-2026!');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('invalid_credentials');
    });

    it('rejects unknown email', async () => {
      const r = await authenticatePlatformAdmin(getPool(), 'nope@test.dev', password);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('invalid_credentials');
    });

    it('rejects inactive admin', async () => {
      const ie = `ie-${Date.now()}@test.dev`;
      await createPlatformAdmin(getPool(), { email: ie, displayName: 'IE', password });
      await getPool().query(
        `UPDATE platform_admin SET status = 'inactive' WHERE email = $1`,
        [ie],
      );
      const r = await authenticatePlatformAdmin(getPool(), ie, password);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('inactive');
    });

    it('rejects creating with weak password', async () => {
      await expect(
        createPlatformAdmin(getPool(), { email: 'weak@test.dev', displayName: 'W', password: 'weak' }),
      ).rejects.toBeInstanceOf(PlatformAuthError);
    });
  });
});
