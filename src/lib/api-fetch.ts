/**
 * NDG-92 (A2 E6): クライアント側で `fetch + !res.ok のエラーメッセージ抽出 +
 * res.json()` の同じパターンを 5 箇所で書いていたのを共通化。
 *
 * - !res.ok → サーバが返した `{ error: string }` を取り出して throw
 * - res.json() のパース失敗時はステータスコードベースのエラーメッセージ
 * - 戻り値の型は呼び出し側が指定 (`apiFetch<{title:string;body:string}>`)
 *
 * 使い方:
 *   const data = await apiFetch<{ items: Foo[] }>('/api/foos');
 *   await apiFetch('/api/x', { method: 'PATCH', body: JSON.stringify(...) });
 *
 * 注: JSON body を送る場合は呼び出し側で `content-type: application/json`
 * ヘッダを付ける。本ヘルパーは Content-Type をいじらない。
 */
export async function apiFetch<T = unknown>(
  url: string,
  opts?: RequestInit,
): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `エラー (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * apiFetch のうち、レスポンス body を読まない (204 No Content や捨てる)
 * パターン用。`{ok: true}` だけ返ってくる API でも使える。
 */
export async function apiSend(url: string, opts: RequestInit): Promise<void> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `エラー (${res.status})`);
  }
}
