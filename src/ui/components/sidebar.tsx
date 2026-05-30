'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  Inbox,
  PlusCircle,
  Send,
  Users,
  UserCheck,
  Settings,
  ScrollText,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LogoutLink } from './logout-link';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

type Props = {
  tenantCode: string;
  displayName: string;
  isManager: boolean;
  isTenantAdmin: boolean;
  /** NDG-67: 監査ログ閲覧専用ロール。tenant_admin がいないときだけサイドバーに表示。 */
  isAuditor?: boolean;
  failedNotifications?: number;
};

const BASE_NAV_ITEMS: NavItem[] = [
  { href: 'requests', label: '自分宛の依頼', icon: Inbox },
  { href: 'requests/new', label: '新規依頼作成', icon: PlusCircle },
  { href: 'sent', label: '送信した依頼', icon: Send },
  { href: 'groups', label: 'グループ', icon: Users },
];

/**
 * Determine which nav item should be active.
 * - In admin context (URL contains /admin/ OR ?from=admin/...), the "管理" item is active.
 * - Otherwise the first item whose href matches the pathname prefix.
 */
export function isItemActive(
  item: NavItem,
  pathname: string,
  href: string,
  fromParam: string | null,
): boolean {
  const inAdminContext =
    pathname.startsWith(`/t/`) && pathname.includes('/admin')
    || (fromParam?.startsWith('admin') ?? false);

  if (inAdminContext) {
    // In admin context, only the "admin" / "admin/failed-notifications" items can be active
    if (!item.href.startsWith('admin')) return false;
    // NDG-77: admin が /audit を ?from=admin で開いたとき、
    // pathname に /admin が含まれないので prefix match では「管理」が light up しない。
    // ここで明示的に「管理」を active に維持する。
    if (item.href === 'admin' && !pathname.includes('/admin')) return true;
  } else if (fromParam === 'sent' || fromParam === 'subordinates') {
    // Opened a request detail from the 送信した依頼 / 部下の依頼 list
    // (?from=sent|subordinates). Keep that list item active instead of
    // letting the /requests/<id> path light up 自分宛の依頼.
    return item.href === fromParam;
  }

  if (pathname === href) return true;

  // These items use exact-match only (no prefix match into descendants).
  if (item.href === 'requests/new' || item.href === 'sent' || item.href === 'subordinates') {
    return false;
  }

  // Parent items must not claim paths that belong to a more specific child item.
  if (item.href === 'requests' && pathname.startsWith(`${href}/new`)) return false;
  if (item.href === 'admin' && pathname.startsWith(`${href}/failed-notifications`)) return false;

  return pathname.startsWith(`${href}/`);
}

function NavList({
  navItems, tenantCode,
}: {
  navItems: NavItem[];
  tenantCode: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const fromParam = params.get('from');

  return (
    <>
      {navItems.map((item) => {
        const href = `/t/${tenantCode}/${item.href}`;
        const isActive = isItemActive(item, pathname, href, fromParam);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={href}
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
            <span className="flex-1">{item.label}</span>
            {item.badge != null && item.badge > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}

export function Sidebar({
  tenantCode, displayName, isManager, isTenantAdmin, isAuditor = false,
  failedNotifications = 0,
}: Props) {
  const navItems: NavItem[] = [
    ...BASE_NAV_ITEMS,
    ...(isManager ? [{ href: 'subordinates', label: '部下の依頼', icon: UserCheck }] : []),
    ...(isTenantAdmin
      ? [
          { href: 'admin', label: '管理', icon: Settings },
          ...(failedNotifications > 0
            ? [{ href: 'admin/failed-notifications', label: '失敗通知', icon: TriangleAlert, badge: failedNotifications }]
            : []),
        ]
      : isAuditor
        // NDG-67 / NDG-77: auditor が tenant_admin 兼任でないときは「監査ログ」を直接表示。
        // パスは /admin/* の外（admin layout の tenant_admin gate を回避）
        ? [{ href: 'audit', label: '監査ログ', icon: ScrollText }]
        : []),
  ];

  return (
    <aside className="hidden md:flex md:flex-col md:w-52 bg-slate-900 text-white min-h-screen shrink-0">
      <Link
        href={`/t/${tenantCode}`}
        className="flex items-center gap-2 px-4 h-14 border-b border-slate-800 no-underline text-white hover:bg-white/5 transition-colors"
        title="ダッシュボード"
      >
        <img
          src="/nudgeflow_icon_64.svg"
          alt=""
          width={28}
          height={28}
          className="shrink-0"
        />
        <span className="text-lg font-bold">NudgeFlow</span>
      </Link>

      <nav className="flex-1 px-2 py-4 space-y-1">
        <Suspense fallback={null}>
          <NavList navItems={navItems} tenantCode={tenantCode} />
        </Suspense>
      </nav>

      <div className="px-4 py-4 border-t border-slate-800 text-sm space-y-2">
        <p className="text-slate-300 truncate">{displayName}</p>
        <LogoutLink
          tenantCode={tenantCode}
          className="text-slate-400 hover:text-white transition-colors bg-transparent border-none p-0 cursor-pointer text-sm"
        />
      </div>
    </aside>
  );
}
