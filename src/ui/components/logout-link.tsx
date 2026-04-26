'use client';

type Props = {
  tenantCode: string;
  className?: string;
  children?: React.ReactNode;
};

export function LogoutLink({ tenantCode, className, children }: Props) {
  return (
    <form method="POST" action={`/t/${tenantCode}/logout`} style={{ margin: 0 }}>
      <button type="submit" className={className}>
        {children ?? 'ログアウト'}
      </button>
    </form>
  );
}
