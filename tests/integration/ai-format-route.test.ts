import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as formatReq } from '../../app/t/[code]/api/requests/format/route.js';
import { upsertAIConfig } from '../../src/domain/ai/config.js';

async function callFormat(s: { tenantCode: string; tenantId: string }, userId: string, body: unknown) {
  const cookie = await makeSessionCookie({
    userId, tenantId: s.tenantId, tenantCode: s.tenantCode,
  });
  return formatReq(
    new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests/format`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code: s.tenantCode }) },
  );
}

describe('NDG-73 Phase 2: POST /api/requests/format', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it('returns 400 when no tenant_ai_config saved', async () => {
    const s = await createDomainScenario(getPool());
    const res = await callFormat(s, s.users.memberA, { memo: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when config exists but enabled=false', async () => {
    const s = await createDomainScenario(getPool());
    await upsertAIConfig(getAppPool(), {
      userId: s.users.admin, tenantId: s.tenantId,
      isTenantAdmin: true, isTenantWideRequester: false,
    }, {
      enabled: false, provider: 'openai_compat',
      endpoint: 'http://x/v1', model: 'm',
    });
    const res = await callFormat(s, s.users.memberA, { memo: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when memo missing or empty', async () => {
    const s = await createDomainScenario(getPool());
    await upsertAIConfig(getAppPool(), {
      userId: s.users.admin, tenantId: s.tenantId,
      isTenantAdmin: true, isTenantWideRequester: false,
    }, {
      enabled: true, provider: 'openai_compat',
      endpoint: 'http://x/v1', model: 'm',
    });
    expect((await callFormat(s, s.users.memberA, {})).status).toBe(400);
    expect((await callFormat(s, s.users.memberA, { memo: '' })).status).toBe(400);
    expect((await callFormat(s, s.users.memberA, { memo: '   ' })).status).toBe(400);
  });

  it('returns 400 when memo exceeds max length', async () => {
    const s = await createDomainScenario(getPool());
    await upsertAIConfig(getAppPool(), {
      userId: s.users.admin, tenantId: s.tenantId,
      isTenantAdmin: true, isTenantWideRequester: false,
    }, {
      enabled: true, provider: 'openai_compat',
      endpoint: 'http://x/v1', model: 'm',
    });
    const huge = 'a'.repeat(4001);
    const res = await callFormat(s, s.users.memberA, { memo: huge });
    expect(res.status).toBe(400);
  });

  it('non-admin member can use it when enabled (not admin-only)', async () => {
    const s = await createDomainScenario(getPool());
    await upsertAIConfig(getAppPool(), {
      userId: s.users.admin, tenantId: s.tenantId,
      isTenantAdmin: true, isTenantWideRequester: false,
    }, {
      enabled: true, provider: 'openai_compat',
      endpoint: 'http://x/v1', model: 'm',
    });
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"title":"AI Title","body":"AI Body"}' } }],
    }), { status: 200 }));

    const res = await callFormat(s, s.users.memberA, { memo: '何かお願い' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ title: 'AI Title', body: 'AI Body' });
  });

  it('propagates provider 502 on auth failure', async () => {
    const s = await createDomainScenario(getPool());
    await upsertAIConfig(getAppPool(), {
      userId: s.users.admin, tenantId: s.tenantId,
      isTenantAdmin: true, isTenantWideRequester: false,
    }, {
      enabled: true, provider: 'dify',
      endpoint: 'https://api.dify.example', difyAppId: 'wf-1',
      apiKey: 'bad',
    });
    fetchSpy.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const res = await callFormat(s, s.users.memberA, { memo: 'x' });
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.code).toBe('auth');
  });
});
