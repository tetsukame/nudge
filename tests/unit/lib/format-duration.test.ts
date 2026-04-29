import { describe, expect, it } from 'vitest';
import { formatMinutes, DURATION_PRESETS } from '../../../src/lib/format-duration';

describe('formatMinutes', () => {
  it('formats minutes under 60 as "N分"', () => {
    expect(formatMinutes(5)).toBe('5分');
    expect(formatMinutes(30)).toBe('30分');
    expect(formatMinutes(59)).toBe('59分');
  });

  it('formats whole hours as "N時間"', () => {
    expect(formatMinutes(60)).toBe('1時間');
    expect(formatMinutes(120)).toBe('2時間');
    expect(formatMinutes(480)).toBe('8時間');
  });

  it('formats hours+minutes as "N時間M分"', () => {
    expect(formatMinutes(90)).toBe('1時間30分');
    expect(formatMinutes(125)).toBe('2時間5分');
    expect(formatMinutes(245)).toBe('4時間5分');
  });

  it('handles zero and invalid input as "0分"', () => {
    expect(formatMinutes(0)).toBe('0分');
    expect(formatMinutes(-5)).toBe('0分');
    expect(formatMinutes(NaN)).toBe('0分');
  });

  it('truncates fractional minutes', () => {
    expect(formatMinutes(5.7)).toBe('5分');
    expect(formatMinutes(60.9)).toBe('1時間');
  });
});

describe('DURATION_PRESETS', () => {
  it('contains expected preset values', () => {
    expect(DURATION_PRESETS).toEqual([5, 15, 30, 60, 90, 120, 240, 480]);
  });
});
