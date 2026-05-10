import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NudgeFlow',
  description: '組織内の依頼事項を可視化するタスク管理ツール',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
