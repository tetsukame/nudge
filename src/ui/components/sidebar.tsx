'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LogoutLink } from './logout-link';

type Props = {
  tenantCode: string;
  displayName: string;
  isManager: boolean;
  isTenantAdmin: boolean;
};

const BASE_NAV_ITEMS = [
  { href: 'requests', label: '自分宛の依頼', icon: '📥' },
  { href: 'requests/new', label: '新規依頼作成', icon: '➕' },
  { href: 'sent', label: '送信した依頼', icon: '📤' },
];

export function Sidebar({ tenantCode, displayName, isManager, isTenantAdmin }: Props) {
  const pathname = usePathname();

  const navItems = [
    ...BASE_NAV_ITEMS,
    ...(isManager ? [{ href: 'subordinates', label: '部下の依頼', icon: '👥' }] : []),
    ...(isTenantAdmin ? [{ href: 'settings/notification', label: '通知設定', icon: '⚙️' }] : []),
  ];

  return (
    <aside className="hidden md:flex md:flex-col md:w-52 bg-slate-900 text-white min-h-screen shrink-0">
      <div className="px-4 py-5 text-lg font-bold border-b border-slate-700">
        Nudge
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => {
          const href = `/t/${tenantCode}/${item.href}`;
          const isActive =
            pathname === href ||
            (item.href !== 'requests/new' &&
              item.href !== 'sent' &&
              item.href !== 'subordinates' &&
              pathname.startsWith(`${href}/`));
          return (
            <Link
              key={item.href}
              href={href}
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
        <p className="text-slate-300 truncate">{displayName}</p>
        <LogoutLink
          tenantCode={tenantCode}
          className="text-slate-400 hover:text-white transition-colors bg-transparent border-none p-0 cursor-pointer text-sm"
        />
      </div>
    </aside>
  );
}
