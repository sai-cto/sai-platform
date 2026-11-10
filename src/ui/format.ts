/** Display formatting shared by every screen. All times are shown in Ithaca time. */
const TIME_ZONE = 'America/New_York';

export function formatMoney(cents: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    (cents ?? 0) / 100,
  );
}

/** Whole dollars with thousands separators, for big dashboard numbers. */
export function formatMoneyShort(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: Date | string | null | undefined): string {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(date)
    : '—';
}

export function formatDateTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: TIME_ZONE,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date)
    : '—';
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
