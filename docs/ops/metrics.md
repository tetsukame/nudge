# メトリクス / トレース (OpenTelemetry)

Nudge は OpenTelemetry SDK 経由で OTLP エンドポイントに **トレース + メトリクス** を送出できる (NDG-100)。

OSS デフォルトは **無効**。`OTEL_EXPORTER_OTLP_ENDPOINT` 環境変数を設定した時のみ SDK が起動する。

## 有効化

`.env` に:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=nudge-web   # 任意 (default: nudge)
OTEL_SERVICE_VERSION=v0.25    # 任意 (default: dev)
```

エンドポイントは OTLP/HTTP を想定 (`/v1/traces` と `/v1/metrics` にサブパスが付く)。gRPC を使いたい場合は `@opentelemetry/exporter-*-otlp-grpc` に差し替え。

## 受信側

代表的な組合せ:

| 用途 | 受信側 |
|---|---|
| トレース | [Jaeger](https://www.jaegertracing.io/) / [Tempo](https://grafana.com/oss/tempo/) |
| メトリクス | [Prometheus (OTLP 受信対応)](https://prometheus.io/docs/prometheus/latest/feature_flags/#otlp-receiver) / [Datadog](https://www.datadoghq.com/) |
| コレクタ | [OTel Collector](https://opentelemetry.io/docs/collector/) に集約してから流すのが一般的 |

## 収集される項目

### トレース (auto-instrumentation)

- **HTTP サーバ**: 全 API ルートに `http.server.*` スパン
- **PostgreSQL**: `pg` ドライバ経由の全クエリにスパン
- **HTTP クライアント**: fetch / undici / OIDC / Sentry 等のアウトバウンド

### メトリクス

`@opentelemetry/instrumentation-http` が下記を自動で emit する:

| メトリクス | 種別 | ラベル |
|---|---|---|
| `http.server.request.duration` | ヒストグラム (秒) | `http.request.method`, `http.route`, `http.response.status_code` |

追加で Nudge がカスタム emit する:

| メトリクス | 種別 | ラベル |
|---|---|---|
| `nudge.api.request.duration` | ヒストグラム (ms) | `route`, `method`, `status` |
| `nudge.notification.send_total` | カウンタ | `channel`, `result`, `tenant_id` |
| `nudge.sync.duration_seconds` | ヒストグラム (s) | `source`, `result`, `tenant_id` |
| `nudge.retention.deleted_total` | カウンタ | `kind` (soft/hard), `entity`, `tenant_id` |

- **notification.send_total** — [src/worker/sender.ts](../../src/worker/sender.ts) が channel ごとに成功/失敗を record。`result` を使うと成功率 (success/(success+fail)) を計算できる
- **sync.duration_seconds** — [src/domain/platform/sync.ts](../../src/domain/platform/sync.ts) が Keycloak sync 1 回分の所要秒を record。IdP 側の遅延・障害を検知する初期指標に
- **retention.deleted_total** — [src/worker/retention.ts](../../src/worker/retention.ts) が soft/hard の削除行数を entity ごとに累積。想定外の急増を検知できる

`nudge.api.request.duration` は route ハンドラで [recordApiDuration](../../src/lib/otel.ts) を呼んだ場合のみ記録される (opt-in)。テナントを跨いだ集約用途は自動計測の `http.server.request.duration` で十分なので、ビジネス単位で切り分けたい場合だけ利用する。

## 二重初期化ガード

Next.js の [instrumentation.ts](../../instrumentation.ts) と worker の [bootstrap.ts](../../src/worker/bootstrap.ts) がそれぞれ `initOtel()` を呼ぶ。同じプロセス内で 2 回目以降は `sdk !== null` で早期 return する。

## トラブルシュート

- **`sdk.start` で warn が出る**: peer dependency 未満の instrumentation は自動で無効化される。ワーニングだが機能には影響なし。
- **fs スパンが膨大**: `@opentelemetry/instrumentation-fs` は既定で無効化済み ([src/lib/otel.ts](../../src/lib/otel.ts) 内)。
- **メトリクスが出ない**: `PeriodicExportingMetricReader` は 60 秒間隔なので初回 export まで 1 分待つ。
- **worker で auto-instrumentation が効かない**: [src/worker/bootstrap.ts](../../src/worker/bootstrap.ts) 経由で起動しているか確認 (main.ts 直接起動だと require フック順序ズレで instrument されない)。
