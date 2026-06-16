import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// NDG-84: テストフィクスチャの fake hostname を SafeUrl allowlist に登録
process.env.SAFE_URL_HOST_ALLOWLIST = [
  'api.dify.example',
  'x',
  'host.docker.internal',
].join(',');
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import {
  getAIConfigView,
  getAIConfigForCall,
  upsertAIConfig,
  AIConfigError,
} from '../../../../src/domain/ai/config.js';
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

describe('tenant_ai_config CRUD', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('non-admin rejected on get/upsert', async () => {
    const s = await createDomainScenario(getPool());
    await expect(getAIConfigView(getAppPool(), memberCtx(s)))
      .rejects.toMatchObject({ code: 'permission_denied' });
    await expect(upsertAIConfig(getAppPool(), memberCtx(s), {
      enabled: true, provider: 'openai_compat',
      endpoint: 'http://x/v1', model: 'm',
    })).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('view starts null, returns hasApiKey flag after upsert', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = adminCtx(s);
    expect(await getAIConfigView(getAppPool(), ctx)).toBeNull();

    await upsertAIConfig(getAppPool(), ctx, {
      enabled: true, provider: 'dify',
      endpoint: 'https://api.dify.example', difyAppId: 'wf-1',
      apiKey: 'sk-secret',
    });
    const v = await getAIConfigView(getAppPool(), ctx);
    expect(v).toMatchObject({
      enabled: true, provider: 'dify',
      endpoint: 'https://api.dify.example', difyAppId: 'wf-1',
      hasApiKey: true,
    });
  });

  it('apiKey round-trip: getAIConfigForCall decrypts back to plain', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = adminCtx(s);
    await upsertAIConfig(getAppPool(), ctx, {
      enabled: true, provider: 'dify',
      endpoint: 'https://api.dify.example', difyAppId: 'wf-1',
      apiKey: 'sk-roundtrip',
    });
    const call = await getAIConfigForCall(getAppPool(), ctx);
    expect(call?.apiKey).toBe('sk-roundtrip');
  });

  it('apiKey undefined on upsert preserves existing encrypted value', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = adminCtx(s);
    await upsertAIConfig(getAppPool(), ctx, {
      enabled: true, provider: 'dify',
      endpoint: 'https://api.dify.example', difyAppId: 'wf-1',
      apiKey: 'first-key',
    });
    await upsertAIConfig(getAppPool(), ctx, {
      enabled: false, provider: 'dify',
      endpoint: 'https://api.dify.example', difyAppId: 'wf-1',
      // apiKey omitted → preserve
    });
    const call = await getAIConfigForCall(getAppPool(), ctx);
    expect(call?.apiKey).toBe('first-key');
    expect(call?.enabled).toBe(false);
  });

  it('apiKey="" on upsert clears the stored key', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = adminCtx(s);
    await upsertAIConfig(getAppPool(), ctx, {
      enabled: true, provider: 'dify',
      endpoint: 'https://api.dify.example', difyAppId: 'wf-1',
      apiKey: 'will-be-cleared',
    });
    await upsertAIConfig(getAppPool(), ctx, {
      enabled: true, provider: 'dify',
      endpoint: 'https://api.dify.example', difyAppId: 'wf-1',
      apiKey: '',
    });
    const v = await getAIConfigView(getAppPool(), ctx);
    expect(v?.hasApiKey).toBe(false);
  });

  it('validation: dify requires difyAppId', async () => {
    const s = await createDomainScenario(getPool());
    await expect(upsertAIConfig(getAppPool(), adminCtx(s), {
      enabled: true, provider: 'dify',
      endpoint: 'https://api.dify.example',
    })).rejects.toBeInstanceOf(AIConfigError);
  });

  it('validation: openai_compat requires model', async () => {
    const s = await createDomainScenario(getPool());
    await expect(upsertAIConfig(getAppPool(), adminCtx(s), {
      enabled: true, provider: 'openai_compat',
      endpoint: 'http://x/v1',
    })).rejects.toBeInstanceOf(AIConfigError);
  });

  it('validation: endpoint must be http(s) URL', async () => {
    const s = await createDomainScenario(getPool());
    await expect(upsertAIConfig(getAppPool(), adminCtx(s), {
      enabled: true, provider: 'openai_compat',
      endpoint: 'ftp://x', model: 'm',
    })).rejects.toBeInstanceOf(AIConfigError);
  });

  // NDG-95 (S9): upsert は audit_log に記録される
  it('writes settings.ai.updated audit log on upsert', async () => {
    const s = await createDomainScenario(getPool());
    await upsertAIConfig(getAppPool(), adminCtx(s), {
      enabled: true, provider: 'openai_compat',
      endpoint: 'http://x/v1', model: 'qwen',
      apiKey: 'sk-new',
    });
    const { rows } = await getPool().query<{
      action: string; payload_json: { enabled: boolean; apiKeyChanged: boolean };
    }>(
      `SELECT action, payload_json FROM audit_log
        WHERE tenant_id=$1 AND action='settings.ai.updated'`,
      [s.tenantId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload_json.enabled).toBe(true);
    expect(rows[0].payload_json.apiKeyChanged).toBe(true);
  });

  it('audit log apiKeyChanged=false when apiKey omitted from upsert', async () => {
    const s = await createDomainScenario(getPool());
    await upsertAIConfig(getAppPool(), adminCtx(s), {
      enabled: true, provider: 'openai_compat',
      endpoint: 'http://x/v1', model: 'qwen',
      // apiKey omitted
    });
    const { rows } = await getPool().query<{
      payload_json: { apiKeyChanged: boolean };
    }>(
      `SELECT payload_json FROM audit_log
        WHERE tenant_id=$1 AND action='settings.ai.updated'`,
      [s.tenantId],
    );
    expect(rows[0].payload_json.apiKeyChanged).toBe(false);
  });
});
