import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { listFailedNotifications } from '@/domain/notification/list-failed';
import { FailedNotificationsBrowser } from '@/ui/components/failed-notifications-browser';

export const runtime = 'nodejs';

export default async function FailedNotificationsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const initial = await listFailedNotifications(appPool(), {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/admin`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 管理に戻る
      </Link>
      <h1 className="text-xl font-bold text-gray-900">⚠️ 失敗通知（手動再送）</h1>
      <p className="text-sm text-gray-600">
        リトライ上限に達して永続失敗となった通知の一覧です。チェックして「再送」を押すと、worker が次回のチック (最大 1 分後) で再送します。
      </p>

      <FailedNotificationsBrowser
        tenantCode={code}
        initialItems={initial.items}
        initialTotal={initial.total}
      />
    </div>
  );
}
