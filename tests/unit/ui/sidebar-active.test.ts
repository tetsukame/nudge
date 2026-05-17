import { describe, it, expect } from 'vitest';
import { isItemActive } from '../../../src/ui/components/sidebar';

// NavItem only needs `href` for isItemActive; cast a minimal shape.
const item = (href: string) => ({ href, label: href, icon: (() => null) as never });

const CODE = 'dev';
const h = (slug: string) => `/t/${CODE}/${slug}`;

describe('sidebar isItemActive', () => {
  it('list pages: exact match lights its own item', () => {
    expect(isItemActive(item('sent'), h('sent'), h('sent'), null)).toBe(true);
    expect(isItemActive(item('requests'), h('sent'), h('requests'), null)).toBe(false);
  });

  it('request detail without ?from → 自分宛の依頼 (requests) active', () => {
    const path = h('requests/abc-123');
    expect(isItemActive(item('requests'), path, h('requests'), null)).toBe(true);
    expect(isItemActive(item('sent'), path, h('sent'), null)).toBe(false);
  });

  it('NDG: request detail opened from sent (?from=sent) → sent active, not requests', () => {
    const path = h('requests/abc-123');
    expect(isItemActive(item('sent'), path, h('sent'), 'sent')).toBe(true);
    expect(isItemActive(item('requests'), path, h('requests'), 'sent')).toBe(false);
    expect(isItemActive(item('groups'), path, h('groups'), 'sent')).toBe(false);
  });

  it('request detail opened from subordinates (?from=subordinates) → subordinates active', () => {
    const path = h('requests/abc-123');
    expect(isItemActive(item('subordinates'), path, h('subordinates'), 'subordinates')).toBe(true);
    expect(isItemActive(item('requests'), path, h('requests'), 'subordinates')).toBe(false);
  });

  it('admin context suppresses non-admin items and is not hijacked by sent context', () => {
    const path = h('admin/sent');
    expect(isItemActive(item('admin'), path, h('admin'), null)).toBe(true);
    expect(isItemActive(item('requests'), path, h('requests'), null)).toBe(false);
    // ?from=admin/sent on a request detail: admin context still suppresses
    // 自分宛/送信 (the new from=sent branch must not fire here).
    const detail = h('requests/x');
    expect(isItemActive(item('sent'), detail, h('sent'), 'admin/sent')).toBe(false);
    expect(isItemActive(item('requests'), detail, h('requests'), 'admin/sent')).toBe(false);
  });

  it('requests/new does not light 自分宛の依頼', () => {
    const path = h('requests/new');
    expect(isItemActive(item('requests'), path, h('requests'), null)).toBe(false);
    expect(isItemActive(item('requests/new'), path, h('requests/new'), null)).toBe(true);
  });
});
