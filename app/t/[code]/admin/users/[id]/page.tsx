import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { getAdminUser } from '@/domain/admin/users';
import { getOrgTree, type OrgTreeNode } from '@/domain/org/tree';
import { AdminUserDetailEditor } from '@/ui/components/admin-user-detail-editor';

export const runtime = 'nodejs';

type FlatOrg = { id: string; name: string; level: number };

function flatten(nodes: OrgTreeNode[], level: number, acc: FlatOrg[]): void {
  for (const n of nodes) {
    acc.push({ id: n.id, name: n.name, level });
    flatten(n.children, level + 1, acc);
  }
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const actor = {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  };

  const [user, tree] = await Promise.all([
    getAdminUser(appPool(), actor, id),
    getOrgTree(appPool(), actor),
  ]);
  if (!user) notFound();

  const flatOrgs: FlatOrg[] = [];
  flatten(tree, 0, flatOrgs);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/admin/users`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← ユーザー一覧に戻る
      </Link>

      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-1">
        <h1 className="text-xl font-bold text-gray-900">{user.displayName}</h1>
        <p className="text-sm text-gray-600">{user.email}</p>
      </div>

      <AdminUserDetailEditor
        tenantCode={code}
        userId={user.id}
        currentUserId={session.userId}
        initialStatus={user.status}
        initialOrgUnits={user.orgUnits}
        initialRoles={user.roles}
        allOrgUnits={flatOrgs}
      />
    </div>
  );
}
