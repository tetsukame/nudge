# ロギング (structured logging)

Nudge のアプリケーションログは [pino](https://getpino.io/) による JSON 出力に統一されている (NDG-99)。

## 出力フォーマット

デフォルトで 1 行 1 JSON:

```json
{"level":30,"time":1787985580498,"pid":27528,"hostname":"web-1","tenantId":"a24f...","userId":"c8b1...","requestId":"7f0a...","msg":"request created"}
```

主要フィールド:

| フィールド | 意味 |
|---|---|
| `level` | pino 数値 (10=trace / 20=debug / 30=info / 40=warn / 50=error / 60=fatal) |
| `time` | UNIX ms |
| `msg` | ログメッセージ |
| `tenantId` | セッションガード後は常に付与 |
| `userId` | 同上 |
| `requestId` | route ハンドラごとにサーバ側で新規生成 (`x-request-id` ヘッダがあればそれを採用) |
| `runId` | worker tick 単位で振られる ID (main.ts) |
| `err` | 例外オブジェクト。pino がスタックトレースを整形する |

## 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `LOG_LEVEL` | `production` は `info`、それ以外は `debug` | 出力レベル閾値 |

## コンテキスト伝搬 (AsyncLocalStorage)

セッションガードで tenantId / userId / requestId が [enterLogContext](../../src/lib/logger.ts) 経由で埋め込まれる。以降 `await` チェーン内で発行されるすべての `logger.*(...)` に自動で付く。

worker (`src/worker/main.ts`) は 60 秒 tick ごとに `runWithLogContext({ runId })` でラップしている。

## Loki 連携例

Grafana Alloy / Promtail の設定例:

```yaml
loki.source.docker "nudge" {
  targets    = discovery.docker.containers.targets
  forward_to = [loki.write.default.receiver]
  labels     = { service = "nudge", env = "prod" }
}

loki.write "default" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

Loki 側で `tenantId` / `requestId` を label に昇格させたい場合は `stage.json` + `stage.labels` で拾える (量が多いため通常は非推奨、フィールド検索で対応)。

## Sentry / Datadog

構造化フィールドがそのまま渡るため個別マッピング不要。tenant テナントごとの絞り込みは `tenantId` を保存済みクエリに保存すると便利。

## トラブルシュート

- **ログが `[object Object]` になる**: pino ではオブジェクトは第 1 引数、メッセージは第 2 引数。`logger.info({ foo: 'bar' }, 'created')` の順で書く。
- **worker で tenantId が付かない**: worker は tenant 特定前の tick も持つ。tenant を跨ぐ処理 (retention 等) では `logger.info({ tenantId }, ...)` を明示的に添える。
