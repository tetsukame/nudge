import { cookies } from 'next/headers';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { UserMenu } from '@/components/UserMenu';

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 24px',
          borderBottom: '1px solid #eee',
        }}
      >
        <div style={{ fontWeight: 'bold' }}>Nudge — {code}</div>
        {session && (
          <UserMenu tenantCode={code} displayName={session.displayName} />
        )}
      </header>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
