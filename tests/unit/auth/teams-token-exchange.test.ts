import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  exchangeEntraTokenForKcToken,
  type TokenExchangeConfig,
} from '../../../src/auth/teams-token-exchange';

const baseConfig: TokenExchangeConfig = {
  issuerUrl: 'https://kc.example.com/realms/nudge',
  clientId: 'nudge-web',
  clientSecret: 'secret',
  entraIdpAlias: 'entra',
};

describe('exchangeEntraTokenForKcToken', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch') as unknown as ReturnType<typeof vi.spyOn>;
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns token set on 200 OK', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'kc-access',
          id_token: 'kc-id',
          refresh_token: 'kc-refresh',
          expires_in: 300,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ) as unknown as Response,
    );

    const result = await exchangeEntraTokenForKcToken('entra-token', baseConfig);
    expect(result.accessToken).toBe('kc-access');
    expect(result.idToken).toBe('kc-id');
    expect(result.refreshToken).toBe('kc-refresh');
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('sends correct form-urlencoded body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'a', id_token: 'i', expires_in: 300 }),
        { status: 200 },
      ) as unknown as Response,
    );

    await exchangeEntraTokenForKcToken('entra-token', baseConfig);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://kc.example.com/realms/nudge/protocol/openid-connect/token');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(body.get('subject_token')).toBe('entra-token');
    expect(body.get('subject_issuer')).toBe('entra');
    expect(body.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(body.get('client_id')).toBe('nudge-web');
    expect(body.get('client_secret')).toBe('secret');
  });

  it('throws TokenExchangeError on 401 (invalid Entra token)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'invalid_token', error_description: 'token rejected' }),
        { status: 401 },
      ) as unknown as Response,
    );

    await expect(
      exchangeEntraTokenForKcToken('bad', baseConfig),
    ).rejects.toMatchObject({ name: 'TokenExchangeError', status: 401 });
  });

  it('throws TokenExchangeError on 403 (KC permission missing)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'access_denied' }),
        { status: 403 },
      ) as unknown as Response,
    );

    await expect(
      exchangeEntraTokenForKcToken('e', baseConfig),
    ).rejects.toMatchObject({ name: 'TokenExchangeError', status: 403 });
  });

  it('throws TokenExchangeError on 5xx (KC down)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 503 }) as unknown as Response);

    await expect(
      exchangeEntraTokenForKcToken('e', baseConfig),
    ).rejects.toMatchObject({ name: 'TokenExchangeError', status: 503 });
  });
});
