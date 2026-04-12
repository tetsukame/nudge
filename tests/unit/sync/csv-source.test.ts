import { describe, expect, it } from 'vitest';
import { CsvSyncSource } from '../../../src/sync/csv-source.js';

const CSV = [
  'employee_id,email,display_name,org_path,is_primary',
  'emp-001,tanaka@city.lg.jp,田中太郎,/総務本部/総務部/総務課,true',
  'emp-002,suzuki@city.lg.jp,鈴木花子,/総務本部/総務部/人事課,true',
  'emp-002,suzuki@city.lg.jp,鈴木花子,/DX推進,false',
].join('\n');

describe('CsvSyncSource', () => {
  it('fetchAllUsers returns deduplicated users', async () => {
    const source = new CsvSyncSource(CSV);
    const users = [];
    for await (const chunk of source.fetchAllUsers()) {
      users.push(...chunk);
    }
    expect(users).toHaveLength(2);
    expect(users[0].externalId).toBe('emp-001');
    expect(users[1].externalId).toBe('emp-002');
  });

  it('fetchAllOrgs generates tree from paths', async () => {
    const source = new CsvSyncSource(CSV);
    const orgs = [];
    for await (const chunk of source.fetchAllOrgs()) {
      orgs.push(...chunk);
    }
    expect(orgs.length).toBe(5);
    const hq = orgs.find((o) => o.externalId === '/総務本部');
    expect(hq?.name).toBe('総務本部');
    expect(hq?.parentExternalId).toBeNull();
    expect(hq?.level).toBe(0);
    const dept = orgs.find((o) => o.externalId === '/総務本部/総務部');
    expect(dept?.parentExternalId).toBe('/総務本部');
    expect(dept?.level).toBe(1);
  });

  it('fetchOrgMemberships returns all memberships', async () => {
    const source = new CsvSyncSource(CSV);
    const memberships = [];
    for await (const chunk of source.fetchOrgMemberships()) {
      memberships.push(...chunk);
    }
    expect(memberships).toHaveLength(3);
    const primary = memberships.find(
      (m) => m.userExternalId === 'emp-001' && m.orgExternalId === '/総務本部/総務部/総務課',
    );
    expect(primary?.isPrimary).toBe(true);
    const secondary = memberships.find(
      (m) => m.userExternalId === 'emp-002' && m.orgExternalId === '/DX推進',
    );
    expect(secondary?.isPrimary).toBe(false);
  });
});
