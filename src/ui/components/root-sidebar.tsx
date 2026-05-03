'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

type Props = {
  displayName: string;
  email: string;
};

const NAV_ITEMS: { href: string; label: string; icon: string }[] = [
  { href: '/root', label: 'ダッシュボード', icon: '📊' },
  { href: '/root/tenants', label: 'テナント', icon: '🏢' },
  { href: '/root/sync', label: '同期実行 / ログ', icon: '🔄' },
];

export function RootSidebar({ displayName, email }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch('/root/api/logout', { method: 'POST' });
    router.push('/root/login');
    router.refresh();
  }

  return (
    <aside className="hidden md:flex md:flex-col md:w-56 bg-slate-900 text-white min-h-screen shrink-0">
      <div className="px-4 py-5 border-b border-slate-700">
        <p className="text-base font-bold">Nudge Platform</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Root 管理者</p>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/root' && pathname.startsWith(`${item.href}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white',
              )}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-slate-700 text-sm space-y-2">
        <p className="text-slate-200 truncate">{displayName}</p>
        <p className="text-[10px] text-slate-500 truncate">{email}</p>
        <button
          type="button"
          onClick={handleLogout}
          className="text-slate-400 hover:text-white transition-colors text-xs"
        >
          ログアウト
        </button>
      </div>
    </aside>
  );
}
