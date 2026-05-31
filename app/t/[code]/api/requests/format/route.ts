import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { getAIConfigForCall } from '@/domain/ai/config';
import { createProvider, AIFormatError } from '@/domain/ai/provider';

export const runtime = 'nodejs';

const MAX_MEMO_LENGTH = 4000;

/**
 * POST /t/[code]/api/requests/format
 * 依頼作成画面の「✨ AI で整形」ボタンから叩く。
 * 認証済み actor (tenant 内ユーザー) なら誰でも使える。tenant_admin 限定にはしない:
 *   配信前段の自分のメモを AI に整形させるだけで、他人の機密に触れる API ではない。
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
  if (memo.length > MAX_MEMO_LENGTH) {
    return NextResponse.json(
      { error: `memo too long (max ${MAX_MEMO_LENGTH})` },
      { status: 400 },
    );
  }

  const config = await getAIConfigForCall(appPool(), guard.actor);
  if (!config || !config.enabled) {
    return NextResponse.json({ error: 'AI 整形は無効です' }, { status: 400 });
  }

  try {
    const provider = createProvider(config);
    const result = await provider.formatRequest(memo);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AIFormatError) {
      const status =
        err.code === 'auth' ? 502 :
        err.code === 'rate_limited' ? 429 :
        err.code === 'timeout' ? 504 :
        err.code === 'config' ? 500 :
        502;
      return NextResponse.json(
        { error: err.message, code: err.code, providerStatus: err.status },
        { status },
      );
    }
    throw err;
  }
}
