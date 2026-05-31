import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../_lib/session-guard';
import { getAIConfigForCall } from '@/domain/ai/config';
import { createProvider, AIFormatError } from '@/domain/ai/provider';

export const runtime = 'nodejs';

const TEST_MEMO = 'アンケート回答依頼';

/**
 * POST /admin/api/settings/ai/test
 * 現在保存済みの tenant_ai_config を使って疎通確認する。固定メモ
 * 「アンケート回答依頼」を送信し、{title, body} を返す。
 * 保存されている設定で動くかの確認用なので、リクエストボディは見ない。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  if (!guard.actor.isTenantAdmin) {
    return NextResponse.json({ error: 'tenant_admin only' }, { status: 403 });
  }

  const config = await getAIConfigForCall(appPool(), guard.actor);
  if (!config) {
    return NextResponse.json({ error: '設定が保存されていません' }, { status: 400 });
  }

  try {
    const provider = createProvider(config);
    const result = await provider.formatRequest(TEST_MEMO);
    return NextResponse.json({ ok: true, memo: TEST_MEMO, ...result });
  } catch (err) {
    if (err instanceof AIFormatError) {
      const status =
        err.code === 'auth' ? 401 :
        err.code === 'rate_limited' ? 429 :
        err.code === 'timeout' ? 504 :
        err.code === 'config' ? 400 :
        502;
      return NextResponse.json(
        { error: err.message, code: err.code, providerStatus: err.status },
        { status },
      );
    }
    throw err;
  }
}
