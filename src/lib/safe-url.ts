import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * NDG-84: SSRF / 内部宛 egress を遮断する共通バリデータ。
 *
 * 対象: テナント管理者が任意で保存できる外向き URL / ホスト名
 *   - tenant_ai_config.endpoint
 *   - tenant_settings.teams_webhook_url / slack_webhook_url
 *   - tenant_settings.smtp_host
 *
 * 拒否対象:
 *   - http(s) 以外のプロトコル
 *   - 名前解決結果が以下のレンジに当たる:
 *     - loopback (127.0.0.0/8, ::1)
 *     - private  (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7)
 *     - link-local (169.254.0.0/16, fe80::/10) ← cloud metadata 169.254.169.254 含む
 *
 * 例外:
 *   - `SAFE_URL_HOST_ALLOWLIST` 環境変数 (comma-separated) に列挙された hostname
 *     は IP 判定を skip して通す。docker compose デモの host.docker.internal
 *     などをここに入れる。
 *   - opts.allowLoopback=true で loopback だけ許可 (テスト/dev でだけ使う想定)
 *
 * 注意: 本実装はバリデーション時の DNS 結果のみ検証する。DNS rebinding
 * (validate 後の実通信で異なる IP を返す攻撃) には対応していない。後者は
 * 通信層で IP 固定接続にする必要があり、別チケットで扱う。
 */

export class SafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeUrlError';
  }
}

export type SafeUrlOptions = {
  /** これらの hostname は DNS 後の IP 判定を skip する */
  allowedHosts?: string[];
  /** loopback (127/8, ::1) を許可。テスト / dev 用 */
  allowLoopback?: boolean;
};

function defaultAllowedHosts(): Set<string> {
  const raw = process.env.SAFE_URL_HOST_ALLOWLIST;
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, n) => (acc << 8) + Number(n), 0) >>> 0;
}

function inCidr4(ip: string, base: string, prefix: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isLoopback(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return inCidr4(ip, '127.0.0.0', 8);
  if (v === 6) return ip === '::1' || ip === '0:0:0:0:0:0:0:1';
  return false;
}

function isPrivateOrSpecial(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    return (
      isLoopback(ip) ||
      inCidr4(ip, '10.0.0.0', 8) ||
      inCidr4(ip, '172.16.0.0', 12) ||
      inCidr4(ip, '192.168.0.0', 16) ||
      inCidr4(ip, '169.254.0.0', 16) || // link-local + cloud metadata
      inCidr4(ip, '0.0.0.0', 8)
    );
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (isLoopback(lower)) return true;
    // fc00::/7 (unique-local) / fe80::/10 (link-local)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true;
    }
    return false;
  }
  return false;
}

/**
 * URL 文字列を検証し、`URL` を返す。違反は `SafeUrlError` を throw。
 */
export async function assertSafeHttpUrl(
  input: string,
  opts?: SafeUrlOptions,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeUrlError('invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeUrlError('protocol must be http or https');
  }
  await assertSafeHostname(url.hostname, opts);
  return url;
}

/**
 * 生のホスト名 (SMTP host 等) を検証する。違反は `SafeUrlError`。
 */
export async function assertSafeHostname(
  hostname: string,
  opts?: SafeUrlOptions,
): Promise<void> {
  if (!hostname || !hostname.trim()) {
    throw new SafeUrlError('hostname is empty');
  }
  // WHATWG URL の hostname は IPv6 を `[::1]` 形式で返すため括弧を剥がす
  const host = hostname.toLowerCase().replace(/^\[(.+)\]$/, '$1');

  const allowed = new Set([
    ...defaultAllowedHosts(),
    ...(opts?.allowedHosts ?? []),
  ]);
  if (allowed.has(host)) return;

  // ホスト名が既に IP リテラル: 即判定
  const literal = isIP(host);
  if (literal !== 0) {
    if (opts?.allowLoopback && isLoopback(host)) return;
    if (isPrivateOrSpecial(host)) {
      throw new SafeUrlError(`address ${host} is private / loopback / link-local`);
    }
    return;
  }

  // DNS 解決
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (err) {
    throw new SafeUrlError(`DNS resolution failed for ${host}: ${(err as Error).message}`);
  }
  for (const a of addrs) {
    if (opts?.allowLoopback && isLoopback(a.address)) continue;
    if (isPrivateOrSpecial(a.address)) {
      throw new SafeUrlError(
        `${host} resolves to private / loopback / link-local address ${a.address}`,
      );
    }
  }
}
