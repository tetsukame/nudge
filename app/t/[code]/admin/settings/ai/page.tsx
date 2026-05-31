import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { getAIConfigView } from '@/domain/ai/config';
import { PageHeader } from '@/ui/components/page-header';
import { AIConfigForm } from '@/ui/components/ai-config-form';

export const runtime = 'nodejs';

export default async function AIConfigPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const isAdmin = await withTenant(appPool(), session.tenantId, async (client) => {
    const { rows } = await client.query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1`,
      [session.userId],
    );
    return rows.some((r) => r.role === 'tenant_admin');
  });
  if (!isAdmin) redirect(`/t/${code}/requests`);

  const view = await getAIConfigView(appPool(), {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/admin`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 管理に戻る
      </Link>

      <PageHeader
        icon={<Sparkles />}
        title="AI 整形の設定"
        description="依頼作成画面で「要件メモ → タイトル+本文」を整形する AI を設定します。"
      />

      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
        ⚠️ 要件メモは選択したプロバイダ（外部サービスまたはローカル LLM）に
        送信されます。社外秘情報を含む可能性がある場合は、自社管理の
        OpenAI 互換エンドポイント（LM Studio / Ollama 等）を選んでください。
      </div>

      <AIConfigForm tenantCode={code} initial={view} />
    </div>
  );
}
