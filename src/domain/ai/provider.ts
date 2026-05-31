/**
 * NDG-73: AI 整形プロバイダ抽象。
 * 「要件メモ」を渡して `{title, body}` を返してもらうだけのシンプルな
 * インターフェース。実装は DifyProvider / OpenAICompatProvider。
 */

export type AIProviderKind = 'dify' | 'openai_compat';

export type TenantAIConfig = {
  enabled: boolean;
  provider: AIProviderKind;
  endpoint: string;
  difyAppId: string | null;
  model: string | null;
  apiKey: string | null;
  systemPrompt: string | null;
  defaultUserPrompt: string | null;
};

export type AIFormatResult = {
  title: string;
  body: string;
};

export class AIFormatError extends Error {
  constructor(
    message: string,
    readonly code: 'timeout' | 'http' | 'invalid_response' | 'rate_limited' | 'auth' | 'config',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AIFormatError';
  }
}

export interface AIProvider {
  formatRequest(memo: string): Promise<AIFormatResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AIFormatError(`request timed out after ${timeoutMs}ms`, 'timeout');
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

export function createProvider(config: TenantAIConfig): AIProvider {
  if (config.provider === 'dify') {
    return new DifyProvider(config);
  }
  return new OpenAICompatProvider(config);
}

import { DifyProvider } from './dify';
import { OpenAICompatProvider } from './openai-compat';
