/**
 * The request glue in src/server: the context a module's server action gets. Next.js's
 * cookie store and its notFound()/redirect() are replaced with stand-ins, so this runs
 * without a web server.
 */
import { describe, expect, it, vi } from 'vitest';
import { loginWithDev } from '@/core/auth/login';
import { setPortalEnabled } from '@/core/modules/config';
import { USERS, ctxFor, userId } from './helpers';

let sessionToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (sessionToken ? { value: sessionToken } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

async function signInAs(email: string): Promise<void> {
  sessionToken = (await loginWithDev(await userId(email))).token;
}

describe('requireStaffPortalContext (what every module server action starts with)', () => {
  it('lets a member of the business in, in live and in test mode', async () => {
    const { requireStaffPortalContext } = await import('@/server/session');
    await signInAs(USERS.brssAdmin);
    expect((await requireStaffPortalContext('brss', 'live')).business.slug).toBe('brss');
    expect((await requireStaffPortalContext('brss', 'sandbox')).environment).toBe('sandbox');
    await signInAs(USERS.brssStaff);
    expect((await requireStaffPortalContext('brss', 'live')).role).toBe('business_staff');
  });

  it('answers "not found" for another business, and for an executive (who may not open staff portals)', async () => {
    const { requireBusinessContext, requireStaffPortalContext } = await import('@/server/session');
    await signInAs(USERS.brssAdmin);
    await expect(requireStaffPortalContext('hhmc', 'live')).rejects.toThrow('NOT_FOUND');
    await signInAs(USERS.executive);
    // The executive can read the business, but cannot use its staff portal or its actions.
    expect((await requireBusinessContext('brss', 'live')).role).toBe('executive');
    await expect(requireStaffPortalContext('brss', 'live')).rejects.toThrow('NOT_FOUND');
  });

  it('sends a signed-out person to the login page', async () => {
    const { requireStaffPortalContext } = await import('@/server/session');
    sessionToken = undefined;
    await expect(requireStaffPortalContext('brss', 'live')).rejects.toThrow('REDIRECT /login');
  });

  it('refuses everyone while the staff portal is switched off, for that business only', async () => {
    const { requireStaffPortalContext } = await import('@/server/session');
    const tech = await ctxFor(USERS.tech, 'cbb');
    await setPortalEnabled(tech, 'staff', false);
    try {
      await signInAs(USERS.tech);
      await expect(requireStaffPortalContext('cbb', 'live')).rejects.toThrow('NOT_FOUND');
      expect((await requireStaffPortalContext('brss', 'live')).business.slug).toBe('brss');
    } finally {
      await setPortalEnabled(tech, 'staff', true);
    }
    expect((await requireStaffPortalContext('cbb', 'live')).business.slug).toBe('cbb');
  });
});
