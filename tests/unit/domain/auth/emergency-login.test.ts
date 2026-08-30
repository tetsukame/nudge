import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isEmergencyLoginEnabled,
  emergencyLoginToTenant,
} from '../../../../src/domain/auth/emergency-login.js';

describe('isEmergencyLoginEnabled', () => {
  const original = process.env.EMERGENCY_LOCAL_LOGIN;
  beforeEach(() => { delete process.env.EMERGENCY_LOCAL_LOGIN; });
  afterEach(() => {
    if (original === undefined) delete process.env.EMERGENCY_LOCAL_LOGIN;
    else process.env.EMERGENCY_LOCAL_LOGIN = original;
  });

  it('returns false when unset', () => {
    expect(isEmergencyLoginEnabled()).toBe(false);
  });
  it('returns false for values other than "true"', () => {
    process.env.EMERGENCY_LOCAL_LOGIN = '1';
    expect(isEmergencyLoginEnabled()).toBe(false);
    process.env.EMERGENCY_LOCAL_LOGIN = 'yes';
    expect(isEmergencyLoginEnabled()).toBe(false);
    process.env.EMERGENCY_LOCAL_LOGIN = 'True';
    expect(isEmergencyLoginEnabled()).toBe(false);
  });
  it('returns true only for exact "true"', () => {
    process.env.EMERGENCY_LOCAL_LOGIN = 'true';
    expect(isEmergencyLoginEnabled()).toBe(true);
  });
});

describe('emergencyLoginToTenant', () => {
  const original = process.env.EMERGENCY_LOCAL_LOGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.EMERGENCY_LOCAL_LOGIN;
    else process.env.EMERGENCY_LOCAL_LOGIN = original;
  });

  it('returns { ok: false, error: "disabled" } when env is not set', async () => {
    delete process.env.EMERGENCY_LOCAL_LOGIN;
    const r = await emergencyLoginToTenant({
      tenantCode: 'any',
      email: 'x@y.com',
      password: 'x',
    });
    expect(r).toEqual({ ok: false, error: 'disabled' });
  });
});
