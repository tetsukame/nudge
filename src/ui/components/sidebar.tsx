'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

type Props = {
  tenantCode: string;
  displayName: string;
};

export function Sidebar({ tenantCode, displayName }: Props) {
  const pathname = usePathname();

  const requestsHref = `/t/${tenantCode}/requests`;
  const newHref = `/t/${tenantCode}/requests/new`;

  const isRequests =
    pathname === requestsHref || pathname.startsWith(`/t/${tenantCode}/requests/`);
  const isNew = pathname === newHref;

  return (
    <aside className="hidden md:flex md:flex-col md:w-52 bg-slate-900 text-white min-h-screen shrink-0">
      <div className="px-4 py-5 text-lg font-bold border-b border-slate-700">
        Nudge
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        <Link
          href={newHref}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
            isNew && !isRequests
              ? 'bg-slate-700 text-white'
              : 'text-slate-300 hover:bg-slate-700 hover:text-white',
          )}
        >
          <span>➕</span>
          <span>新規依頼作成</span>
        </Link>

        <Link
          href={requestsHref}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
            isRequests && !isNew
              ? 'bg-slate-700 text-white'
              : 'text-slate-300 hover:bg-slate-700 hover:text-white',
          )}
        >
          <span>📥</span>
          <span>自分宛の依頼</span>
        </Link>
      </nav>

      <div className="px-4 py-4 border-t border-slate-700 text-sm space-y-2">
        <p className="text-slate-300 truncate">{displayName}</p>
        <Link
          href={`/t/${tenantCode}/logout`}
          className="text-slate-400 hover:text-white transition-colors"
        >
          ログアウト
        </Link>
      </div>
    </aside>
  );
}
