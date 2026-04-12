import { describe, expect, it } from 'vitest';
import { decideRoute } from '../../../src/auth/middleware-guard.js';

describe('decideRoute', () => {
  const session = {
    userId: 'u1',
    tenantId: 't1',
    tenantCode: 'acme',
    sub: 's',
    email: 'a@x',
    displayName: 'A',
    refreshToken: 'r',
    accessTokenExp: 9999999999,
  };

  it('passes through root', () => {
    const r = decideRoute('/', null, null);
    expect(r.kind).toBe('passthrough');
  });

  it('passes through health', () => {
    const r = decideRoute('/api/health', null, null);
    expect(r.kind).toBe('passthrough');
  });

  it('404s on non-tenant path', () => {
    const r = decideRoute('/random', null, null);
    expect(r.kind).toBe('not_found');
  });

  it('404s on unknown tenant code', () => {
    const r = decideRoute('/t/unknown/dashboard', null, null);
    expect(r.kind).toBe('not_found');
  });

  it('passes through /t/acme/login even without session', () => {
    const r = decideRoute('/t/acme/login', { id: 't1', code: 'acme' }, null);
    expect(r.kind).toBe('passthrough');
  });

  it('passes through /t/acme/auth/callback without session', () => {
    const r = decideRoute('/t/acme/auth/callback', { id: 't1', code: 'acme' }, null);
    expect(r.kind).toBe('passthrough');
  });

  it('passes through /t/acme/logged-out without session', () => {
    const r = decideRoute('/t/acme/logged-out', { id: 't1', code: 'acme' }, null);
    expect(r.kind).toBe('passthrough');
  });

  it('redirects to /t/acme/login when dashboard hit without session', () => {
    const r = decideRoute('/t/acme/dashboard', { id: 't1', code: 'acme' }, null);
    expect(r.kind).toBe('redirect');
    if (r.kind === 'redirect') {
      expect(r.to).toBe('/t/acme/login?returnTo=%2Ft%2Facme%2Fdashboard');
    }
  });

  it('passes through dashboard with matching session', () => {
    const r = decideRoute(
      '/t/acme/dashboard',
      { id: 't1', code: 'acme' },
      session,
    );
    expect(r.kind).toBe('passthrough');
  });

  it('redirects when session tenantId mismatches requested tenant', () => {
    const r = decideRoute(
      '/t/acme/dashboard',
      { id: 't-other', code: 'acme' },
      session,
    );
    expect(r.kind).toBe('redirect');
  });
});
