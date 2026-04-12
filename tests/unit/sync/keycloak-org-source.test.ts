import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { KeycloakSyncSource } from '../../../src/sync/keycloak-source.js';

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
afterAll(() => { globalThis.fetch = originalFetch; });

const TOKEN_RESPONSE = { access_token: 'test-token' };

describe('KeycloakSyncSource OrgSyncSource', () => {
  let source: KeycloakSyncSource;
  beforeEach(() => {
    mockFetch.mockReset();
    source = new KeycloakSyncSource('https://kc.example.com/realms/test', 'nudge-sync', 'secret');
  });

  it('fetchAllOrgs filters by prefix and flattens tree', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => TOKEN_RESPONSE });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'g-org', name: '組織', path: '/組織',
          subGroups: [{
            id: 'g-hq', name: '総務本部', path: '/組織/総務本部',
            subGroups: [{ id: 'g-dept', name: '総務部', path: '/組織/総務本部/総務部', subGroups: [] }],
          }],
        },
        { id: 'g-role', name: '役職', path: '/役職', subGroups: [{ id: 'g-mgr', name: '部長', path: '/役職/部長', subGroups: [] }] },
      ],
    });

    source.setOrgGroupPrefix('/組織');
    const orgs = [];
    for await (const chunk of source.fetchAllOrgs()) { orgs.push(...chunk); }
    expect(orgs).toHaveLength(2);
    expect(orgs[0]).toEqual({ externalId: 'g-hq', name: '総務本部', parentExternalId: null, level: 0 });
    expect(orgs[1]).toEqual({ externalId: 'g-dept', name: '総務部', parentExternalId: 'g-hq', level: 1 });
  });

  it('fetchOrgMemberships retrieves group members', async () => {
    // Token
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => TOKEN_RESPONSE });
    // Groups (for fetchAllOrgs called internally)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{
        id: 'g-org', name: '組織', path: '/組織',
        subGroups: [{ id: 'g-dept', name: 'Dept', path: '/組織/Dept', subGroups: [] }],
      }],
    });
    // Members of g-dept page 1
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => [{ id: 'user-1' }, { id: 'user-2' }],
    });
    // Members page 2 (empty)
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    source.setOrgGroupPrefix('/組織');
    const memberships = [];
    for await (const chunk of source.fetchOrgMemberships()) { memberships.push(...chunk); }
    expect(memberships).toHaveLength(2);
    expect(memberships[0]).toEqual({ orgExternalId: 'g-dept', userExternalId: 'user-1', isPrimary: false });
  });
});
