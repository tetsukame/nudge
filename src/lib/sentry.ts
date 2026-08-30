/**
 * NDG-102 (v0.26 A3 サブ D): Sentry (エラー監視) opt-in ラッパ。
 *
 * `SENTRY_DSN` が未設定なら完全に no-op (init しない / 依存ロードも遅延)。
 * OSS デフォルトは無効。ラボ / 本番環境で opt-in する。
 *
 * ## PII 除去
 * IdP からもらった email や display_name は claim mapping 経由でログ /
 * span に載る可能性がある。beforeSend で丸ごと剥がす方針:
 *   - `event.user.email` を削除 (id/username は残す)
 *   - `event.request.cookies` を削除 (session cookie 漏洩防止)
 *   - `event.request.headers.authorization` を削除 (Bearer token 等)
 *   - request body は Sentry SDK が既定で送らないので追加除去は不要
 *
 * 深堀りしたい場合は環境変数 `SENTRY_ALLOW_PII=true` で beforeSend を弱める
 * (開発者が意図的に PII を送りたいラボでのみ利用)。
 */

let initialized = false;

export function isSentryInitialized(): boolean {
  return initialized;
}

export async function initSentry(): Promise<boolean> {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  const Sentry = await import('@sentry/node');
  const allowPii = process.env.SENTRY_ALLOW_PII === 'true';

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE ?? process.env.OTEL_SERVICE_VERSION,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    // OTel と共存させるため sendDefaultPii は明示 false
    sendDefaultPii: false,
    beforeSend(event) {
      if (allowPii) return event;
      // ユーザー情報の PII を削除
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      // request ヘッダ / cookie から機密情報を削除
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          const cleaned: Record<string, string> = {};
          for (const [k, v] of Object.entries(event.request.headers)) {
            const lk = k.toLowerCase();
            if (lk === 'authorization' || lk === 'cookie' || lk === 'x-request-id') continue;
            if (typeof v === 'string') cleaned[k] = v;
          }
          event.request.headers = cleaned;
        }
      }
      return event;
    },
  });

  initialized = true;
  return true;
}

/**
 * 明示的に例外を Sentry に送りたい場合の薄いラッパ。SDK 未初期化なら no-op。
 * 通常は init 済みなら uncaught / unhandledrejection は自動でキャプチャされる。
 * このヘルパは「catch で mapDomainError にかからないパス」を手動でトラップ
 * したい場合の予備口。
 */
export async function captureException(err: unknown, context?: Record<string, unknown>): Promise<void> {
  if (!initialized) return;
  const Sentry = await import('@sentry/node');
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
