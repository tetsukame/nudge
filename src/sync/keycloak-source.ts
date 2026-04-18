import type { SyncSource, SyncUserRecord, OrgSyncSource, SyncOrgRecord, OrgMembership } from './types';

const PAGE_SIZE = 500;

export class KeycloakSyncSource implements SyncSource, OrgSyncSource {
  private issuerUrl: string;
  private clientId: string;
  private clientSecret: string;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;
  private orgGroupPrefix: string | null = null;

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

  setOrgGroupPrefix(prefix: string): void {
    this.orgGroupPrefix = prefix;
  }

  async *fetchAllOrgs(): AsyncGenerator<SyncOrgRecord[]> {
    if (!this.orgGroupPrefix) throw new Error('orgGroupPrefix not set; call setOrgGroupPrefix() first');
    const url = `${this.realmAdminUrl}/groups?briefRepresentation=false`;
    const res = await this.authedFetch(url);
    if (!res.ok) throw new Error(`KC groups API failed: ${res.status}`);
    const tree = (await res.json()) as KcGroup[];

    const prefixDepth = this.orgGroupPrefix.split('/').filter(Boolean).length;
    const orgs: SyncOrgRecord[] = [];

    const walk = async (group: KcGroup, parentOrgId: string | null): Promise<void> => {
      const pathParts = group.path.split('/').filter(Boolean);
      const depth = pathParts.length;

      // KC 26+ may not populate subGroups — fetch children via API if needed
      let children = group.subGroups ?? [];
      if (children.length === 0 && (group.subGroupCount ?? 0) > 0) {
        const childrenUrl = `${this.realmAdminUrl}/groups/${group.id}/children?briefRepresentation=false`;
        const childRes = await this.authedFetch(childrenUrl);
        if (childRes.ok) {
          children = (await childRes.json()) as KcGroup[];
        }
      }

      // Groups at prefix depth are the container group itself — skip but recurse
      if (depth <= prefixDepth) {
        // Only recurse into the matching prefix subtree
        if (group.path === this.orgGroupPrefix || this.orgGroupPrefix!.startsWith(group.path)) {
          for (const child of children) {
            await walk(child, null);
          }
        }
        return;
      }
      // Only emit groups under our prefix
      if (!group.path.startsWith(this.orgGroupPrefix!)) return;

      const level = depth - prefixDepth - 1;
      orgs.push({
        externalId: group.id,
        name: group.name,
        parentExternalId: parentOrgId,
        level,
      });
      for (const child of children) {
        await walk(child, group.id);
      }
    };

    for (const root of tree) {
      await walk(root, null);
    }
    yield orgs;
  }

  async *fetchOrgMemberships(): AsyncGenerator<OrgMembership[]> {
    // First collect all org groups
    const orgGroups: { id: string }[] = [];
    for await (const chunk of this.fetchAllOrgs()) {
      orgGroups.push(...chunk.map((o) => ({ id: o.externalId })));
    }

    for (const group of orgGroups) {
      let offset = 0;
      const memberships: OrgMembership[] = [];
      while (true) {
        const url = `${this.realmAdminUrl}/groups/${group.id}/members?first=${offset}&max=${PAGE_SIZE}`;
        const res = await this.authedFetch(url);
        if (!res.ok) throw new Error(`KC group members API failed: ${res.status}`);
        const members = (await res.json()) as { id: string }[];
        if (members.length === 0) break;
        for (const m of members) {
          memberships.push({ orgExternalId: group.id, userExternalId: m.id, isPrimary: false });
        }
        if (members.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      if (memberships.length > 0) yield memberships;
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

type KcGroup = {
  id: string;
  name: string;
  path: string;
  subGroups?: KcGroup[];
  subGroupCount?: number;
};

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
