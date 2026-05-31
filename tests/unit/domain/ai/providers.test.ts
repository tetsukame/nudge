import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DifyProvider } from '../../../../src/domain/ai/dify.js';
import { OpenAICompatProvider } from '../../../../src/domain/ai/openai-compat.js';
import { AIFormatError, type TenantAIConfig } from '../../../../src/domain/ai/provider.js';

function dify(overrides: Partial<TenantAIConfig> = {}): TenantAIConfig {
  return {
    enabled: true,
    provider: 'dify',
    endpoint: 'https://api.dify.example',
    difyAppId: 'wf-1',
    model: null,
    apiKey: 'sk-test',
    systemPrompt: null,
    defaultUserPrompt: null,
    ...overrides,
  };
}

function openai(overrides: Partial<TenantAIConfig> = {}): TenantAIConfig {
  return {
    enabled: true,
    provider: 'openai_compat',
    endpoint: 'http://localhost:1234/v1',
    difyAppId: null,
    model: 'qwen2.5-coder',
    apiKey: null,
    systemPrompt: null,
    defaultUserPrompt: null,
    ...overrides,
  };
}

describe('DifyProvider', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it('posts to /v1/workflows/run with Bearer auth and returns title/body', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      data: { outputs: { title: 'アンケート回答', body: 'お手数ですが回答お願いします' } },
    }), { status: 200 }));

    const result = await new DifyProvider(dify()).formatRequest('アンケート回答依頼');
    expect(result).toEqual({ title: 'アンケート回答', body: 'お手数ですが回答お願いします' });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.dify.example/v1/workflows/run');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toMatchObject({
      inputs: { memo: 'アンケート回答依頼' },
      response_mode: 'blocking',
    });
  });

  it('401 → AIFormatError code=auth', async () => {
    fetchSpy.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    await expect(new DifyProvider(dify()).formatRequest('x'))
      .rejects.toMatchObject({ code: 'auth', status: 401 });
  });

  it('429 → AIFormatError code=rate_limited', async () => {
    fetchSpy.mockResolvedValue(new Response('rl', { status: 429 }));
    await expect(new DifyProvider(dify()).formatRequest('x'))
      .rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('missing title/body → AIFormatError code=invalid_response', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      data: { outputs: { title: '', body: 'x' } },
    }), { status: 200 }));
    await expect(new DifyProvider(dify()).formatRequest('x'))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('missing apiKey → config error at construction', () => {
    expect(() => new DifyProvider(dify({ apiKey: null }))).toThrow(AIFormatError);
  });
});

describe('OpenAICompatProvider', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it('posts to /chat/completions with JSON-mode and parses title/body from content', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ title: 't1', body: 'b1' }) } }],
    }), { status: 200 }));

    const result = await new OpenAICompatProvider(openai()).formatRequest('アンケート回答依頼');
    expect(result).toEqual({ title: 't1', body: 'b1' });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('qwen2.5-coder');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'アンケート回答依頼' });
  });

  it('sends Bearer header when apiKey present', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"title":"t","body":"b"}' } }],
    }), { status: 200 }));
    await new OpenAICompatProvider(openai({ apiKey: 'sk-1' })).formatRequest('x');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-1');
  });

  it('custom systemPrompt overrides default', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"title":"t","body":"b"}' } }],
    }), { status: 200 }));
    await new OpenAICompatProvider(openai({ systemPrompt: 'CUSTOM' })).formatRequest('x');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'CUSTOM' });
  });

  it('non-JSON content → invalid_response', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'not json' } }],
    }), { status: 200 }));
    await expect(new OpenAICompatProvider(openai()).formatRequest('x'))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('missing model → config error at construction', () => {
    expect(() => new OpenAICompatProvider(openai({ model: null }))).toThrow(AIFormatError);
  });
});
