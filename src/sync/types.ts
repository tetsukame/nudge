export type SyncUserRecord = {
  externalId: string;
  email: string;
  displayName: string;
  active: boolean;
  /**
   * NDG-48: KC user attribute `position` の値（例: "課長"）。
   * 取得できないソース / 未設定ユーザーは undefined。
   */
  position?: string | null;
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
