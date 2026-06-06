import { describe, it, expect } from 'vitest';
import { WhereBuilder } from '../../../src/db/where-builder.js';

describe('WhereBuilder', () => {
  it('empty builder produces empty whereClause', () => {
    const wb = new WhereBuilder();
    expect(wb.whereClause()).toBe('');
    expect(wb.andClause()).toBe('');
    expect(wb.values()).toEqual([]);
  });

  it('add() rewrites ? to $N starting at 1', () => {
    const wb = new WhereBuilder();
    wb.add('a = ?', 'A');
    wb.add('b = ?', 'B');
    expect(wb.whereClause()).toBe('WHERE a = $1 AND b = $2');
    expect(wb.values()).toEqual(['A', 'B']);
  });

  it('add() supports multiple ? in one condition', () => {
    const wb = new WhereBuilder();
    wb.add('a BETWEEN ? AND ?', 1, 10);
    expect(wb.whereClause()).toBe('WHERE a BETWEEN $1 AND $2');
    expect(wb.values()).toEqual([1, 10]);
  });

  it('add() throws when placeholder/value count mismatches', () => {
    const wb = new WhereBuilder();
    expect(() => wb.add('a = ?', 1, 2)).toThrow(/placeholder count mismatch/);
    expect(() => wb.add('a = ? AND b = ?', 1)).toThrow(/placeholder count mismatch/);
  });

  it('addRaw() inserts literal conditions without consuming a parameter slot', () => {
    const wb = new WhereBuilder();
    wb.add('a = ?', 'A');
    wb.addRaw(`b IS NOT NULL`);
    wb.add('c = ?', 'C');
    expect(wb.whereClause()).toBe(`WHERE a = $1 AND b IS NOT NULL AND c = $2`);
    expect(wb.values()).toEqual(['A', 'C']);
  });

  it('pushValue() returns the assigned $N for inline use', () => {
    const wb = new WhereBuilder();
    wb.add('a = ?', 'A');
    const limitP = wb.pushValue(20);
    const offsetP = wb.pushValue(40);
    expect(limitP).toBe('$2');
    expect(offsetP).toBe('$3');
    expect(wb.values()).toEqual(['A', 20, 40]);
  });

  it('andClause() omits the leading WHERE for CTE-friendly composition', () => {
    const wb = new WhereBuilder();
    wb.add('a = ?', 'A');
    wb.addRaw('b > 0');
    expect(wb.andClause()).toBe('a = $1 AND b > 0');
  });

  it('size() reflects parameter count for debugging', () => {
    const wb = new WhereBuilder();
    expect(wb.size()).toBe(0);
    wb.add('a = ?', 1);
    wb.addRaw('b IS NULL');
    wb.add('c = ?', 2);
    expect(wb.size()).toBe(2);
  });
});
