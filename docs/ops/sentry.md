# エラー監視 (Sentry)

Nudge は Sentry (self-hosted / SaaS) にエラーを送出できる (NDG-102)。**OSS デフォルトは無効**、`SENTRY_DSN` を環境変数に設定した時のみ SDK が起動する (SDK パッケージは lazy import で、未設定時は import すらされない)。

## 有効化

`.env` に:

```
SENTRY_DSN=https://<key>@sentry.example.com/<project>
SENTRY_ENVIRONMENT=production            # 任意 (default: NODE_ENV)
SENTRY_RELEASE=v0.26.0                    # 任意 (release tracking 用)
SENTRY_TRACES_SAMPLE_RATE=0.1             # 任意 (default 0.1、0.0 で performance off)
SENTRY_ALLOW_PII=true                     # 通常は false のまま (下記参照)
```

Next.js dev サーバー / worker それぞれの起動時に自動 init される ([instrumentation.ts](../../instrumentation.ts) と [src/worker/bootstrap.ts](../../src/worker/bootstrap.ts))。

## 何が送られるか

- **unhandled exception / unhandledRejection**: Sentry SDK の Node integration が自動キャプチャ
- **Next.js Route Handler の throw**: mapDomainError にかからず throw されると 500 → Sentry
- **Worker tick の握りつぶし**: 現状 logger.error のみ (Sentry には流れない、将来 captureException 追加検討)

明示的に送りたい箇所では [captureException](../../src/lib/sentry.ts) を呼べる:

```ts
import { captureException } from '@/lib/sentry';

try {
  await risky();
} catch (err) {
  await captureException(err, { requestId, tenantId });
  throw err;
}
```

## PII 除去

デフォルトで `beforeSend` フックが PII 系フィールドを剥がす:

- `event.user.email` を削除 (id/username は残す)
- `event.user.ip_address` を削除
- `event.request.cookies` を削除 (session cookie 漏洩防止)
- `event.request.headers` から `authorization` / `cookie` を削除

Sentry SDK 自体も `sendDefaultPii: false` で起動しているため、request body / URL query の user 情報も既定で送られない。

**PII 送信を許可したい場合** (社内 self-hosted Sentry のみで、詳細調査したい時):

```
SENTRY_ALLOW_PII=true
```

を追加すると beforeSend フックが素通しになる。SaaS 版 Sentry など、外部に流れる環境では絶対に付けないこと。

## 動作確認

一時的に例外を意図的に throw する route を書くのが手っ取り早い:

```ts
// app/t/[code]/api/dev-throw/route.ts
export async function GET() {
  throw new Error('sentry test');
}
```

`SENTRY_DSN` を設定して dev サーバー再起動 → `/t/dev/api/dev-throw` を叩く → Sentry の Issues に "sentry test" が表示されれば OK。確認後はこの route を削除。

## 関連
- [ログ (pino + AsyncLocalStorage)](logging.md) — pino 側のコンテキストは Sentry には自動で載らない。必要なら captureException の第 2 引数に渡す
- [メトリクス / トレース (OpenTelemetry)](metrics.md) — Sentry Performance と OTel は独立して動作 (二重計測にはなるが、いずれか一方だけを使うのが普通)
