import { cn } from '@/lib/utils';

type Props = {
  counts: {
    unopened: number;
    opened: number;
    responded: number;
    unavailable: number;
    other: number;
  };
  total: number;
  className?: string;
};

export function ProgressBar({ counts, total, className }: Props) {
  if (total === 0) {
    return <div className={cn('h-2 bg-gray-200 rounded-full', className)} />;
  }
  const segments = [
    { color: 'bg-green-500', width: (counts.responded / total) * 100, label: '対応済み' },
    { color: 'bg-red-400', width: (counts.unavailable / total) * 100, label: '対応不可' },
    { color: 'bg-purple-400', width: (counts.other / total) * 100, label: 'その他完了' },
    { color: 'bg-gray-400', width: (counts.opened / total) * 100, label: '開封済み' },
    { color: 'bg-blue-300', width: (counts.unopened / total) * 100, label: '未開封' },
  ];
  return (
    <div
      className={cn('flex h-2 rounded-full overflow-hidden bg-gray-100', className)}
      role="progressbar"
      aria-valuenow={counts.responded + counts.unavailable + counts.other}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      {segments.map((seg, i) =>
        seg.width > 0 ? (
          <div
            key={i}
            className={seg.color}
            style={{ width: `${seg.width}%` }}
            title={`${seg.label}: ${Math.round(seg.width)}%`}
          />
        ) : null,
      )}
    </div>
  );
}
