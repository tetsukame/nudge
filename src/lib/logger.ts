import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * NDG-99 (v0.25 A1): アプリ全体の構造化ログ。
 *
 * `console.log` の代わりに `logger.info(...)` / `logger.error(...)` を使う。
 * pino がデフォルトで JSON 出力するので、Loki / Datadog / CloudWatch の
 * どこに流しても機械可読で扱える。
 *
 * ## コンテキスト伝搬
 * リクエストや worker tick に紐づく識別子 (tenantId / userId / requestId / runId)
 * は AsyncLocalStorage で伝搬する。ハンドラの冒頭で 1 度セットすれば、以降の
 * すべての `await` チェーン内で発行されるログに自動で載る。
 *
 * ## 使い方
 *   // 1) session guard で自動セットされるので、route ハンドラは何もしなくてよい
 *   logger.info('request created', { requestId: 'abc' });
 *
 *   // 2) worker tick では runId を明示的にラップする
 *   await runWithLogContext({ runId }, async () => { ... });
 *
 * ## ログレベル
 * `LOG_LEVEL` 環境変数で切替 (trace/debug/info/warn/error/fatal)。
 * 未設定時: production=info, それ以外=debug。
 */

export type LogContext = {
  tenantId?: string;
  userId?: string;
  requestId?: string;
  /** worker tick 単位で振る ID */
  runId?: string;
};

const als = new AsyncLocalStorage<LogContext>();

export const logger = pino({
  level:
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  mixin() {
    return als.getStore() ?? {};
  },
});

/**
 * 新しいコンテキストで fn を実行する。親コンテキストがあれば継承しつつ上書き。
 * Promise を返す fn にも対応。
 */
export function runWithLogContext<T>(
  ctx: LogContext,
  fn: () => T,
): T {
  const parent = als.getStore() ?? {};
  return als.run({ ...parent, ...ctx }, fn);
}

/**
 * 現在の async 実行チェーンにコンテキストを "入れる" 。以降の await には
 * 引き継がれるが、呼び出し前のフレームには影響しない。
 *
 * route ハンドラは `const guard = await requireSession(...)` の直後から
 * ログにコンテキストを載せたいだけなので、`enterLogContext` を requireSession
 * 内部で呼ぶことで route 側のコードを増やさずに済む。
 *
 * Node.js の AsyncLocalStorage 仕様上、"resolve 済みの promise 経由" で呼ぶと
 * 未定義動作になるが、await 直後で呼ぶ限り安全。
 */
export function enterLogContext(ctx: LogContext): void {
  const parent = als.getStore() ?? {};
  als.enterWith({ ...parent, ...ctx });
}

export function getLogContext(): LogContext | undefined {
  return als.getStore();
}
