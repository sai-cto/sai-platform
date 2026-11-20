/**
 * PILOT MODE: the hosted site with REAL data, before it is fully live (DECISIONS P5-31).
 *
 * PILOT_MODE=true means:
 *   - sign-in with SAI's Microsoft 365 only (the dev login and demo passwords are off);
 *   - accounts come from PILOT_ACCOUNTS (and from People and access afterwards);
 *   - live data starts empty and is never wiped by a deploy; test mode has fake data;
 *   - no email ever reaches a customer, and live card payments are refused (cash and check
 *     can be recorded), until an email service and a card processor are connected;
 *   - a "PILOT" banner on every page says so.
 */
export function isPilotMode(): boolean {
  return process.env.PILOT_MODE === 'true';
}

/** The site's own address: APP_URL, or on Vercel the production address it knows. */
export function siteUrl(fallback = 'http://localhost:3000'): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return (process.env.APP_URL || (vercel ? `https://${vercel}` : fallback)).replace(/\/$/, '');
}

/**
 * The host the browser used for this request. Behind a load balancer (AWS) the server listens on
 * its own address, so request.url names that address; the Host header (or X-Forwarded-Host, when
 * a proxy sets it) still carries the public one.
 */
export function requestHost(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('host') || new URL(request.url).host;
}

/** cto = super admin; tech = tech team; gm = admin of the pilot business; staff = its staff. */
export type PilotRole = 'cto' | 'tech' | 'gm' | 'staff';
export type PilotAccount = { email: string; name: string; role: PilotRole };

/**
 * PILOT_ACCOUNTS: one per line or separated by ";", each "email|Full name|role". No passwords:
 * people sign in with their Microsoft account, matched by this email.
 */
export function parsePilotAccounts(raw: string | undefined): { accounts: PilotAccount[]; problems: string[] } {
  const accounts: PilotAccount[] = [];
  const problems: string[] = [];
  for (const [index, entry] of (raw ?? '').split(/[;\n]/).map((e) => e.trim()).filter(Boolean).entries()) {
    const [email, name, role] = entry.split('|').map((p) => p?.trim());
    const n = index + 1;
    if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) problems.push(`Account ${n}: the email is missing or not valid.`);
    else if (!name) problems.push(`Account ${n}: the name is missing.`);
    else if (role !== 'cto' && role !== 'tech' && role !== 'gm' && role !== 'staff') problems.push(`Account ${n}: the role must be cto, tech, gm or staff.`);
    else accounts.push({ email: email.toLowerCase(), name, role });
  }
  return { accounts, problems };
}

/** True only for a database on this machine. Local-only tools (dev login, db:seed) require it. */
export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}
