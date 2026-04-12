import type {
  SyncSource, SyncUserRecord,
  OrgSyncSource, SyncOrgRecord, OrgMembership,
} from './types.js';
import { parseSyncCsv, type CsvRow } from './csv-parser.js';

export class CsvSyncSource implements SyncSource, OrgSyncSource {
  private rows: CsvRow[];

  constructor(csvContent: string) {
    const result = parseSyncCsv(csvContent);
    if (!result.ok) {
      throw new Error(`CSV parse failed: ${result.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`);
    }
    this.rows = result.rows;
  }

  async *fetchAllUsers(): AsyncGenerator<SyncUserRecord[]> {
    const seen = new Map<string, SyncUserRecord>();
    for (const row of this.rows) {
      if (!seen.has(row.employee_id)) {
        seen.set(row.employee_id, {
          externalId: row.employee_id,
          email: row.email,
          displayName: row.display_name,
          active: row.status === 'active',
        });
      }
    }
    yield [...seen.values()];
  }

  async *fetchAllOrgs(): AsyncGenerator<SyncOrgRecord[]> {
    const orgMap = new Map<string, SyncOrgRecord>();
    for (const row of this.rows) {
      const parts = row.org_path.split('/').filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        const path = '/' + parts.slice(0, i + 1).join('/');
        if (!orgMap.has(path)) {
          const parentPath = i === 0 ? null : '/' + parts.slice(0, i).join('/');
          orgMap.set(path, {
            externalId: path,
            name: parts[i],
            parentExternalId: parentPath,
            level: i,
          });
        }
      }
    }
    yield [...orgMap.values()];
  }

  async *fetchOrgMemberships(): AsyncGenerator<OrgMembership[]> {
    yield this.rows.map((row) => ({
      orgExternalId: row.org_path,
      userExternalId: row.employee_id,
      isPrimary: row.is_primary,
    }));
  }
}
