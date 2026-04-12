import { describe, expect, it } from 'vitest';
import { parseSyncCsv } from '../../../src/sync/csv-parser.js';

describe('parseSyncCsv', () => {
  it('parses valid UTF-8 CSV', () => {
    const csv = [
      'employee_id,email,display_name,org_path,is_primary',
      'emp-001,tanaka@city.lg.jp,田中太郎,/総務本部/総務部/総務課,true',
      'emp-002,suzuki@city.lg.jp,鈴木花子,/総務本部/総務部/人事課,true',
    ].join('\n');
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].employee_id).toBe('emp-001');
    expect(result.rows[0].org_path).toBe('/総務本部/総務部/総務課');
    expect(result.rows[0].is_primary).toBe(true);
  });

  it('parses UTF-8 BOM', () => {
    const bom = '\uFEFF';
    const csv = bom + 'employee_id,email,display_name,org_path\nemp-001,a@x,A,/Org';
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].employee_id).toBe('emp-001');
  });

  it('defaults is_primary to true when missing', () => {
    const csv = 'employee_id,email,display_name,org_path\nemp-001,a@x,A,/Org';
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].is_primary).toBe(true);
  });

  it('defaults status to active when missing', () => {
    const csv = 'employee_id,email,display_name,org_path\nemp-001,a@x,A,/Org';
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe('active');
  });

  it('handles multiple rows for same employee (兼務)', () => {
    const csv = [
      'employee_id,email,display_name,org_path,is_primary',
      'emp-001,a@x,A,/部A,true',
      'emp-001,a@x,A,/部B,false',
    ].join('\n');
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
  });

  it('returns errors for missing required fields', () => {
    const csv = [
      'employee_id,email,display_name,org_path',
      'emp-001,,A,/Org',
      ',b@x,B,/Org',
    ].join('\n');
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors[0].line).toBe(2);
  });

  it('returns error for org_path not starting with /', () => {
    const csv = 'employee_id,email,display_name,org_path\nemp-001,a@x,A,NoSlash';
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(false);
  });

  it('limits errors to 10', () => {
    const header = 'employee_id,email,display_name,org_path';
    const badRows = Array.from({ length: 20 }, (_, i) => `,bad-${i}@x,B,/Org`);
    const csv = [header, ...badRows].join('\n');
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(10);
  });
});
