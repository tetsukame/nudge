import { describe, it, expect } from 'vitest';
import { parseSimpleFilter } from '../../../src/domain/scim/users.js';

describe('parseSimpleFilter', () => {
  it('returns null for empty / missing filter', () => {
    expect(parseSimpleFilter(undefined)).toBeNull();
    expect(parseSimpleFilter('')).toBeNull();
  });
  it('parses `userName eq "..."` (case insensitive on operator)', () => {
    expect(parseSimpleFilter('userName eq "a@b.com"')).toEqual({
      field: 'userName',
      value: 'a@b.com',
    });
    expect(parseSimpleFilter('userName EQ "x@y.com"')).toEqual({
      field: 'userName',
      value: 'x@y.com',
    });
  });
  it('parses `externalId eq "..."`', () => {
    expect(parseSimpleFilter('externalId eq "ext-1"')).toEqual({
      field: 'externalId',
      value: 'ext-1',
    });
  });
  it('returns null for unsupported filters (fall back to full list)', () => {
    expect(parseSimpleFilter('displayName eq "X"')).toBeNull();
    expect(parseSimpleFilter('active eq true')).toBeNull();
    expect(parseSimpleFilter('userName co "a"')).toBeNull();
  });
});
