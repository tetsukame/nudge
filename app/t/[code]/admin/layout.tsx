import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { isTenantAdmin } from '@/domain/admin/guard';

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const ok = await isTenantAdmin(appPool(), session.tenantId, session.userId);
  if (!ok) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-3">
        <p className="text-lg font-medium text-gray-900">
          🔒 アクセス権がありません
        </p>
        <p className="text-sm text-gray-600">
          管理画面はテナント管理者のみが利用できます。
        </p>
        <Link
          href={`/t/${code}/requests`}
          className="inline-block text-sm text-blue-600 hover:underline"
        >
          ← トップに戻る
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
