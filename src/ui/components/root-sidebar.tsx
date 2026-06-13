'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Building2, RefreshCw, Archive, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  displayName: string;
  email: string;
};

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/root', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/root/tenants', label: 'テナント', icon: Building2 },
  { href: '/root/sync', label: '同期実行 / ログ', icon: RefreshCw },
  { href: '/root/retention', label: 'Retention 実行状況', icon: Archive },
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
      <div className="flex items-center gap-2 px-4 h-14 border-b border-slate-800">
        <img
          src="/nudgeflow_icon_64.svg"
          alt=""
          width={28}
          height={28}
          className="shrink-0"
        />
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-bold">NudgeFlow Platform</p>
          <p className="text-[10px] text-slate-400">Root 管理者</p>
        </div>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/root' && pathname.startsWith(`${item.href}/`));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 pl-3 pr-3 py-2 rounded-md text-sm font-medium transition-colors border-l-2 no-underline',
                isActive
                  ? 'bg-white/10 text-white border-emerald-400'
                  : 'text-slate-300 border-transparent hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  isActive ? 'text-emerald-300' : 'text-slate-400',
                )}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-slate-800 text-sm space-y-2">
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
