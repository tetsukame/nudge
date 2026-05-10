import { Badge } from '@/components/ui/badge';
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
      <Badge variant={cfg.variant}>{cfg.label}</Badge>
      {overdue && (
        <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
          期限超過
        </Badge>
      )}
    </span>
  );
}
