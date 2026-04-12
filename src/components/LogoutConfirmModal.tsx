'use client';

type Props = {
  tenantCode: string;
  open: boolean;
  onCancel: () => void;
};

export function LogoutConfirmModal({ tenantCode, open, onCancel }: Props) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'white',
          padding: 24,
          borderRadius: 8,
          maxWidth: 480,
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{ marginTop: 0 }}>ログアウトしますか？</h2>
        <p>
          ログアウトすると、Teams や社内ポータルなど SSO 連携中の
          他のアプリからもログアウトされます。続行しますか？
        </p>
        <p style={{ color: '#666', fontSize: '0.9em' }}>
          Nudge だけ非表示にしたい場合は、ブラウザのタブを閉じてください。
          セッションは 14 日間保持されるので、通知から再アクセスすると
          自動で復帰します。
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <form method="POST" action={`/t/${tenantCode}/logout`} style={{ margin: 0 }}>
            <button type="submit" style={{ background: '#c00', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 4 }}>
              ログアウトする
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
