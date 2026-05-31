import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import { encryptSecret, decryptSecret } from '../../notification/crypto';
import type { ActorContext } from '../types';
import type { AIProviderKind, TenantAIConfig } from './provider';

export class AIConfigError extends Error {
  constructor(
    message: string,
    readonly code: 'validation' | 'permission_denied' | 'not_found',
  ) {
    super(message);
    this.name = 'AIConfigError';
  }
}

export type AIConfigView = {
  enabled: boolean;
  provider: AIProviderKind;
  endpoint: string;
  difyAppId: string | null;
  model: string | null;
  systemPrompt: string | null;
  defaultUserPrompt: string | null;
  hasApiKey: boolean;
};

export type UpsertAIConfigInput = {
  enabled: boolean;
  provider: AIProviderKind;
  endpoint: string;
  difyAppId?: string | null;
  model?: string | null;
  apiKey?: string | null;
  systemPrompt?: string | null;
  defaultUserPrompt?: string | null;
};

function ensureAdmin(actor: ActorContext) {
  if (!actor.isTenantAdmin) {
    throw new AIConfigError('tenant_admin only', 'permission_denied');
  }
}

export async function getAIConfigView(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<AIConfigView | null> {
  ensureAdmin(actor);
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT enabled, provider, endpoint, dify_app_id, model,
              api_key_encrypted, system_prompt, default_user_prompt
         FROM tenant_ai_config WHERE tenant_id=$1`,
      [actor.tenantId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      enabled: r.enabled,
      provider: r.provider,
      endpoint: r.endpoint,
      difyAppId: r.dify_app_id,
      model: r.model,
      systemPrompt: r.system_prompt,
      defaultUserPrompt: r.default_user_prompt,
      hasApiKey: !!r.api_key_encrypted,
    };
  });
}

/**
 * Provider 経由でリクエスト送信するための、復号済み TenantAIConfig を取得する。
 * Phase 1 ではテスト送信エンドポイントから呼ばれる。Phase 2 では依頼作成
 * フォーマット API からも呼ばれる。
 */
export async function getAIConfigForCall(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<TenantAIConfig | null> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT enabled, provider, endpoint, dify_app_id, model,
              api_key_encrypted, system_prompt, default_user_prompt
         FROM tenant_ai_config WHERE tenant_id=$1`,
      [actor.tenantId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      enabled: r.enabled,
      provider: r.provider,
      endpoint: r.endpoint,
      difyAppId: r.dify_app_id,
      model: r.model,
      apiKey: r.api_key_encrypted ? decryptSecret(r.api_key_encrypted) : null,
      systemPrompt: r.system_prompt,
      defaultUserPrompt: r.default_user_prompt,
    };
  });
}

function validate(input: UpsertAIConfigInput) {
  if (input.provider !== 'dify' && input.provider !== 'openai_compat') {
    throw new AIConfigError(`invalid provider: ${input.provider}`, 'validation');
  }
  if (!input.endpoint?.trim()) {
    throw new AIConfigError('endpoint required', 'validation');
  }
  try {
    const u = new URL(input.endpoint);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('non-http(s)');
    }
  } catch {
    throw new AIConfigError('endpoint must be a valid http(s) URL', 'validation');
  }
  if (input.provider === 'dify') {
    if (!input.difyAppId?.trim()) {
      throw new AIConfigError('dify_app_id required for provider=dify', 'validation');
    }
  }
  if (input.provider === 'openai_compat') {
    if (!input.model?.trim()) {
      throw new AIConfigError('model required for provider=openai_compat', 'validation');
    }
  }
}

export async function upsertAIConfig(
  pool: pg.Pool,
  actor: ActorContext,
  input: UpsertAIConfigInput,
): Promise<void> {
  ensureAdmin(actor);
  validate(input);
  await withTenant(pool, actor.tenantId, async (client) => {
    // apiKey が null かつ既存に値あり → 既存を維持。空文字 → 削除。値あり → 暗号化置換。
    let apiKeyClause = '';
    const params: unknown[] = [
      actor.tenantId,
      input.enabled,
      input.provider,
      input.endpoint.trim(),
      input.difyAppId?.trim() || null,
      input.model?.trim() || null,
      input.systemPrompt?.trim() || null,
      input.defaultUserPrompt?.trim() || null,
    ];
    if (input.apiKey === undefined || input.apiKey === null) {
      apiKeyClause = `COALESCE(
        (SELECT api_key_encrypted FROM tenant_ai_config WHERE tenant_id=$1),
        NULL
      )`;
    } else if (input.apiKey === '') {
      apiKeyClause = 'NULL';
    } else {
      params.push(encryptSecret(input.apiKey));
      apiKeyClause = `$${params.length}`;
    }

    await client.query(
      `INSERT INTO tenant_ai_config (
         tenant_id, enabled, provider, endpoint, dify_app_id, model,
         system_prompt, default_user_prompt, api_key_encrypted
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${apiKeyClause})
       ON CONFLICT (tenant_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         provider = EXCLUDED.provider,
         endpoint = EXCLUDED.endpoint,
         dify_app_id = EXCLUDED.dify_app_id,
         model = EXCLUDED.model,
         system_prompt = EXCLUDED.system_prompt,
         default_user_prompt = EXCLUDED.default_user_prompt,
         api_key_encrypted = EXCLUDED.api_key_encrypted,
         updated_at = now()`,
      params,
    );
  });
}
