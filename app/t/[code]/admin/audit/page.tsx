import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { listAuditLog } from '@/domain/audit-log/list';
import { AuditLogBrowser } from '@/ui/components/audit-log-browser';

export const runtime = 'nodejs';

export default async function AdminAuditPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  // Initial load (no filters) so the page renders without a flash
  const initial = await listAuditLog(
    appPool(),
    {
      userId: session.userId,
      tenantId: session.tenantId,
      isTenantAdmin: true,
      isTenantWideRequester: false,
    },
    { page: 1, pageSize: 50 },
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/admin`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 管理に戻る
      </Link>
      <h1 className="text-xl font-bold text-gray-900">📋 監査ログ</h1>

      <AuditLogBrowser
        tenantCode={code}
        initialItems={initial.items}
        initialTotal={initial.total}
        actions={initial.actions}
      />
    </div>
  );
}
