import { describe, expect, it, vi, beforeEach } from 'vitest';
import { KeycloakSyncSource } from '../../../src/sync/keycloak-source.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const TOKEN_RESPONSE = { access_token: 'test-token' };

function kcUser(id: string, email: string, first: string, last: string, enabled = true) {
  return { id, email, firstName: first, lastName: last, enabled };
}

describe('KeycloakSyncSource', () => {
  const issuerUrl = 'https://kc.example.com/realms/test';
  let source: KeycloakSyncSource;

  beforeEach(() => {
    mockFetch.mockReset();
    source = new KeycloakSyncSource(issuerUrl, 'nudge-sync', 'secret');
  });

  it('fetchAllUsers pages through results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => TOKEN_RESPONSE,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        kcUser('id-1', 'a@x', 'Alice', 'A'),
        kcUser('id-2', 'b@x', 'Bob', 'B', false),
      ],
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => [],
    });

    const allUsers = [];
    for await (const chunk of source.fetchAllUsers()) {
      allUsers.push(...chunk);
    }
    expect(allUsers).toHaveLength(2);
    expect(allUsers[0]).toEqual({
      externalId: 'id-1', email: 'a@x', displayName: 'Alice A', active: true,
    });
    expect(allUsers[1].active).toBe(false);
  });

  it('fetchDeltaUsers parses admin events', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => TOKEN_RESPONSE,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { operationType: 'CREATE', resourceType: 'USER', resourcePath: 'users/id-new', time: Date.now() },
        { operationType: 'DELETE', resourceType: 'USER', resourcePath: 'users/id-del', time: Date.now() },
      ],
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => kcUser('id-new', 'new@x', 'New', 'User'),
    });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const since = new Date(Date.now() - 3600_000);
    const users = await source.fetchDeltaUsers(since);
    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({ externalId: 'id-new', email: 'new@x', displayName: 'New User', active: true });
    expect(users[1]).toEqual({ externalId: 'id-del', email: '', displayName: '', active: false });
  });

  it('throws on token acquisition failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 401, text: async () => 'Unauthorized',
    });
    const gen = source.fetchAllUsers();
    await expect(gen.next()).rejects.toThrow(/Failed to obtain KC admin token/);
  });
});
