import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { mapDomainError } from '@/lib/respond';
import { getAIConfigForCall } from '@/domain/ai/config';
import { createProvider } from '@/domain/ai/provider';
import {
  assertAIFormatNotRateLimited,
  recordAIFormatRequest,
} from '@/domain/ai/rate-limit';
import { MAX_AI_FORMAT_MEMO } from '@/domain/_constants';

export const runtime = 'nodejs';

/**
 * POST /t/[code]/api/requests/format
 * 依頼作成画面の「✨ AI で整形」ボタンから叩く。
 * 認証済み actor (tenant 内ユーザー) なら誰でも使える。tenant_admin 限定にはしない:
 *   配信前段の自分のメモを AI に整形させるだけで、他人の機密に触れる API ではない。
 *
 * NDG-95 (S8): actor ごと {@link AI_FORMAT_COOLDOWN_SECONDS} 秒間隔 +
 * {@link AI_FORMAT_MAX_PER_MINUTE} 回/分の rate limit を audit_log 経由でかけている。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const memo = (body as { memo?: unknown }).memo;
  if (typeof memo !== 'string' || !memo.trim()) {
    return NextResponse.json({ error: 'memo required' }, { status: 400 });
  }
  if (memo.length > MAX_AI_FORMAT_MEMO) {
    return NextResponse.json(
      { error: `memo too long (max ${MAX_AI_FORMAT_MEMO})` },
      { status: 400 },
    );
  }

  const config = await getAIConfigForCall(appPool(), guard.actor);
  if (!config || !config.enabled) {
    return NextResponse.json({ error: 'AI 整形は無効です' }, { status: 400 });
  }

  try {
    // 1. rate limit チェック (AIFormatError code=rate_limited → 429 via mapDomainError)
    await assertAIFormatNotRateLimited(appPool(), guard.actor);
    // 2. audit_log に記録 (provider 呼び出しの前に入れる: 失敗呼び出しも数えて
    //    リトライ嵐を抑制する効果)
    await recordAIFormatRequest(appPool(), guard.actor, memo.length);
    // 3. provider 呼び出し
    const provider = createProvider(config);
    const result = await provider.formatRequest(memo);
    return NextResponse.json(result);
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
