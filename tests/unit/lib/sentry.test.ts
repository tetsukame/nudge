import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initSentry,
  isSentryInitialized,
  captureException,
} from '../../../src/lib/sentry.js';

describe('sentry init', () => {
  const originalDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    delete process.env.SENTRY_DSN;
  });
  afterEach(() => {
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  it('returns false when SENTRY_DSN is unset (no-op)', async () => {
    const started = await initSentry();
    expect(started).toBe(false);
    expect(isSentryInitialized()).toBe(false);
  });

  it('captureException is a safe no-op before init', async () => {
    await expect(
      captureException(new Error('nothing')),
    ).resolves.toBeUndefined();
  });
});
