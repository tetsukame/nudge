import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import {
  getRetentionConfigView,
  getRetentionConfigResolved,
  upsertRetentionConfig,
  RetentionConfigError,
} from '../../../../src/domain/retention/config.js';
import { PLATFORM_RETENTION_DEFAULTS } from '../../../../src/domain/retention/defaults.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function adminCtx(s: { tenantId: string; users: { admin: string } }): ActorContext {
  return {
    userId: s.users.admin,
    tenantId: s.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  };
}

function memberCtx(s: { tenantId: string; users: { memberA: string } }): ActorContext {
  return {
    userId: s.users.memberA,
    tenantId: s.tenantId,
    isTenantAdmin: false,
    isTenantWideRequester: false,
  };
}

describe('NDG-88: retention_config CRUD', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('non-admin rejected on view / upsert', async () => {
    const s = await createDomainScenario(getPool());
    await expect(getRetentionConfigView(getAppPool(), memberCtx(s)))
      .rejects.toMatchObject({ code: 'permission_denied' });
    await expect(upsertRetentionConfig(getAppPool(), memberCtx(s), { enabled: true }))
      .rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('view falls back to platform defaults when no row exists', async () => {
    const s = await createDomainScenario(getPool());
    const v = await getRetentionConfigView(getAppPool(), adminCtx(s));
    expect(v.enabled).toBe(false);
    expect(v.hardDeleteEnabled).toBe(false);
    expect(v.notificationDays).toBe(PLATFORM_RETENTION_DEFAULTS.notificationDays);
    expect(v.auditLogDays).toBe(PLATFORM_RETENTION_DEFAULTS.auditLogDays);
    expect(v.historyDays).toBe(PLATFORM_RETENTION_DEFAULTS.historyDays);
    expect(v.syncLogDays).toBe(PLATFORM_RETENTION_DEFAULTS.syncLogDays);
    expect(v.softDeleteGraceDays).toBe(PLATFORM_RETENTION_DEFAULTS.softDeleteGraceDays);
    expect(v.isUsingPlatformDefault).toBe(true);
  });

  it('upsert sets values; view reflects them', async () => {
    const s = await createDomainScenario(getPool());
    await upsertRetentionConfig(getAppPool(), adminCtx(s), {
      enabled: true,
      hardDeleteEnabled: true,
      notificationDays: 30,
      auditLogDays: 1095,
      historyDays: null,
      syncLogDays: 60,
      softDeleteGraceDays: 14,
    });
    const v = await getRetentionConfigView(getAppPool(), adminCtx(s));
    expect(v.enabled).toBe(true);
    expect(v.hardDeleteEnabled).toBe(true);
    expect(v.notificationDays).toBe(30);
    expect(v.auditLogDays).toBe(1095);
    // historyDays = null → platform default にフォールバック
    expect(v.historyDays).toBe(PLATFORM_RETENTION_DEFAULTS.historyDays);
    expect(v.syncLogDays).toBe(60);
    expect(v.softDeleteGraceDays).toBe(14);
    expect(v.isUsingPlatformDefault).toBe(false);
  });

  it('upsert is idempotent (ON CONFLICT update)', async () => {
    const s = await createDomainScenario(getPool());
    await upsertRetentionConfig(getAppPool(), adminCtx(s), { enabled: true, notificationDays: 30 });
    await upsertRetentionConfig(getAppPool(), adminCtx(s), { enabled: false, notificationDays: 60 });
    const v = await getRetentionConfigView(getAppPool(), adminCtx(s));
    expect(v.enabled).toBe(false);
    expect(v.notificationDays).toBe(60);
  });

  it('validation: zero or negative days are rejected', async () => {
    const s = await createDomainScenario(getPool());
    await expect(upsertRetentionConfig(getAppPool(), adminCtx(s), {
      enabled: true, notificationDays: 0,
    })).rejects.toBeInstanceOf(RetentionConfigError);
    await expect(upsertRetentionConfig(getAppPool(), adminCtx(s), {
      enabled: true, auditLogDays: -1,
    })).rejects.toBeInstanceOf(RetentionConfigError);
    await expect(upsertRetentionConfig(getAppPool(), adminCtx(s), {
      enabled: true, softDeleteGraceDays: 0,
    })).rejects.toBeInstanceOf(RetentionConfigError);
  });

  it('getRetentionConfigResolved (worker path) uses platform defaults when absent', async () => {
    const s = await createDomainScenario(getPool());
    const r = await getRetentionConfigResolved(getPool(), s.tenantId);
    expect(r.enabled).toBe(false);
    expect(r.notificationDays).toBe(PLATFORM_RETENTION_DEFAULTS.notificationDays);
    expect(r.softDeleteGraceDays).toBe(PLATFORM_RETENTION_DEFAULTS.softDeleteGraceDays);
  });

  it('upsert writes settings.retention.changed audit log', async () => {
    const s = await createDomainScenario(getPool());
    await upsertRetentionConfig(getAppPool(), adminCtx(s), { enabled: true, notificationDays: 30 });
    const { rows } = await getPool().query(
      `SELECT action, payload_json FROM audit_log
        WHERE tenant_id=$1 AND action='settings.retention.changed'`,
      [s.tenantId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload_json.enabled).toBe(true);
    expect(rows[0].payload_json.notificationDays).toBe(30);
  });
});
