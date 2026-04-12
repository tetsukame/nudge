import { describe, expect, it } from 'vitest';
import type { NudgeSession } from '../../../src/auth/session.js';
import { sealSession, unsealSession } from '../../../src/auth/session.js';

const password = 'a'.repeat(32);
const sample: NudgeSession = {
  userId: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  tenantCode: 'acme',
  sub: 'kc-sub-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  refreshToken: 'refresh_abc',
  accessTokenExp: 1800000000,
};

describe('session seal/unseal', () => {
  it('round-trips a session', async () => {
    const sealed = await sealSession(sample, password);
    expect(typeof sealed).toBe('string');
    expect(sealed.length).toBeGreaterThan(0);
    const unsealed = await unsealSession(sealed, password);
    expect(unsealed).toEqual(sample);
  });

  it('returns null on tampered data', async () => {
    const sealed = await sealSession(sample, password);
    const tampered = sealed.slice(0, -5) + 'XXXXX';
    const unsealed = await unsealSession(tampered, password);
    expect(unsealed).toBeNull();
  });

  it('returns null on empty input', async () => {
    expect(await unsealSession('', password)).toBeNull();
    expect(await unsealSession(undefined, password)).toBeNull();
  });

  it('returns null on wrong password', async () => {
    const sealed = await sealSession(sample, password);
    const unsealed = await unsealSession(sealed, 'b'.repeat(32));
    expect(unsealed).toBeNull();
  });
});
