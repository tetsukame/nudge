// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { STATUS_CONFIG, getStatusConfig } from '../../../src/ui/status-config.js';

describe('status-config', () => {
  it('has config for all 7 displayable statuses', () => {
    const keys = Object.keys(STATUS_CONFIG);
    expect(keys).toContain('unopened');
    expect(keys).toContain('opened');
    expect(keys).toContain('responded');
    expect(keys).toContain('not_needed');
    expect(keys).toContain('forwarded');
    expect(keys).toContain('substituted');
    expect(keys).toContain('exempted');
  });

  it('each config has label, icon, color, bgColor', () => {
    for (const cfg of Object.values(STATUS_CONFIG)) {
      expect(cfg).toHaveProperty('label');
      expect(cfg).toHaveProperty('icon');
      expect(cfg).toHaveProperty('color');
      expect(cfg).toHaveProperty('bgColor');
    }
  });

  it('getStatusConfig returns fallback for unknown status', () => {
    const cfg = getStatusConfig('unknown' as never);
    expect(cfg.label).toBe('不明');
  });
});
