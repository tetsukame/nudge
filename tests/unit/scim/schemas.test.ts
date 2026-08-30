import { describe, it, expect } from 'vitest';
import {
  parseScimUserInput,
  parseScimPatch,
  extractActiveFromPatch,
  serializeUser,
  scimError,
} from '../../../src/scim/schemas.js';

describe('parseScimUserInput', () => {
  it('returns null for non-object / missing userName', () => {
    expect(parseScimUserInput(null)).toBeNull();
    expect(parseScimUserInput({})).toBeNull();
    expect(parseScimUserInput({ userName: '' })).toBeNull();
  });

  it('extracts userName / active / externalId / emails / name', () => {
    const out = parseScimUserInput({
      userName: 'a@b.com',
      externalId: 'ext-1',
      active: true,
      displayName: 'Alice',
      name: { givenName: 'Alice', familyName: 'B' },
      emails: [{ value: 'a@b.com', primary: true, type: 'work' }],
      schemas: ['urn:ietf:...'],
    });
    expect(out?.userName).toBe('a@b.com');
    expect(out?.externalId).toBe('ext-1');
    expect(out?.active).toBe(true);
    expect(out?.emails?.[0]?.value).toBe('a@b.com');
    expect(out?.name?.familyName).toBe('B');
  });
});

describe('extractActiveFromPatch', () => {
  it('picks up path=active with boolean value', () => {
    const p = parseScimPatch({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', path: 'active', value: false }],
    });
    expect(extractActiveFromPatch(p!)).toBe(false);
  });
  it('picks up path=active with string "False" (Entra style)', () => {
    const p = parseScimPatch({
      schemas: [],
      Operations: [{ op: 'replace', path: 'active', value: 'False' }],
    });
    expect(extractActiveFromPatch(p!)).toBe(false);
  });
  it('picks up path-less with value.active bool', () => {
    const p = parseScimPatch({
      schemas: [],
      Operations: [{ op: 'replace', value: { active: true } }],
    });
    expect(extractActiveFromPatch(p!)).toBe(true);
  });
  it('returns null when no active op', () => {
    const p = parseScimPatch({
      schemas: [],
      Operations: [{ op: 'replace', path: 'displayName', value: 'X' }],
    });
    expect(extractActiveFromPatch(p!)).toBeNull();
  });
});

describe('serializeUser', () => {
  it('produces SCIM User with meta.location', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const r = serializeUser(
      {
        id: 'u1',
        externalId: 'ext1',
        email: 'a@b.com',
        displayName: 'Alice',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      'https://nudge.example.com/t/dev/scim/v2/Users/u1',
    );
    expect(r.userName).toBe('a@b.com');
    expect(r.active).toBe(true);
    expect(r.emails[0]?.primary).toBe(true);
    expect(r.meta.location).toContain('/Users/u1');
    expect(r.meta.resourceType).toBe('User');
  });
});

describe('scimError', () => {
  it('produces SCIM Error shape', () => {
    const e = scimError(409, 'exists', 'uniqueness');
    expect(e.status).toBe('409');
    expect(e.scimType).toBe('uniqueness');
    expect(e.schemas[0]).toContain('Error');
  });
});
