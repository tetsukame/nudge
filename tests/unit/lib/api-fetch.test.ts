import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, apiSend } from '../../../src/lib/api-fetch.js';

describe('apiFetch', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it('returns parsed JSON on 2xx', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ a: 1 }), { status: 200 }));
    const data = await apiFetch<{ a: number }>('/foo');
    expect(data).toEqual({ a: 1 });
  });

  it('throws server-supplied error message on non-ok', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }));
    await expect(apiFetch('/foo')).rejects.toThrow('forbidden');
  });

  it('throws status-based message when body is not JSON', async () => {
    fetchSpy.mockResolvedValue(new Response('not json', { status: 500 }));
    await expect(apiFetch('/foo')).rejects.toThrow(/500/);
  });

  it('throws status-based message when body has no error field', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ other: 1 }), { status: 502 }));
    await expect(apiFetch('/foo')).rejects.toThrow(/502/);
  });
});

describe('apiSend', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it('resolves on 2xx without reading body', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiSend('/foo', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws server-supplied error message on non-ok', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }));
    await expect(apiSend('/foo', { method: 'POST' })).rejects.toThrow('rate limited');
  });
});
