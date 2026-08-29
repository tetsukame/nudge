import { describe, it, expect } from 'vitest';
import {
  parseClaimMapping,
  mapClaims,
} from '../../../../src/domain/auth/claim-mapping.js';
import type { UserClaims } from '../../../../src/auth/provider/types.js';

function claims(raw: Record<string, unknown>): UserClaims {
  return {
    sub: (raw.sub as string) ?? 'sub-1',
    email: (raw.email as string) ?? '',
    displayName: (raw.name as string) ?? '',
    groups: Array.isArray(raw.groups)
      ? (raw.groups as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : undefined,
    raw,
  };
}

describe('parseClaimMapping', () => {
  it('returns {} for null/undefined/non-object', () => {
    expect(parseClaimMapping(null)).toEqual({});
    expect(parseClaimMapping(undefined)).toEqual({});
    expect(parseClaimMapping('str')).toEqual({});
    expect(parseClaimMapping(42)).toEqual({});
  });

  it('extracts user and roles fields when present', () => {
    const out = parseClaimMapping({
      user: {
        emailClaim: 'mail',
        displayNameClaim: 'cn',
        displayNameFallbackClaim: 'preferred_username',
      },
      roles: {
        claim: 'groups',
        map: { admins: 'tenant_admin', mgrs: 'manager' },
      },
    });
    expect(out.user?.emailClaim).toBe('mail');
    expect(out.user?.displayNameClaim).toBe('cn');
    expect(out.roles?.map).toEqual({
      admins: 'tenant_admin',
      mgrs: 'manager',
    });
  });

  it('drops non-string map values silently', () => {
    const out = parseClaimMapping({
      roles: { map: { admins: 'tenant_admin', bad: 42 } },
    });
    expect(out.roles?.map).toEqual({ admins: 'tenant_admin' });
  });
});

describe('mapClaims', () => {
  it('uses default claim keys (email/name/preferred_username/groups) when mapping is empty', () => {
    const c = claims({
      sub: 's',
      email: 'a@b.com',
      name: 'Alice',
      groups: ['users'],
    });
    const r = mapClaims(c, {}, 't1');
    expect(r.email).toBe('a@b.com');
    expect(r.displayName).toBe('Alice');
    expect(r.roleAssignments.size).toBe(0); // 'users' は map に無いので無視
  });

  it('falls back to fallback claim when displayNameClaim missing', () => {
    const c = claims({ preferred_username: 'alice_p' });
    const r = mapClaims(c, {}, 't1');
    expect(r.displayName).toBe('alice_p');
  });

  it('respects custom claim key names', () => {
    const c = claims({ mail: 'x@y.com', cn: 'X Y' });
    const r = mapClaims(
      c,
      { user: { emailClaim: 'mail', displayNameClaim: 'cn' } },
      't1',
    );
    expect(r.email).toBe('x@y.com');
    expect(r.displayName).toBe('X Y');
  });

  it('maps groups to Nudge roles via roles.map', () => {
    const c = claims({ groups: ['admins', 'mgrs', 'other'] });
    const r = mapClaims(
      c,
      {
        roles: {
          claim: 'groups',
          map: { admins: 'tenant_admin', mgrs: 'manager' },
        },
      },
      't1',
    );
    expect([...r.roleAssignments].sort()).toEqual(['manager', 'tenant_admin']);
  });

  it('reads custom claim key for roles', () => {
    const c = claims({ roles: ['admins'] });
    const r = mapClaims(
      c,
      { roles: { claim: 'roles', map: { admins: 'tenant_admin' } } },
      't1',
    );
    expect([...r.roleAssignments]).toEqual(['tenant_admin']);
  });

  it('accepts single string role claim as one-element array', () => {
    const c = claims({ groups: 'admins' });
    const r = mapClaims(
      c,
      { roles: { map: { admins: 'tenant_admin' } } },
      't1',
    );
    expect([...r.roleAssignments]).toEqual(['tenant_admin']);
  });

  it('skips unknown Nudge role names in map value', () => {
    const c = claims({ groups: ['admins'] });
    const r = mapClaims(
      c,
      { roles: { map: { admins: 'super_god_king' } } },
      't1',
    );
    expect(r.roleAssignments.size).toBe(0);
  });
});
