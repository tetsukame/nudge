import { describe, expect, it } from 'vitest';
import { verifySyncAuth } from '../../../src/sync/api-auth.js';

describe('verifySyncAuth', () => {
  it('accepts valid API key', () => {
    const result = verifySyncAuth('Bearer my-key', null, 'my-key');
    expect(result.ok).toBe(true);
  });

  it('rejects wrong API key', () => {
    const result = verifySyncAuth('Bearer wrong', null, 'my-key');
    expect(result.ok).toBe(false);
  });

  it('rejects missing auth when no API key configured', () => {
    const result = verifySyncAuth(null, null, undefined);
    expect(result.ok).toBe(false);
  });

  it('accepts tenant_admin session', () => {
    const result = verifySyncAuth(null, { roles: ['tenant_admin'] }, undefined);
    expect(result.ok).toBe(true);
  });

  it('rejects non-admin session', () => {
    const result = verifySyncAuth(null, { roles: [] }, undefined);
    expect(result.ok).toBe(false);
  });
});
