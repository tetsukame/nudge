import { cookies } from 'next/headers';
import { unsealRootSession, ROOT_SESSION_COOKIE } from '@/auth/root-session';
import { loadConfig } from '@/config';
import { RootSidebar } from '@/ui/components/root-sidebar';

export const runtime = 'nodejs';

export default async function RootSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // /root/login は session 不要。ログイン済みなら sidebar を出す。
  // 子ページは個別に session check + redirect する (server component の責務)。
  const sealed = (await cookies()).get(ROOT_SESSION_COOKIE)?.value;
  const cfg = loadConfig();
  const session = await unsealRootSession(sealed, cfg.IRON_SESSION_PASSWORD);

  if (!session) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      <RootSidebar displayName={session.displayName} email={session.email} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
