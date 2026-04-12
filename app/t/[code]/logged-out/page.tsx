export default async function LoggedOutPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>ログアウトしました</h1>
      <p>
        Nudge と Keycloak 連携中のアプリからログアウトされました。
      </p>
      <p>
        <a href={`/t/${code}/`}>再度ログインする</a>
      </p>
    </main>
  );
}
