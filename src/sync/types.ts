export type SyncUserRecord = {
  externalId: string;
  email: string;
  displayName: string;
  active: boolean;
};

export type SyncResult = {
  created: number;
  updated: number;
  deactivated: number;
  reactivated: number;
};

export interface SyncSource {
  fetchAllUsers(): AsyncGenerator<SyncUserRecord[]>;
  fetchDeltaUsers?(since: Date): Promise<SyncUserRecord[]>;
}

export type SyncOrgRecord = {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  level: number;
};

export type OrgSyncResult = {
  created: number;
  updated: number;
  removed: number;
  membershipsUpdated: number;
};

export type OrgMembership = {
  orgExternalId: string;
  userExternalId: string;
  isPrimary: boolean;
};

export interface OrgSyncSource {
  fetchAllOrgs(): AsyncGenerator<SyncOrgRecord[]>;
  fetchOrgMemberships(): AsyncGenerator<OrgMembership[]>;
}
