/**
 * NDG-100 (v0.25 A2): OpenTelemetry SDK ブートストラップ。
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` が未設定なら完全に no-op。SDK も起動しない。
 * OSS デフォルトを「観測 off」にしたいため。ラボ環境では下記を .env に:
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *   OTEL_SERVICE_NAME=nudge-web
 *
 * ## 収集項目
 * - HTTP スパン (auto-instrumentation-http)
 * - PostgreSQL クエリスパン (auto-instrumentation-pg)
 * - Next.js の Route Handler スパン (Next.js が自前で OTel API を叩く)
 * - カスタムメトリクス:
 *   - `nudge.api.request.duration` (histogram, ms): /api ルートのレイテンシ
 *
 * ## 呼び出しタイミング
 * Next.js: `instrumentation.ts` の `register()` から。
 * worker: `src/worker/main.ts` の最初の行から (require フックが auto-instrument
 * を有効化するため、ほかの import より前に走らせる必要がある)。
 */

import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';

let sdk: NodeSDK | null = null;
let meter: Meter | null = null;
let requestDurationHistogram: Histogram | null = null;

// NDG-101 (v0.26 A3 業務メトリクス)
let notificationSendCounter: Counter | null = null;
let syncDurationHistogram: Histogram | null = null;
let retentionDeletedCounter: Counter | null = null;

/** 起動済みかどうか。テスト・二重初期化ガード用。 */
export function isOtelInitialized(): boolean {
  return sdk !== null;
}

/**
 * OTel SDK を初期化して起動する。endpoint 未設定なら false 返して no-op。
 * すでに初期化済みなら何もせず true を返す。
 */
export async function initOtel(): Promise<boolean> {
  if (sdk) return true;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return false;

  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = await import(
    '@opentelemetry/auto-instrumentations-node'
  );
  const { OTLPTraceExporter } = await import(
    '@opentelemetry/exporter-trace-otlp-http'
  );
  const { OTLPMetricExporter } = await import(
    '@opentelemetry/exporter-metrics-otlp-http'
  );
  const { PeriodicExportingMetricReader } = await import(
    '@opentelemetry/sdk-metrics'
  );
  const { resourceFromAttributes } = await import(
    '@opentelemetry/resources'
  );
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
    '@opentelemetry/semantic-conventions'
  );
  const { metrics } = await import('@opentelemetry/api');

  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'nudge';
  const serviceVersion = process.env.OTEL_SERVICE_VERSION ?? 'dev';

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      // 60s ごとに export。OTLP 受信側の負荷抑制と可視化ラグのバランス。
      exportIntervalMillis: 60_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs は膨大なスパンが出るので抑制
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  meter = metrics.getMeter(serviceName, serviceVersion);
  requestDurationHistogram = meter.createHistogram(
    'nudge.api.request.duration',
    {
      description: 'API route handler duration',
      unit: 'ms',
    },
  );

  // NDG-101: 業務メトリクス
  notificationSendCounter = meter.createCounter(
    'nudge.notification.send_total',
    {
      description: 'Notification send attempts by channel and outcome',
    },
  );
  syncDurationHistogram = meter.createHistogram(
    'nudge.sync.duration_seconds',
    {
      description: 'IdP/CSV sync duration per tenant',
      unit: 's',
    },
  );
  retentionDeletedCounter = meter.createCounter(
    'nudge.retention.deleted_total',
    {
      description: 'Rows soft/hard deleted by retention worker',
    },
  );

  // graceful shutdown: SIGTERM でエクスポート flush してから終了
  const shutdown = async (): Promise<void> => {
    if (!sdk) return;
    try {
      await sdk.shutdown();
    } catch {
      // shutdown 失敗は握りつぶす: プロセス終了を妨げない
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return true;
}

/**
 * API ルートのレイテンシを記録する。OTel 未初期化なら no-op。
 * route / method / status を attribute として付ける。
 */
export function recordApiDuration(attrs: {
  route: string;
  method: string;
  status: number;
  durationMs: number;
}): void {
  if (!requestDurationHistogram) return;
  requestDurationHistogram.record(attrs.durationMs, {
    route: attrs.route,
    method: attrs.method,
    status: attrs.status,
  });
}

/**
 * 通知チャネルごとの送信結果を計測 (NDG-101)。
 * channel: email|teams|slack|in_app、result: success|fail
 */
export function recordNotificationSend(attrs: {
  channel: string;
  result: 'success' | 'fail';
  tenantId?: string;
}): void {
  if (!notificationSendCounter) return;
  notificationSendCounter.add(1, {
    channel: attrs.channel,
    result: attrs.result,
    ...(attrs.tenantId ? { tenant_id: attrs.tenantId } : {}),
  });
}

/**
 * IdP / CSV sync 1 回分の所要時間 (NDG-101)。
 * source: keycloak|csv、result: success|fail。
 */
export function recordSyncDuration(attrs: {
  source: string;
  result: 'success' | 'fail';
  tenantId: string;
  durationSeconds: number;
}): void {
  if (!syncDurationHistogram) return;
  syncDurationHistogram.record(attrs.durationSeconds, {
    source: attrs.source,
    result: attrs.result,
    tenant_id: attrs.tenantId,
  });
}

/**
 * Retention worker が削除した行数 (NDG-101)。
 * kind: soft|hard、entity: notification|request|...
 */
export function recordRetentionDeleted(attrs: {
  kind: 'soft' | 'hard';
  entity: string;
  tenantId: string;
  count: number;
}): void {
  if (!retentionDeletedCounter) return;
  if (attrs.count <= 0) return;
  retentionDeletedCounter.add(attrs.count, {
    kind: attrs.kind,
    entity: attrs.entity,
    tenant_id: attrs.tenantId,
  });
}
