'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

type Props = {
  tenantCode: string;
};

export function BottomTabs({ tenantCode }: Props) {
  const pathname = usePathname();

  const requestsHref = `/t/${tenantCode}/requests`;
  const logoutHref = `/t/${tenantCode}/logout`;

  const isRequests = pathname.startsWith(`/t/${tenantCode}/requests`);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
      <div className="flex">
        <Link
          href={requestsHref}
          className={cn(
            'flex-1 flex flex-col items-center justify-center py-2 text-xs gap-1 transition-colors',
            isRequests
              ? 'text-blue-600 font-medium'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          <span className="text-lg leading-none">📥</span>
          <span>受信</span>
        </Link>

        <Link
          href={logoutHref}
          className="flex-1 flex flex-col items-center justify-center py-2 text-xs gap-1 text-gray-500 hover:text-gray-700 transition-colors"
        >
          <span className="text-lg leading-none">👤</span>
          <span>マイページ</span>
        </Link>
      </div>
    </nav>
  );
}
