import type { AssignmentStatus } from '../domain/types';

export type StatusDisplay = {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
};

export const STATUS_CONFIG: Record<string, StatusDisplay> = {
  unopened:    { label: '未開封',   icon: '📩', color: 'text-blue-600',   bgColor: 'bg-blue-50' },
  opened:     { label: '開封済み', icon: '📭', color: 'text-gray-600',   bgColor: 'bg-gray-50' },
  responded:  { label: '対応済み', icon: '✅', color: 'text-green-600',  bgColor: 'bg-green-50' },
  unavailable:{ label: '対応不可', icon: '❌', color: 'text-red-600',    bgColor: 'bg-red-50' },
  forwarded:  { label: '転送済み', icon: '↗️', color: 'text-purple-600', bgColor: 'bg-purple-50' },
  substituted:{ label: '代理完了', icon: '👤', color: 'text-orange-600', bgColor: 'bg-orange-50' },
  exempted:   { label: '免除',    icon: '⏭️', color: 'text-gray-500',   bgColor: 'bg-gray-50' },
};

const FALLBACK: StatusDisplay = {
  label: '不明', icon: '❓', color: 'text-gray-400', bgColor: 'bg-gray-50',
};

export function getStatusConfig(status: string): StatusDisplay {
  return STATUS_CONFIG[status] ?? FALLBACK;
}
