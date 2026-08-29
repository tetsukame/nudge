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
import type { Histogram, Meter } from '@opentelemetry/api';

let sdk: NodeSDK | null = null;
let meter: Meter | null = null;
let requestDurationHistogram: Histogram | null = null;

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
