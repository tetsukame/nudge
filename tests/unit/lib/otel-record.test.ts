import { describe, it, expect } from 'vitest';
import {
  recordApiDuration,
  recordNotificationSend,
  recordSyncDuration,
  recordRetentionDeleted,
} from '../../../src/lib/otel.js';

/**
 * OTel が未初期化のとき (OTEL_EXPORTER_OTLP_ENDPOINT なし = OSS default) は
 * すべての record 関数が no-op で throw しないことを担保する。
 * これが崩れると env 未設定の全ユーザーで例外連鎖する可能性があるため。
 */
describe('otel record helpers (no-op when SDK is not initialized)', () => {
  it('recordApiDuration is safe', () => {
    expect(() =>
      recordApiDuration({
        route: '/api/x',
        method: 'GET',
        status: 200,
        durationMs: 12,
      }),
    ).not.toThrow();
  });
  it('recordNotificationSend is safe (success + fail)', () => {
    expect(() =>
      recordNotificationSend({ channel: 'email', result: 'success' }),
    ).not.toThrow();
    expect(() =>
      recordNotificationSend({
        channel: 'teams',
        result: 'fail',
        tenantId: 't-1',
      }),
    ).not.toThrow();
  });
  it('recordSyncDuration is safe', () => {
    expect(() =>
      recordSyncDuration({
        source: 'keycloak',
        result: 'success',
        tenantId: 't-1',
        durationSeconds: 3.14,
      }),
    ).not.toThrow();
  });
  it('recordRetentionDeleted is safe and skips count<=0', () => {
    expect(() =>
      recordRetentionDeleted({
        kind: 'soft',
        entity: 'notification',
        tenantId: 't-1',
        count: 0,
      }),
    ).not.toThrow();
    expect(() =>
      recordRetentionDeleted({
        kind: 'hard',
        entity: 'audit_log',
        tenantId: 't-1',
        count: 42,
      }),
    ).not.toThrow();
  });
});
