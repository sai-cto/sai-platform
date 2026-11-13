/** The one formatter each for money, days, moments, times and phone numbers (src/ui/format.ts). */
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatDay, formatMoney, formatMonth, formatPhone, formatTime, formatValue, formatWeekday } from '@/ui/format';

describe('formatting', () => {
  it('money: $1,234.56, negatives, nothing', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(-500)).toBe('-$5.00');
    expect(formatMoney(null)).toBe('$0.00');
  });

  it('a calendar day never shifts a day back, whatever the time zone', () => {
    expect(formatDay('2026-11-13')).toBe('Nov 13, 2026');
    expect(formatDate('2026-11-13')).toBe('Nov 13, 2026');
    expect(formatValue('2026-01-01', 'date')).toBe('Jan 1, 2026');
    expect(formatDay(null)).toBe('—');
    expect(formatWeekday('2026-11-13')).toBe('Fri, Nov 13');
    expect(formatMonth('2026-11')).toBe('November 2026');
    expect(formatMonth('2026-11-13', 'short')).toBe('Nov 2026');
  });

  it('moments and times are shown in Ithaca time', () => {
    const at = new Date('2026-11-13T14:05:00Z'); // 9:05 AM in Ithaca (EST)
    expect(formatTime(at)).toBe('9:05 AM');
    expect(formatDateTime(at)).toBe('Nov 13, 2026, 9:05 AM');
    expect(formatDate(new Date('2026-11-14T03:00:00Z'))).toBe('Nov 13, 2026'); // 10 PM the 13th in Ithaca
    expect(formatTime('not a date')).toBe('—');
  });

  it('US phone numbers in one shape; anything else as typed', () => {
    expect(formatPhone('6075550101')).toBe('(607) 555-0101');
    expect(formatPhone('+1 607-555-0101')).toBe('(607) 555-0101');
    expect(formatPhone('607.555.0101')).toBe('(607) 555-0101');
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(formatPhone('')).toBe('—');
  });
});
