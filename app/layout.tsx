import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Nudge',
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
