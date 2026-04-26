import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { LogoutLink } from '@/ui/components/logout-link';

export const runtime = 'nodejs';

export default async function MyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  return (
    <div className="max-w-md mx-auto px-4 py-8 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">マイページ</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <div>
          <p className="text-xs text-gray-500">表示名</p>
          <p className="text-sm font-medium text-gray-900">{session.displayName}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">テナントコード</p>
          <p className="text-sm font-medium text-gray-900">{code}</p>
        </div>
      </div>

      <div className="space-y-2">
        <Link
          href={`/t/${code}/requests`}
          className="block w-full text-center px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          ← 受信一覧に戻る
        </Link>
        <LogoutLink
          tenantCode={code}
          className="block w-full text-center px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 transition-colors cursor-pointer border-none"
        />
      </div>
    </div>
  );
}
