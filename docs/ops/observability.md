# 観測性 (Observability) 統合ガイド

Nudge の運用可視化は 3 本柱で構成されている (NDG-56 の A〜D):

| 種別 | 実装 | 実装状況 | 個別ドキュメント |
|---|---|---|---|
| 構造化ログ (Logs) | [pino](https://getpino.io/) + AsyncLocalStorage | NDG-99 (v0.25) | [logging.md](logging.md) |
| メトリクス & トレース | [OpenTelemetry](https://opentelemetry.io/) SDK + 業務メトリクス | NDG-100 / NDG-101 | [metrics.md](metrics.md) |
| エラー監視 | [Sentry](https://sentry.io/) opt-in | NDG-102 | [sentry.md](sentry.md) |

**OSS デフォルト**: どれも無効。環境変数を設定した時のみ有効化される (dev で無関心なユーザーに突然コストを負わせない設計)。

## クイックスタート: Grafana + Loki + Tempo + Prometheus

自宅ラボ / 社内オンプレで Nudge の観測性を丸ごと立ち上げる最小構成例。

### 前提

- Grafana Loki (ログ集約)
- Grafana Tempo (トレース)
- Prometheus (メトリクス、OTLP receiver 有効)
- Grafana (可視化)
- 上記に到達できる Alloy / OTel Collector

### Nudge 側 `.env`

```
# 構造化ログ (デフォルトで出るが LOG_LEVEL 制御可)
LOG_LEVEL=info

# OpenTelemetry (メトリクス + トレース)
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=nudge-web
OTEL_SERVICE_VERSION=v0.26.0

# エラー監視 (self-hosted Sentry 推奨)
SENTRY_DSN=https://<key>@sentry.example.com/<project>
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=v0.26.0
```

### OTel Collector 設定例 (config.yaml)

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls: { insecure: true }
  prometheusremotewrite:
    endpoint: http://prometheus:9090/api/v1/write

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlp/tempo]
    metrics:
      receivers: [otlp]
      exporters: [prometheusremotewrite]
```

### ログ (Loki) は Docker の logging driver で送る

Nudge は stdout に JSON を吐くので、Docker Compose の `logging` 設定で Loki driver に流すのが手軽:

```yaml
services:
  nudge-web:
    image: nudge:v0.26
    logging:
      driver: loki
      options:
        loki-url: "http://loki:3100/loki/api/v1/push"
        loki-external-labels: "service=nudge,env=prod"
```

もしくは Grafana Alloy を別途立てて Docker ソケット経由で拾う (Alloy 版は [logging.md](logging.md#loki-連携例) 参照)。

## Grafana ダッシュボードの推奨パネル

Panel 例 (PromQL / LogQL の一部):

| 目的 | クエリ |
|---|---|
| /api レイテンシ p95 | `histogram_quantile(0.95, sum by(le,route) (rate(nudge_api_request_duration_bucket[5m])))` |
| 通知送信成功率 | `sum(rate(nudge_notification_send_total{result="success"}[5m])) / sum(rate(nudge_notification_send_total[5m]))` |
| チャネル別送信件数 | `sum by(channel,result) (rate(nudge_notification_send_total[5m]))` |
| KC 同期所要時間 (tenant 別) | `histogram_quantile(0.9, sum by(le,tenant_id) (rate(nudge_sync_duration_seconds_bucket[15m])))` |
| Retention 削除累計 | `sum by(entity,kind) (increase(nudge_retention_deleted_total[24h]))` |
| エラーログ | LogQL: `{service="nudge"} \| json \| level="error"` |

Grafana template variable として `tenant_id` を用意しておくと便利 (メトリクスにも同名ラベルが付いているので統一表示できる)。

## トラブルシューティングの流れ

**ユーザーから「特定 tenant で通知が届かない」と報告があった場合の追い方**:

1. Grafana で **通知送信成功率パネル** の `tenant_id` フィルタを絞る → 直近 15 分の fail 率が急上昇していないか確認
2. Loki で `{service="nudge"} | json | tenantId="<id>" | level="warn" or level="error"` → 該当 tenant のエラーログを時系列で見る
3. Sentry の Issue から `tag:tenant_id=<id>` で該当例外を探す (release / environment でさらに絞る)
4. Tempo で問題の requestId (ログの `requestId` フィールド) を検索 → span を追ってどのステップが遅い / エラーかを特定

`requestId` は 3 系統 (ログ / トレース / Sentry) 全てに載っているので、ここで橋渡しできる。

## 実装との対応

| 何を計測するか | 出す場所 | 使うヘルパ |
|---|---|---|
| 追加のログ | 任意コード | [`logger.info({ ... })`](../../src/lib/logger.ts) |
| API 系ヒストグラム | route ハンドラ | [`recordApiDuration`](../../src/lib/otel.ts) (現状 opt-in) |
| 通知送信の成否 | [`worker/sender.ts`](../../src/worker/sender.ts) | [`recordNotificationSend`](../../src/lib/otel.ts) |
| 同期所要時間 | [`domain/platform/sync.ts`](../../src/domain/platform/sync.ts) | [`recordSyncDuration`](../../src/lib/otel.ts) |
| Retention 削除件数 | [`worker/retention.ts`](../../src/worker/retention.ts) | [`recordRetentionDeleted`](../../src/lib/otel.ts) |
| 明示的な例外送信 | 任意コード | [`captureException`](../../src/lib/sentry.ts) |

## 権限モデル (誰が何を見るか)

- **開発者 / SRE**: Grafana / Sentry フル権限
- **tenant_admin**: Nudge 内の失敗通知タブ ([/admin/failed-notifications](../../app/t/[code]/admin/failed-notifications/page.tsx)) から手動再送。Sentry 直接アクセスは通常なし
- **platform_admin**: /root/sync ページで直近の sync_log を確認可能。Grafana / Sentry の tenant 別集計を並行して見る想定

Grafana / Sentry 側のマルチテナント分離は、ラベル (`tenant_id`) ベースの検索や organization 分離で運用する (Nudge 側ではその設定を強制しない)。
