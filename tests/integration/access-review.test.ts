/**
 * Access review checks (docs/access-review.md): business roles get no platform navigation, search
 * stays inside the business and its permissions, feedback and the error log are tech-only.
 */
import { describe, expect, it } from 'vitest';
import { businessTabs, platformLinks } from '@/app/console/_lib/nav';
import { listFeedback, sendFeedback } from '@/core/feedback/feedback';
import { listServerErrors } from '@/core/health/errors';
import { ForbiddenError } from '@/core/errors';
import { searchHhmc } from '@/modules/hhmc/services/search';
import { createInvoice } from '@/modules/hhmc/services/invoices';
import { CORE, P } from '@/modules/hhmc/permissions';
import { ctxFor, platformCtxFor, USERS } from './helpers';
import { bookedJob, gm } from './hhmc-helpers';

const base = '/console/hhmc/live/app';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test double of a context with fewer permissions
const without = (ctx: any, ...keys: string[]) => ({ ...ctx, permissions: new Set([...ctx.permissions].filter((k: string) => !keys.includes(k))) });

describe('a. navigation for business roles', () => {
  it('admin and staff: App tab only, no platform links', async () => {
    for (const [email, slug] of [[USERS.brssAdmin, 'brss'], [USERS.brssStaff, 'brss'], [USERS.brssNewHire, 'brss'], [USERS.hhmcAdmin, 'hhmc'], [USERS.hhmcStaff, 'hhmc']] as const) {
      expect(businessTabs(await ctxFor(email, slug)).map((t) => t.key), email).toEqual(['app']);
      expect(platformLinks(await platformCtxFor(email)), email).toEqual([]);
    }
  });
});

describe('b. search stays inside the tenant and checks each group', () => {
  it('another business context finds none of HHMC rows even with HHMC permissions forced on', async () => {
    const ctx = await gm();
    const { job } = await bookedJob(ctx);
    const invoice = await createInvoice(ctx, job.id);
    const brss = await ctxFor(USERS.brssAdmin, 'brss');
    const forged = { ...brss, permissions: new Set([...brss.permissions, ...ctx.permissions]) } as typeof brss;
    expect(await searchHhmc(forged, invoice.invoiceNumber, base)).toEqual([]);
    expect(await searchHhmc(forged, job.jobNumber ?? 'J-', base)).toEqual([]);
    expect((await searchHhmc(ctx, invoice.invoiceNumber, base)).some((h) => h.group === 'Invoices')).toBe(true);
  });
  it('a group is skipped when its read permission is missing', async () => {
    const ctx = await gm();
    const { job } = await bookedJob(ctx);
    const invoice = await createInvoice(ctx, job.id);
    const noInv = without(ctx, P.invoicesRead);
    expect((await searchHhmc(noInv, invoice.invoiceNumber, base)).some((h) => h.group === 'Invoices')).toBe(false);
    const noCust = without(ctx, CORE.customersRead, P.leadsRead);
    const hits = await searchHhmc(noCust, 'Tester', base);
    expect(hits.some((h) => h.group === 'Contacts' || h.group === 'Leads')).toBe(false);
    await expect(searchHhmc(without(ctx, P.jobsRead), 'Tester', base)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('c/d. feedback and error log', () => {
  it('staff can send; executive cannot send', async () => {
    const staff = await ctxFor(USERS.hhmcStaff, 'hhmc');
    expect((await sendFeedback(staff, { message: 'staff note', pageUrl: '/console/hhmc/live/app' })).status).toBe('new');
    const exec = await ctxFor(USERS.executive, 'hhmc');
    await expect(sendFeedback(exec, { message: 'exec note', pageUrl: '/x' })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('only tech and super admin read feedback and errors', async () => {
    for (const email of [USERS.executive, USERS.brssStaff, USERS.hhmcStaff, USERS.brssAdmin]) {
      const p = await platformCtxFor(email);
      await expect(listFeedback(p), email).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listServerErrors(p), email).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const email of [USERS.tech, USERS.superAdmin]) {
      const p = await platformCtxFor(email);
      await expect(listFeedback(p)).resolves.toBeInstanceOf(Array);
      await expect(listServerErrors(p)).resolves.toBeInstanceOf(Array);
    }
  });
});

describe('security: pageUrl', () => {
  it('a path that would link to another site ("//host") is not kept', async () => {
    const gmCtx = await gm();
    const a = await sendFeedback(gmCtx, { message: 'x', pageUrl: '/console/../..//evil.example/x' });
    const b = await sendFeedback(gmCtx, { message: 'x', pageUrl: 'http://app.local//evil.example/x' });
    expect(a.pageUrl).toBe('');
    expect(b.pageUrl).toBe('');
    const c = await sendFeedback(gmCtx, { message: 'x', pageUrl: 'https://evil.example/console/hhmc' });
    expect(c.pageUrl).toBe('/console/hhmc'); // the path only: the link stays on this site
  });
});
