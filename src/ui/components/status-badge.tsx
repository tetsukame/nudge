import { cn } from '@/lib/utils';
import { getStatusConfig } from '@/ui/status-config';

type Props = {
  status: string;
  overdue?: boolean;
  className?: string;
};

export function StatusBadge({ status, overdue = false, className }: Props) {
  const cfg = getStatusConfig(status);
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
          cfg.color,
          cfg.bgColor,
        )}
      >
        <span>{cfg.icon}</span>
        <span>{cfg.label}</span>
      </span>
      {overdue && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
          期限超過
        </span>
      )}
    </span>
  );
}
