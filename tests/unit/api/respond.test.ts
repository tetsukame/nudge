import { describe, it, expect } from 'vitest';
import { mapDomainError } from '../../../app/t/[code]/api/_lib/respond.js';

class MyError extends Error {
  constructor(msg: string, readonly code: string) {
    super(msg);
    this.name = 'MyError';
  }
}

describe('mapDomainError', () => {
  it('maps permission_denied to 403', async () => {
    const res = mapDomainError(new MyError('nope', 'permission_denied'));
    expect(res?.status).toBe(403);
    const body = await res!.json();
    expect(body).toEqual({ error: 'nope', code: 'permission_denied' });
  });

  it('maps not_found to 404', () => {
    const res = mapDomainError(new MyError('?', 'not_found'));
    expect(res?.status).toBe(404);
  });

  it('maps validation to 400', () => {
    const res = mapDomainError(new MyError('?', 'validation'));
    expect(res?.status).toBe(400);
  });

  it('maps conflict / invalid_state / already_running / last_admin to 409', () => {
    for (const code of ['conflict', 'invalid_state', 'already_running', 'last_admin']) {
      const res = mapDomainError(new MyError('?', code));
      expect(res?.status, code).toBe(409);
    }
  });

  it('maps kc_readonly to 403', () => {
    const res = mapDomainError(new MyError('?', 'kc_readonly'));
    expect(res?.status).toBe(403);
  });

  it('maps rate_limited to 429, timeout to 504', () => {
    expect(mapDomainError(new MyError('?', 'rate_limited'))?.status).toBe(429);
    expect(mapDomainError(new MyError('?', 'timeout'))?.status).toBe(504);
  });

  it('maps auth / invalid_response to 502', () => {
    expect(mapDomainError(new MyError('?', 'auth'))?.status).toBe(502);
    expect(mapDomainError(new MyError('?', 'invalid_response'))?.status).toBe(502);
  });

  it('falls back to 400 for unknown code', () => {
    const res = mapDomainError(new MyError('?', 'totally_new_code'));
    expect(res?.status).toBe(400);
  });

  it('returns null for non-Error throw', () => {
    expect(mapDomainError('not an error')).toBeNull();
    expect(mapDomainError({ code: 'permission_denied' })).toBeNull();
  });

  it('returns null for Error without code property', () => {
    expect(mapDomainError(new Error('plain'))).toBeNull();
  });
});
