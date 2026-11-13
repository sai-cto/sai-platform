/**
 * Display formatting shared by every screen: ONE helper each for money ($1,234.56), calendar days
 * (Nov 13, 2026), moments (Nov 13, 2026, 9:05 AM), times of day (9:05 AM) and phone numbers
 * ((607) 555-0101). Times are shown in Ithaca time (America/New_York) unless a business says
 * otherwise. Formatters are built once and reused (building one is slow).
 */
const TIME_ZONE = 'America/New_York';

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const MONTH = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });
const clocks = new Map<string, Intl.DateTimeFormat>();

/** $1,234.56 (and -$1,234.56). */
export function formatMoney(cents: number | null | undefined): string {
  return MONEY.format((cents ?? 0) / 100);
}

/** A calendar day stored as "YYYY-MM-DD" (a move date, a due date): "Nov 13, 2026". No time zone shift. */
export function formatDay(day: string | null | undefined): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return '—';
  return DAY.format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
}

/** "Fri, Nov 13" for a calendar day. */
export function formatWeekday(day: string): string {
  return WEEKDAY.format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
}

/** "November 2026" (or "Nov 2026" short) for a "YYYY-MM" or "YYYY-MM-DD". */
export function formatMonth(month: string, style: 'long' | 'short' = 'long'): string {
  return (style === 'long' ? MONTH : MONTH_SHORT).format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));
}

/** "9:05 AM" in a time zone (Ithaca by default). */
export function formatTime(at: Date | string | null | undefined, timeZone: string = TIME_ZONE): string {
  const date = at ? (at instanceof Date ? at : new Date(at)) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
    clocks.set(timeZone, clock);
  }
  return clock.format(date);
}

/** US numbers as "(607) 555-0101" (a leading 1 dropped); anything else as typed. */
/** A wall-clock time of day as typed in a form ("08:00" or "14:30:00") → "8:00 AM", "2:30 PM". */
export function formatClock(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return hhmm ?? '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone || !phone.trim()) return '—';
  const digits = phone.replace(/\D/g, '');
  const us = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (us.length !== 10) return phone.trim();
  return `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`;
}

/** Whole dollars with thousands separators, for big dashboard numbers. */
const MONEY_SHORT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat('en-US');

export function formatMoneyShort(cents: number): string {
  return MONEY_SHORT.format(cents / 100);
}

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DATE = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The day a moment fell on, in Ithaca: "Nov 13, 2026". (A stored calendar day: formatDay.) */
export function formatDate(value: Date | string | null | undefined): string {
  const date = toDate(value);
  // A bare "YYYY-MM-DD" is a calendar day, never shifted a day back by the time zone.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDay(value);
  return date ? DATE.format(date) : '—';
}

/** "Nov 13, 2026, 9:05 AM" in Ithaca. */
export function formatDateTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_TIME.format(date) : '—';
}

/** "3 min ago", "2 days ago". Falls back to the date after a month. */
export function formatRelative(value: Date | string | null | undefined, now = new Date()): string {
  const date = toDate(value);
  if (!date) return '—';
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(date);
}

/** Formats a record value for tables, following the column's declared format. */
export function formatValue(
  value: unknown,
  format: 'text' | 'money' | 'date' | 'datetime' | 'boolean' = 'text',
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (format === 'money') return formatMoney(Number(value));
  if (format === 'date') return formatDate(value as Date | string);
  if (format === 'datetime') return formatDateTime(value as Date | string);
  if (format === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return formatDateTime(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** "camelCaseKey" → "Camel case key", for showing raw field names to people. */
export function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._]/g, ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
