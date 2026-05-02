import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { getOrgTree, type OrgTreeNode } from '@/domain/org/tree';
import { AdminUsersBrowser } from '@/ui/components/admin-users-browser';

export const runtime = 'nodejs';

type FlatOrg = { id: string; name: string; level: number };

function flatten(nodes: OrgTreeNode[], level: number, acc: FlatOrg[]): void {
  for (const n of nodes) {
    acc.push({ id: n.id, name: n.name, level });
    flatten(n.children, level + 1, acc);
  }
}

export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const tree = await getOrgTree(appPool(), {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  });
  const flat: FlatOrg[] = [];
  flatten(tree, 0, flat);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/admin`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 管理に戻る
      </Link>
      <h1 className="text-xl font-bold text-gray-900">👥 ユーザー管理</h1>

      <AdminUsersBrowser tenantCode={code} orgUnits={flat} currentUserId={session.userId} />
    </div>
  );
}
