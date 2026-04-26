export const MAX_ATTEMPT_COUNT = 4;
const BACKOFF_MINUTES = [1, 5, 30, 120];

export function nextAttemptAt(attemptCount: number, now: Date = new Date()): Date | null {
  if (attemptCount > MAX_ATTEMPT_COUNT) return null;
  if (attemptCount < 1) return null;
  const minutes = BACKOFF_MINUTES[attemptCount - 1];
  return new Date(now.getTime() + minutes * 60_000);
}
