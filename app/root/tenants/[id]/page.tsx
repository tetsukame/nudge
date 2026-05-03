import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRootSession } from '@/auth/root-guard';
import { adminPool } from '@/db/pools';
import { getTenant } from '@/domain/platform/tenants';
import { TenantEditor } from '@/ui/components/tenant-editor';

export const runtime = 'nodejs';

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRootSession();
  const { id } = await params;
  const tenant = await getTenant(adminPool(), id);
  if (!tenant) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <Link href="/root/tenants" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        ← テナント一覧に戻る
      </Link>
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-1">
        <h1 className="text-xl font-bold text-gray-900">
          {tenant.name}
          <span className="ml-2 text-xs font-mono text-gray-500">({tenant.code})</span>
        </h1>
        <p className="text-xs text-gray-500">
          作成: {new Date(tenant.createdAt).toLocaleDateString('ja-JP')} / アクティブユーザー: {tenant.userCount} 名
        </p>
      </div>

      <TenantEditor tenant={tenant} />
    </div>
  );
}
