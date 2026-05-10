export type StatusVariant = 'success' | 'warning' | 'info' | 'muted' | 'destructive';

export type StatusDisplay = {
  label: string;
  variant: StatusVariant;
};

export const STATUS_CONFIG: Record<string, StatusDisplay> = {
  unopened:    { label: '未開封',   variant: 'info' },
  opened:      { label: '開封済み', variant: 'muted' },
  responded:   { label: '対応済み', variant: 'success' },
  not_needed:  { label: '対応不要', variant: 'destructive' },
  forwarded:   { label: '転送済み', variant: 'info' },
  substituted: { label: '代理完了', variant: 'warning' },
  exempted:    { label: '免除',     variant: 'muted' },
};

const FALLBACK: StatusDisplay = { label: '不明', variant: 'muted' };

export function getStatusConfig(status: string): StatusDisplay {
  return STATUS_CONFIG[status] ?? FALLBACK;
}
