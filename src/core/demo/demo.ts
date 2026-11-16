/**
 * DEMO MODE: the hosted test site for business managers (docs/DEPLOY-DEMO.md, DECISIONS P5-16).
 *
 * DEMO_MODE=true turns on, together:
 *   - a shared access password in front of the whole site (DEMO_ACCESS_PASSWORD, src/proxy.ts);
 *   - email + password sign-in for the demo accounts in DEMO_ACCOUNTS (nothing stored in the DB);
 *   - a "TEST SITE – not real data" banner on every page;
 *   - mock payments and log-only email, whatever else is configured;
 *   - the dev login switched OFF, whatever AUTH_DEV_LOGIN says.
 *
 * Nothing here holds a secret in the repository: every password comes from the environment.
 */
import crypto from 'node:crypto';

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

export type DemoRole = 'gm' | 'staff' | 'tech';

export type DemoAccount = { email: string; name: string; role: DemoRole; password: string };

/** The shortest password accepted for a demo account or the access gate. */
export const MIN_DEMO_PASSWORD = 12;

/**
 * DEMO_ACCOUNTS: one account per line or separated by ";", each "email|Full name|role|password".
 * role: gm (business admin of the demo business), staff, or tech (the tech team). Lines that are
 * malformed, or whose password is shorter than 12 characters, are ignored (and reported by
 * `npm run demo:prepare`).
 */
export function parseDemoAccounts(raw: string | undefined): { accounts: DemoAccount[]; problems: string[] } {
  const accounts: DemoAccount[] = [];
  const problems: string[] = [];
  for (const [index, entry] of (raw ?? '').split(/[;\n]/).map((e) => e.trim()).filter(Boolean).entries()) {
    const [email, name, role, ...rest] = entry.split('|');
    const password = rest.join('|');
    const n = index + 1;
    if (!email || !/^[^@\s]+@[^@\s]+$/.test(email.trim())) problems.push(`Account ${n}: the email is missing or not valid.`);
    else if (!name?.trim()) problems.push(`Account ${n}: the name is missing.`);
    else if (role !== 'gm' && role !== 'staff' && role !== 'tech') problems.push(`Account ${n}: the role must be gm, staff or tech.`);
    else if (password.length < MIN_DEMO_PASSWORD) problems.push(`Account ${n}: the password must be at least ${MIN_DEMO_PASSWORD} characters.`);
    else accounts.push({ email: email.trim().toLowerCase(), name: name.trim(), role, password });
  }
  return { accounts, problems };
}

export function demoAccounts(): DemoAccount[] {
  return isDemoMode() ? parseDemoAccounts(process.env.DEMO_ACCOUNTS).accounts : [];
}

/** Compares two secrets in constant time (no early exit that would leak how much matched). */
export function sameSecret(given: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b) && given.length === expected.length;
}

/** The demo account with this email and password, or null. */
export function checkDemoPassword(email: string, password: string): DemoAccount | null {
  const wanted = email.trim().toLowerCase();
  let found: DemoAccount | null = null;
  // Check every account (no early return), so timing does not reveal which emails exist.
  for (const account of demoAccounts()) {
    // Both comparisons always run (no short-circuit), so timing does not reveal emails.
    const emailMatches = sameSecret(account.email, wanted);
    const passwordMatches = sameSecret(password, account.password);
    if (emailMatches && passwordMatches) found = account;
  }
  return found;
}

// ---------------------------------------------------------------- the access gate

export const ACCESS_COOKIE = 'sai_demo_access';

/** Is the site-wide access password switched on? (Only in demo mode, and only with a password.) */
export function accessGateEnabled(): boolean {
  return isDemoMode() && (process.env.DEMO_ACCESS_PASSWORD ?? '').length > 0;
}

/** The value of the access cookie for the configured password (changes if the password changes). */
export function accessCookieValue(): string {
  return crypto
    .createHmac('sha256', process.env.DEMO_ACCESS_PASSWORD ?? '')
    .update('sai-demo-access-v1')
    .digest('base64url');
}

export function accessCookieValid(value: string | undefined): boolean {
  if (!accessGateEnabled()) return true;
  return typeof value === 'string' && sameSecret(value, accessCookieValue());
}

export function accessPasswordMatches(given: string): boolean {
  const expected = process.env.DEMO_ACCESS_PASSWORD ?? '';
  return accessGateEnabled() && sameSecret(given, expected);
}

/**
 * A path on this site to go back to after the access password: never another site.
 * "/\\evil.com", "//evil.com" or a full URL all become "/".
 */
export function safeLocalPath(next: string): string {
  if (!next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f]/.test(next)) return '/';
  const url = new URL(next, 'http://local.invalid');
  return url.origin === 'http://local.invalid' ? `${url.pathname}${url.search}` : '/';
}

/** A pause after a wrong password: slows down guessing (there is no account lockout). */
export function slowDown(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === 'test' ? 0 : 800));
}

/** Paths that skip the access gate: health check, the gate itself, the scheduler (own secret), the website intake (own checks), static files. */
export function bypassesAccessGate(pathname: string): boolean {
  return (
    pathname === '/access' ||
    pathname === '/api/health' ||
    pathname.startsWith('/api/cron/') ||
    pathname.startsWith('/api/public/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/icon.svg' ||
    pathname === '/favicon.ico'
  );
}
