import type { SyncSource, SyncUserRecord } from './types.js';

const PAGE_SIZE = 500;

export class KeycloakSyncSource implements SyncSource {
  private issuerUrl: string;
  private clientId: string;
  private clientSecret: string;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(issuerUrl: string, clientId: string, clientSecret: string) {
    this.issuerUrl = issuerUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private get realmAdminUrl(): string {
    const url = new URL(this.issuerUrl);
    const realmMatch = url.pathname.match(/^\/realms\/(.+)$/);
    if (!realmMatch) throw new Error(`Invalid issuerUrl: ${this.issuerUrl}`);
    return `${url.origin}/admin/realms/${realmMatch[1]}`;
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiresAt > now + 30_000) {
      return this.cachedToken;
    }
    const tokenUrl = `${this.issuerUrl}/protocol/openid-connect/token`;
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to obtain KC admin token: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    this.cachedToken = body.access_token;
    this.tokenExpiresAt = now + ((body.expires_in ?? 300) - 30) * 1000;
    return this.cachedToken;
  }

  private async authedFetch(url: string): Promise<Response> {
    const token = await this.getToken();
    return fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async *fetchAllUsers(): AsyncGenerator<SyncUserRecord[]> {
    let offset = 0;
    while (true) {
      const url = `${this.realmAdminUrl}/users?first=${offset}&max=${PAGE_SIZE}&briefRepresentation=false`;
      const res = await this.authedFetch(url);
      if (!res.ok) throw new Error(`KC users API failed: ${res.status}`);
      const users = (await res.json()) as KcUser[];
      if (users.length === 0) break;
      yield users.map(toSyncRecord);
      if (users.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  async fetchDeltaUsers(since: Date): Promise<SyncUserRecord[]> {
    const dateFrom = since.toISOString().split('.')[0];
    const eventsUrl =
      `${this.realmAdminUrl}/admin-events` +
      `?operationTypes=CREATE&operationTypes=UPDATE&operationTypes=DELETE` +
      `&resourceTypes=USER` +
      `&dateFrom=${dateFrom}`;
    const res = await this.authedFetch(eventsUrl);
    if (!res.ok) throw new Error(`KC admin-events API failed: ${res.status}`);
    const events = (await res.json()) as KcAdminEvent[];

    const userIds = new Map<string, string>();
    for (const event of events) {
      const match = event.resourcePath.match(/^users\/(.+)$/);
      if (!match) continue;
      userIds.set(match[1], event.operationType);
    }

    const results: SyncUserRecord[] = [];
    for (const [userId, opType] of userIds) {
      if (opType === 'DELETE') {
        results.push({ externalId: userId, email: '', displayName: '', active: false });
        continue;
      }
      const userRes = await this.authedFetch(`${this.realmAdminUrl}/users/${userId}`);
      if (!userRes.ok) {
        results.push({ externalId: userId, email: '', displayName: '', active: false });
        continue;
      }
      const user = (await userRes.json()) as KcUser;
      results.push(toSyncRecord(user));
    }
    return results;
  }
}

type KcUser = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
};

type KcAdminEvent = {
  operationType: string;
  resourceType: string;
  resourcePath: string;
  time: number;
};

function toSyncRecord(user: KcUser): SyncUserRecord {
  const first = user.firstName ?? '';
  const last = user.lastName ?? '';
  const displayName = `${first} ${last}`.trim() || user.email || user.id;
  return {
    externalId: user.id,
    email: user.email ?? '',
    displayName,
    active: user.enabled !== false,
  };
}
