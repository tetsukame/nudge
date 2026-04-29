export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0分';
  const m = Math.floor(minutes);
  if (m < 60) return `${m}分`;
  const hours = Math.floor(m / 60);
  const remaining = m % 60;
  if (remaining === 0) return `${hours}時間`;
  return `${hours}時間${remaining}分`;
}

export const DURATION_PRESETS = [5, 15, 30, 60, 90, 120, 240, 480] as const;
