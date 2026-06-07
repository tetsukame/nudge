import { NextResponse } from 'next/server';

/**
 * NDG-93 (A2 E5): Domain エラー → HTTP レスポンスの一元マッピング。
 *
 * 各 route の catch ブロックで `if (err instanceof XxxError)` →
 * `permission_denied → 403, validation → 400` を毎回手で書いていたのを
 * 共通化する。新しい DomainError 系クラスを増やすときも `code` プロパティ
 * の名前さえ揃えれば追加修正不要で 4xx になる。
 *
 * 使い方:
 *   try {
 *     await upsertX(...);
 *     return NextResponse.json({ ok: true });
 *   } catch (err) {
 *     const r = mapDomainError(err);
 *     if (r) return r;
 *     throw err;  // 想定外は 500 で
 *   }
 *
 * DomainError-like = `name` と `code: string` を持ち、`Error` を継承して
 * いるオブジェクト全般。`instanceof` ではなく duck typing で判定するため、
 * 共通基底クラスを作らずとも個別の RequestCancelError / AIConfigError
 * 等が透過的に対応する。
 */

const STATUS_BY_CODE: Record<string, number> = {
  // 認可
  permission_denied: 403,
  kc_readonly: 403,           // groups: KC 同期グループは読み取り専用
  // リソース
  not_found: 404,
  // 競合 / 状態不整合
  conflict: 409,
  invalid_state: 409,
  already_running: 409,       // sync が走行中
  last_admin: 409,            // 最後の tenant_admin を奪う動きの拒否
  // 入力検証
  validation: 400,
  invalid_targets: 400,
  empty_expansion: 400,
  // 認証 / 上流プロバイダ
  auth: 502,                  // 上流プロバイダ認証失敗 (AI 等)
  rate_limited: 429,
  timeout: 504,
  invalid_response: 502,      // プロバイダ応答不整合
  config: 500,                // 設定不備 (内部)
};

type DomainErrorLike = Error & { code: string };

function isDomainError(err: unknown): err is DomainErrorLike {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0;
}

/**
 * domain エラーを NextResponse に変換する。該当しなければ null を返すので、
 * 呼び出し側で `throw err` して 500 にすればよい。
 */
export function mapDomainError(err: unknown): NextResponse | null {
  if (!isDomainError(err)) return null;
  const status = STATUS_BY_CODE[err.code] ?? 400;
  return NextResponse.json(
    { error: err.message, code: err.code },
    { status },
  );
}
