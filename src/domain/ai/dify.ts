import {
  type AIProvider,
  type AIFormatResult,
  type TenantAIConfig,
  AIFormatError,
  fetchWithTimeout,
} from './provider';

/**
 * Dify workflow を呼び出すプロバイダ。
 * - エンドポイント: `{endpoint}/v1/workflows/run`
 * - 入力: `{inputs: {memo}, user: 'nudge', response_mode: 'blocking'}`
 * - 出力: `data.outputs.{title, body}` を期待
 *
 * Dify workflow 側で `inputs.memo` を受け取り、output に `title` と `body` を
 * 構造化して返す前提。プロンプトは Dify アプリ内で管理する。
 */
export class DifyProvider implements AIProvider {
  constructor(private readonly config: TenantAIConfig) {
    if (!config.endpoint) throw new AIFormatError('dify endpoint missing', 'config');
    if (!config.difyAppId) throw new AIFormatError('dify_app_id missing', 'config');
    if (!config.apiKey) throw new AIFormatError('dify api_key missing', 'config');
  }

  async formatRequest(memo: string): Promise<AIFormatResult> {
    const url = `${this.config.endpoint.replace(/\/$/, '')}/v1/workflows/run`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        inputs: { memo },
        user: 'nudge',
        response_mode: 'blocking',
      }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new AIFormatError('dify auth failed', 'auth', res.status);
    }
    if (res.status === 429) {
      throw new AIFormatError('dify rate limited', 'rate_limited', 429);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AIFormatError(`dify http ${res.status}: ${text.slice(0, 200)}`, 'http', res.status);
    }
    const json = await res.json().catch(() => null);
    const outputs = (json as { data?: { outputs?: unknown } } | null)?.data?.outputs;
    const title = (outputs as { title?: unknown } | undefined)?.title;
    const body = (outputs as { body?: unknown } | undefined)?.body;
    if (typeof title !== 'string' || typeof body !== 'string' || !title.trim()) {
      throw new AIFormatError('dify response missing title/body strings', 'invalid_response');
    }
    return { title: title.trim(), body: body.trim() };
  }
}
