/**
 * The console's search box on Hired Hands pages: customers, leads, work requests, estimates and
 * invoices by name, email, phone (any formatting) or number; only what the person may read; only
 * this business and mode; fast.
 */
import { describe, expect, it } from 'vitest';
import { getModule } from '@/core/modules/registry';
import { searchHhmc } from '@/modules/hhmc/services/search';
import { searchAction } from '@/server/search-actions';
import { createInvoice, sendInvoice } from '@/modules/hhmc/services/invoices';
import { bookedJob, gm, tag } from './hhmc-helpers';
import { ctxFor, USERS } from './helpers';
import { withScope } from '@/core/db/scope';
import { P } from '@/modules/hhmc/permissions';
import { loadCustomer, loadJob } from '@/modules/hhmc/services/common';

const base = '/console/hhmc/live/app';

describe('HHMC search', () => {
  it('finds a move by its customer name, email, phone in any format, and by its numbers', async () => {
    const ctx = await gm();
    const { job } = await bookedJob(ctx);
    const invoice = await createInvoice(ctx, job.id);
    await sendInvoice(ctx, invoice.id);
    const { customer, full } = await withScope(ctx, P.jobsRead, async (s) => {
      const full = await loadJob(s, job.id);
      return { full, customer: await loadCustomer(s, full.customerId) };
    });
    const groups = async (q: string) => (await searchHhmc(ctx, q, base)).map((h) => `${h.group}|${h.href}`);
    const lastName = customer.lastName;
    expect(await groups(lastName)).toContain(`Contacts|${base}/contacts/${customer.id}`);
    expect(await groups(lastName)).toContain(`Work requests|${base}/jobs/${job.id}`);
    expect(await groups(customer.email!.toUpperCase())).toContain(`Contacts|${base}/contacts/${customer.id}`);
    // 607-555-01xx typed as "(607) 55501xx" still finds them.
    const d = customer.phone!.replace(/\D/g, '');
    expect(await groups(`(${d.slice(0, 3)}) ${d.slice(3)}`)).toContain(`Contacts|${base}/contacts/${customer.id}`);
    expect(await groups(full.jobNumber)).toContain(`Work requests|${base}/jobs/${job.id}`);
    expect(await groups(invoice.invoiceNumber)).toContain(`Invoices|${base}/invoices/${invoice.id}`);
    expect(await searchHhmc(ctx, 'x', base)).toEqual([]); // one letter: nothing yet
    expect(await searchHhmc(ctx, '%_%', base)).toEqual([]); // wildcards are literal
  });

  it('only what the person may read, only this business and mode', async () => {
    const ctx = await gm();
    const { job } = await bookedJob(ctx);
    const invoice = await createInvoice(ctx, job.id);
    const staff = await ctxFor(USERS.hhmcStaff, 'hhmc', 'live');
    const staffHits = await searchHhmc(staff, invoice.invoiceNumber, base);
    expect(staff.permissions.has(P.invoicesRead) ? true : staffHits.every((h) => h.group !== 'Invoices')).toBe(true);
    const sandbox = await gm('sandbox');
    expect((await searchHhmc(sandbox, invoice.invoiceNumber, base)).some((h) => h.href.endsWith(invoice.id))).toBe(false);
    // Another business's admin: the action finds nothing (it cannot open HHMC at all).
    expect(await searchAction('hhmc', 'live', invoice.invoiceNumber).catch(() => [])).toEqual([]);
    expect(getModule('hhmc')?.search).toBeDefined();
  });

  it('answers in well under a second', async () => {
    const ctx = await gm();
    const t0 = performance.now();
    for (const q of ['Tester', '555', 'J-0', 'parity', `zz${tag()}`]) await searchHhmc(ctx, q, base);
    expect((performance.now() - t0) / 5).toBeLessThan(500);
  });
});
