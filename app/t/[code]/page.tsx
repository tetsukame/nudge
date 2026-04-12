export default async function TenantDashboard({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <div>
      <h1>ダッシュボード</h1>
      <p>
        テナント <strong>{code}</strong> にログインしました。v0.2 では認証基盤のみ実装されています。
      </p>
      <p>依頼機能は v0.4 以降で追加されます。</p>
    </div>
  );
}
