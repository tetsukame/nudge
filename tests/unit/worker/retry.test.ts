import { describe, it, expect } from 'vitest';
import { nextAttemptAt, MAX_ATTEMPT_COUNT } from '../../../src/worker/retry.js';

const now = new Date('2026-01-01T12:00:00Z');

describe('nextAttemptAt', () => {
  it('attempt=1 → 1 minute later (60_000 ms delta)', () => {
    const result = nextAttemptAt(1, now);
    expect(result).not.toBeNull();
    expect(result!.getTime() - now.getTime()).toBe(60_000);
  });

  it('attempt=2 → 5 minutes (300_000 ms)', () => {
    const result = nextAttemptAt(2, now);
    expect(result).not.toBeNull();
    expect(result!.getTime() - now.getTime()).toBe(300_000);
  });

  it('attempt=3 → 30 minutes', () => {
    const result = nextAttemptAt(3, now);
    expect(result).not.toBeNull();
    expect(result!.getTime() - now.getTime()).toBe(30 * 60_000);
  });

  it('attempt=4 → 120 minutes', () => {
    const result = nextAttemptAt(4, now);
    expect(result).not.toBeNull();
    expect(result!.getTime() - now.getTime()).toBe(120 * 60_000);
  });

  it('attempt=5 → null', () => {
    expect(nextAttemptAt(5, now)).toBeNull();
  });

  it('attempt=100 → null', () => {
    expect(nextAttemptAt(100, now)).toBeNull();
  });

  it('attempt=0 → null (out of range)', () => {
    expect(nextAttemptAt(0, now)).toBeNull();
  });

  it('MAX_ATTEMPT_COUNT === 4', () => {
    expect(MAX_ATTEMPT_COUNT).toBe(4);
  });
});
