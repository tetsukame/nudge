'use client';

import { useState } from 'react';
import { LogoutConfirmModal } from './LogoutConfirmModal';

type Props = {
  tenantCode: string;
  displayName: string;
};

export function UserMenu({ tenantCode, displayName }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="ユーザーメニュー"
        onClick={() => setMenuOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 8,
          fontSize: 20,
        }}
      >
        ☰
      </button>
      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 4,
            minWidth: 200,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 100,
          }}
        >
          <div style={{ padding: 12, borderBottom: '1px solid #eee' }}>
            {displayName}
          </div>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setModalOpen(true);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: 12,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ログアウト
          </button>
        </div>
      )}
      <LogoutConfirmModal
        tenantCode={tenantCode}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
      />
    </div>
  );
}
