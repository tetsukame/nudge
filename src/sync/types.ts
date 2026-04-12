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
