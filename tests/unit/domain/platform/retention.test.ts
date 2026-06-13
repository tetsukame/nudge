import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { listRetentionSummary } from '../../../../src/domain/platform/retention.js';

async function seedRetentionConfig(
  tenantId: string,
  enabled: boolean,
  hardDeleteEnabled: boolean,
): Promise<void> {
  await getPool().query(
    `INSERT INTO retention_config (tenant_id, enabled, hard_delete_enabled)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [tenantId, enabled, hardDeleteEnabled],
  );
}

async function seedRetentionLog(
  tenantId: string,
  tableName: string,
  action: 'soft' | 'hard',
  rowsAffected: number,
  errorMessage: string | null = null,
): Promise<void> {
  await getPool().query(
    `INSERT INTO retention_log
       (id, tenant_id, table_name, action, rows_affected, finished_at, error_message)
     VALUES ($1, $2, $3, $4, $5, now(), $6)`,
    [randomUUID(), tenantId, tableName, action, rowsAffected, errorMessage],
  );
}

describe('NDG-90: listRetentionSummary', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('emits 4 rows per tenant (one per target table) with zeros when no log', async () => {
    const s = await createDomainScenario(getPool());
    const summary = await listRetentionSummary(getPool());
    const forThisTenant = summary.filter((r) => r.tenantId === s.tenantId);
    expect(forThisTenant.map((r) => r.tableName).sort()).toEqual([
      'assignment_status_history', 'audit_log', 'notification', 'sync_log',
    ]);
    for (const r of forThisTenant) {
      expect(r.enabled).toBe(false);
      expect(r.hardDeleteEnabled).toBe(false);
      expect(r.totalSoftRows).toBe(0);
      expect(r.totalHardRows).toBe(0);
      expect(r.lastSoftAt).toBeNull();
      expect(r.lastHardAt).toBeNull();
    }
  });

  it('reflects retention_config flags', async () => {
    const s = await createDomainScenario(getPool());
    await seedRetentionConfig(s.tenantId, true, true);
    const summary = await listRetentionSummary(getPool());
    const rows = summary.filter((r) => r.tenantId === s.tenantId);
    for (const r of rows) {
      expect(r.enabled).toBe(true);
      expect(r.hardDeleteEnabled).toBe(true);
    }
  });

  it('aggregates soft / hard counts per table', async () => {
    const s = await createDomainScenario(getPool());
    await seedRetentionConfig(s.tenantId, true, true);
    await seedRetentionLog(s.tenantId, 'notification', 'soft', 100);
    await seedRetentionLog(s.tenantId, 'notification', 'soft', 50);
    await seedRetentionLog(s.tenantId, 'notification', 'hard', 30);

    const summary = await listRetentionSummary(getPool());
    const n = summary.find(
      (r) => r.tenantId === s.tenantId && r.tableName === 'notification',
    )!;
    expect(n.totalSoftRows).toBe(150);
    expect(n.totalHardRows).toBe(30);
    expect(n.lastSoftAt).not.toBeNull();
    expect(n.lastHardAt).not.toBeNull();
  });

  it('surfaces last error message when present', async () => {
    const s = await createDomainScenario(getPool());
    await seedRetentionLog(s.tenantId, 'audit_log', 'soft', 0, 'failed: example');

    const summary = await listRetentionSummary(getPool());
    const a = summary.find(
      (r) => r.tenantId === s.tenantId && r.tableName === 'audit_log',
    )!;
    expect(a.lastErrorMessage).toBe('failed: example');
  });
});
