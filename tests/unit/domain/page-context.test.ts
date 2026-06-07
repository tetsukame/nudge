import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../helpers/pg-container.js';
import { createDomainScenario } from '../../helpers/fixtures/domain-scenario.js';
import { loadPageContext } from '../../../src/domain/page-context.js';

describe('NDG-93 (P8): loadPageContext', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('returns isTenantAdmin=true / isTenantWideRequester=false for admin user', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = await loadPageContext(getAppPool(), s.tenantId, s.users.admin);
    expect(ctx.isTenantAdmin).toBe(true);
    expect(ctx.isTenantWideRequester).toBe(false);
    expect(ctx.aiEnabled).toBeUndefined();
  });

  it('returns isTenantWideRequester=true for wideReq user', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = await loadPageContext(getAppPool(), s.tenantId, s.users.wideReq);
    expect(ctx.isTenantAdmin).toBe(false);
    expect(ctx.isTenantWideRequester).toBe(true);
  });

  it('returns both false for memberA (no roles)', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = await loadPageContext(getAppPool(), s.tenantId, s.users.memberA);
    expect(ctx.isTenantAdmin).toBe(false);
    expect(ctx.isTenantWideRequester).toBe(false);
  });

  it('aiEnabled is undefined unless needAIEnabled=true', async () => {
    const s = await createDomainScenario(getPool());
    const c1 = await loadPageContext(getAppPool(), s.tenantId, s.users.admin);
    expect(c1.aiEnabled).toBeUndefined();
    const c2 = await loadPageContext(
      getAppPool(), s.tenantId, s.users.admin, { needAIEnabled: true },
    );
    expect(c2.aiEnabled).toBe(false); // tenant_ai_config 行なし
  });

  it('aiEnabled=true when tenant_ai_config.enabled=true', async () => {
    const s = await createDomainScenario(getPool());
    await getPool().query(
      `INSERT INTO tenant_ai_config (tenant_id, enabled, provider, endpoint)
       VALUES ($1, true, 'openai_compat', 'https://example.com/v1')`,
      [s.tenantId],
    );
    const ctx = await loadPageContext(
      getAppPool(), s.tenantId, s.users.admin, { needAIEnabled: true },
    );
    expect(ctx.aiEnabled).toBe(true);
  });
});
