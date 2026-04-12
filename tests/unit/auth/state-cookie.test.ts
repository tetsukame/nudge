import { describe, expect, it } from 'vitest';
import type { OidcState } from '../../../src/auth/state-cookie.js';
import { sealOidcState, unsealOidcState } from '../../../src/auth/state-cookie.js';

const password = 'b'.repeat(32);
const sample: OidcState = {
  state: 'random-state-abc',
  codeVerifier: 'random-verifier-xyz',
  nonce: 'random-nonce',
  returnTo: '/dashboard',
};

describe('oidc state cookie', () => {
  it('round-trips state', async () => {
    const sealed = await sealOidcState(sample, password);
    const unsealed = await unsealOidcState(sealed, password);
    expect(unsealed).toEqual(sample);
  });

  it('returns null on missing value', async () => {
    expect(await unsealOidcState(undefined, password)).toBeNull();
  });

  it('returns null on tampered value', async () => {
    const sealed = await sealOidcState(sample, password);
    const bad = sealed.slice(0, -3) + 'zzz';
    expect(await unsealOidcState(bad, password)).toBeNull();
  });
});
