/**
 * NDG-100 (v0.25 A2): Next.js の instrumentation hook。
 *
 * Next.js は自動でこのファイルの `register()` を server 起動時に 1 度だけ呼ぶ。
 * OTel SDK は import 順序が重要で (auto-instrumentation の require フックを
 * まっさきに仕掛ける必要がある)、ここで初期化するのが標準パターン。
 *
 * Edge runtime では OTel SDK が動かないので nodejs だけで初期化。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initOtel } = await import('./src/lib/otel');
    await initOtel();
    // NDG-102: Sentry は OTel の後に初期化 (require フック順序を汚さない)。
    // SENTRY_DSN 未設定なら no-op で SDK すら import されない。
    const { initSentry } = await import('./src/lib/sentry');
    await initSentry();
  }
}
