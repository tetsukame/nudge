import { Issuer } from 'openid-client';
import { assertSafeHttpUrl, SafeUrlError } from '../../lib/safe-url';
import { logger } from '../../lib/logger';

/**
 * NDG-113 (Sub D): OIDC 接続テスト。
 *
 * 管理画面の「接続テスト」ボタンから叩く。issuer_url を受け取り、SSRF
 * 検査 → Discovery Endpoint 取得 → authorization / token endpoint の
 * 存在を検証する。実際の client 認証・PKCE までは含まない (それは実際の
 * ログインフローで確認)。
 */

export type DiscoveryTestResult =
  | {
      ok: true;
      issuer: string;
      authorizationEndpoint: string;
      tokenEndpoint: string;
      endSessionEndpoint?: string;
    }
  | {
      ok: false;
      /** UI 表示用、ユーザーが読める短文 */
      error: string;
    };

export async function testOidcDiscovery(
  issuerUrl: string,
): Promise<DiscoveryTestResult> {
  const url = issuerUrl?.trim();
  if (!url) {
    return { ok: false, error: 'issuer_url が空です' };
  }
  try {
    await assertSafeHttpUrl(url, { allowLoopback: true });
  } catch (err) {
    if (err instanceof SafeUrlError) {
      return { ok: false, error: `issuer_url が不正: ${err.message}` };
    }
    throw err;
  }

  try {
    const issuer = await Issuer.discover(url);
    const md = issuer.metadata;
    const authorization = md.authorization_endpoint;
    const token = md.token_endpoint;
    if (!authorization || !token) {
      return {
        ok: false,
        error: 'Discovery は返ったが authorization_endpoint / token_endpoint が無い',
      };
    }
    return {
      ok: true,
      issuer: String(md.issuer),
      authorizationEndpoint: authorization,
      tokenEndpoint: token,
      endSessionEndpoint: md.end_session_endpoint,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, issuerUrl: url }, 'OIDC discovery test failed');
    return { ok: false, error: `Discovery 失敗: ${msg}` };
  }
}
