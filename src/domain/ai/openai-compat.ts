import {
  type AIProvider,
  type AIFormatResult,
  type TenantAIConfig,
  AIFormatError,
  fetchWithTimeout,
} from './provider';

const DEFAULT_SYSTEM_PROMPT = `あなたは社内依頼の文書整形アシスタントです。
入力された要件メモから、簡潔な依頼タイトルと、受信者が何をすべきか明確にわかる本文を生成してください。

必ず次の JSON 形式で返してください（他のテキストは一切含めない）:
{"title": "...", "body": "..."}

- title: 30 文字以内、何をするかが一目でわかる
- body: 受信者向けに丁寧語で、目的・期限イメージ・成果物を箇条書きまたは短い段落で`;

/**
 * OpenAI 互換 API (LM Studio / Ollama / OpenAI 等) を呼び出すプロバイダ。
 * - エンドポイント: `{endpoint}/chat/completions` (endpoint は /v1 まで含む想定)
 * - JSON mode で `{title, body}` を返してもらう
 * - system_prompt はテナント設定優先、未設定時は DEFAULT_SYSTEM_PROMPT
 */
export class OpenAICompatProvider implements AIProvider {
  constructor(private readonly config: TenantAIConfig) {
    if (!config.endpoint) throw new AIFormatError('endpoint missing', 'config');
    if (!config.model) throw new AIFormatError('model missing', 'config');
  }

  async formatRequest(memo: string): Promise<AIFormatResult> {
    const url = `${this.config.endpoint.replace(/\/$/, '')}/chat/completions`;
    const system = this.config.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: memo },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new AIFormatError('openai-compat auth failed', 'auth', res.status);
    }
    if (res.status === 429) {
      throw new AIFormatError('openai-compat rate limited', 'rate_limited', 429);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AIFormatError(`openai-compat http ${res.status}: ${text.slice(0, 200)}`, 'http', res.status);
    }
    const json = await res.json().catch(() => null) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AIFormatError('openai-compat response missing choices[0].message.content', 'invalid_response');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AIFormatError('openai-compat content is not valid JSON', 'invalid_response');
    }
    const title = (parsed as { title?: unknown }).title;
    const body = (parsed as { body?: unknown }).body;
    if (typeof title !== 'string' || typeof body !== 'string' || !title.trim()) {
      throw new AIFormatError('openai-compat JSON missing title/body strings', 'invalid_response');
    }
    return { title: title.trim(), body: body.trim() };
  }
}
