import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initOtel,
  isOtelInitialized,
  recordApiDuration,
} from '../../../src/lib/otel.js';

describe('otel bootstrap', () => {
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  beforeEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  afterEach(() => {
    if (originalEndpoint === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    }
  });

  it('initOtel returns false when endpoint is not set (no-op)', async () => {
    const started = await initOtel();
    expect(started).toBe(false);
    expect(isOtelInitialized()).toBe(false);
  });

  it('recordApiDuration is safe to call before init (no throw)', () => {
    expect(() =>
      recordApiDuration({
        route: '/api/x',
        method: 'GET',
        status: 200,
        durationMs: 123,
      }),
    ).not.toThrow();
  });
});
