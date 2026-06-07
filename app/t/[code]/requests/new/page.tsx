import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlusCircle } from 'lucide-react';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import {
  getRequestForCopy,
  CopySourceError,
  type CopySource,
} from '@/domain/request/get-for-copy';
import { loadPageContext } from '@/domain/page-context';
import { PageHeader } from '@/ui/components/page-header';
import { NewRequestForm } from '@/ui/components/new-request-form';

export const runtime = 'nodejs';

export default async function NewRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ group?: string; copyFrom?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;

  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  // NDG-93 (A3 P8): ロール 2 種 + AI 設定を 1 トランザクションでまとめて取得
  const ctx = await loadPageContext(
    appPool(),
    session.tenantId,
    session.userId,
    { needAIEnabled: true },
  );

  let copySource: CopySource | null = null;
  let copyError: string | null = null;
  let copySourceTitle: string | null = null;
  if (sp.copyFrom) {
    try {
      copySource = await getRequestForCopy(
        appPool(),
        {
          userId: session.userId,
          tenantId: session.tenantId,
          isTenantAdmin: ctx.isTenantAdmin,
          isTenantWideRequester: ctx.isTenantWideRequester,
        },
        sp.copyFrom,
      );
      copySourceTitle = copySource.title;
    } catch (err) {
      if (err instanceof CopySourceError) {
        copyError =
          err.code === 'not_found'
            ? '元の依頼が見つかりませんでした。'
            : 'この依頼をコピーする権限がありません。';
      } else {
        copyError = '依頼の読み込みに失敗しました。';
      }
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/requests`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 一覧に戻る
      </Link>

      <PageHeader
        icon={<PlusCircle />}
        title="新規依頼作成"
        description="送信先・期限・想定時間を指定して新しい依頼を作成します。"
      />

      {copyError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {copyError}
        </div>
      )}

      <NewRequestForm
        tenantCode={code}
        initialGroupId={sp.group ?? null}
        initialValues={
          copySource
            ? {
                title: copySource.title,
                body: copySource.body,
                estimatedMinutes: copySource.estimatedMinutes,
                senderOrgUnitId: copySource.senderOrgUnitId,
                targets: copySource.targets,
              }
            : undefined
        }
        copySourceTitle={copySourceTitle}
        droppedTargets={copySource?.droppedTargets}
        initialOrgMeta={copySource?.orgMeta}
        initialUserMeta={copySource?.userMeta}
        aiEnabled={ctx.aiEnabled ?? false}
      />
    </div>
  );
}
