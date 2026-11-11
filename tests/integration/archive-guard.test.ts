/**
 * The Data tab cannot archive around module rules (entity archiveGuard, enforced in the core's
 * archiveRecord). Archives here go through exactly what the Data tab's action calls.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withScope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { entitiesFor } from '@/core/modules/registry';
import { archiveRecord, restoreRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { brssOrderItems, brssOrders } from '@/modules/brss/schema';
import { hhmcEstimates, hhmcInvoices, hhmcJobs } from '@/modules/hhmc/schema';
import type { TenantTable } from '@/core/records/types';
import { USERS, ctxFor } from './helpers';

/** What src/app/console/[business]/[mode]/data/actions.ts does. */
function dataTabArchive(ctx: BusinessContext, entityKey: string, id: string) {
  const entity = entitiesFor(ctx.business.moduleKey).find((e) => e.key === entityKey)!;
  return withScope(ctx, 'business.data.read', (s) => archiveRecord(s, entity, id));
}

async function firstId(ctx: BusinessContext, table: TenantTable, where: Parameters<typeof and>[0]) {
  return withScope(ctx, 'business.overview.read', async (s) => {
    const [row] = await s.db.select({ id: table.id }).from(table).where(and(s.where(table), where)).limit(1);
    return String(row.id);
  });
}

describe('HHMC: the Data tab cannot archive around the rules', () => {
  it('a signed estimate, a paid invoice and a booked job are refused; void and closed records are allowed', async () => {
    const ctx = await ctxFor(USERS.superAdmin, 'hhmc', 'sandbox');
    const signed = await firstId(ctx, hhmcEstimates, eq(hhmcEstimates.status, 'signed'));
    await expect(dataTabArchive(ctx, 'hhmc.estimate', signed)).rejects.toThrow(/signed estimate is kept/);
    const paid = await firstId(ctx, hhmcInvoices, eq(hhmcInvoices.status, 'paid'));
    await expect(dataTabArchive(ctx, 'hhmc.invoice', paid)).rejects.toBeInstanceOf(ValidationError);
    const booked = await firstId(ctx, hhmcJobs, eq(hhmcJobs.stage, 'booked'));
    await expect(dataTabArchive(ctx, 'hhmc.job', booked)).rejects.toThrow(/Release the booking/);

    const voided = await firstId(ctx, hhmcEstimates, eq(hhmcEstimates.status, 'void'));
    await dataTabArchive(ctx, 'hhmc.estimate', voided);
    const closed = await firstId(ctx, hhmcJobs, eq(hhmcJobs.stage, 'closed'));
    await dataTabArchive(ctx, 'hhmc.job', closed);
    const voidInvoice = await firstId(ctx, hhmcInvoices, eq(hhmcInvoices.status, 'void'));
    await dataTabArchive(ctx, 'hhmc.invoice', voidInvoice);
    // Restoring brings them back as they were (and leaves the shared test data as it was).
    for (const [key, id] of [['hhmc.job', closed], ['hhmc.estimate', voided], ['hhmc.invoice', voidInvoice]] as const) {
      const entity = entitiesFor('hhmc').find((e) => e.key === key)!;
      await withScope(ctx, 'business.data.read', (s) => restoreRecord(s, entity, id));
    }
  });

  it('quote lines of a signed estimate and lines of a sent invoice are refused', async () => {
    const ctx = await ctxFor(USERS.superAdmin, 'hhmc', 'sandbox');
    const ids = await withScope(ctx, 'business.overview.read', async (s) => {
      const { hhmcQuoteLines, hhmcQuotes, hhmcInvoiceLines } = await import('@/modules/hhmc/schema');
      const [line] = await s.db
        .select({ id: hhmcQuoteLines.id })
        .from(hhmcQuoteLines)
        .innerJoin(hhmcQuotes, eq(hhmcQuotes.id, hhmcQuoteLines.quoteId))
        .innerJoin(hhmcEstimates, and(eq(hhmcEstimates.jobId, hhmcQuotes.jobId), eq(hhmcEstimates.status, 'signed')))
        // A job still at Estimate Sent: only the signed estimate locks its quote.
        .innerJoin(hhmcJobs, and(eq(hhmcJobs.id, hhmcQuotes.jobId), eq(hhmcJobs.stage, 'estimate_sent')))
        .where(s.where(hhmcQuoteLines))
        .limit(1);
      const [invLine] = await s.db
        .select({ id: hhmcInvoiceLines.id })
        .from(hhmcInvoiceLines)
        .innerJoin(hhmcInvoices, and(eq(hhmcInvoices.id, hhmcInvoiceLines.invoiceId), inArray(hhmcInvoices.status, ['sent', 'paid'])))
        .where(s.where(hhmcInvoiceLines))
        .limit(1);
      return { line: line.id, invLine: invLine.id };
    });
    await expect(dataTabArchive(ctx, 'hhmc.quote_line', ids.line)).rejects.toThrow(/signed the estimate/);
    await expect(dataTabArchive(ctx, 'hhmc.invoice_line', ids.invLine)).rejects.toThrow(/draft/);
  });
});

describe('BRSS: the Data tab cannot archive around the rules', () => {
  it('an order in progress and a paid charge are refused; a closed order is allowed', async () => {
    const ctx = await ctxFor(USERS.superAdmin, 'brss', 'sandbox');
    const open = await firstId(ctx, brssOrders, inArray(brssOrders.status, ['open', 'activated']));
    await expect(dataTabArchive(ctx, 'brss.order', open)).rejects.toThrow(/Close or cancel/);
    const paid = await firstId(ctx, brssOrderItems, eq(brssOrderItems.status, 'paid'));
    await expect(dataTabArchive(ctx, 'brss.order_item', paid)).rejects.toThrow(/paid charge/);
    const closed = await firstId(ctx, brssOrders, inArray(brssOrders.status, ['closed', 'cancelled']));
    await dataTabArchive(ctx, 'brss.order', closed);
    const order = entitiesFor('brss').find((e) => e.key === 'brss.order')!;
    await withScope(ctx, 'business.data.read', (s) => restoreRecord(s, order, closed));
  });
});

describe('restore and core records follow the same rules', () => {
  it('a draft invoice re-prices itself when a line is archived or restored from the Data tab', async () => {
    const ctx = await ctxFor(USERS.superAdmin, 'hhmc', 'sandbox');
    const { hhmcInvoiceLines } = await import('@/modules/hhmc/schema');
    const draft = await firstId(ctx, hhmcInvoices, eq(hhmcInvoices.status, 'draft'));
    const totalOf = () => withScope(ctx, 'business.overview.read', async (s) => (await s.db.select().from(hhmcInvoices).where(eq(hhmcInvoices.id, draft)))[0].subtotalCents);
    const line = await withScope(ctx, 'business.overview.read', async (s) => (await s.db.select().from(hhmcInvoiceLines).where(and(s.where(hhmcInvoiceLines), eq(hhmcInvoiceLines.invoiceId, draft))).limit(1))[0]);
    const before = await totalOf();
    await dataTabArchive(ctx, 'hhmc.invoice_line', line.id);
    expect(await totalOf()).toBeLessThan(before);
    const entity = entitiesFor('hhmc').find((e) => e.key === 'hhmc.invoice_line')!;
    await withScope(ctx, 'business.data.read', (s) => restoreRecord(s, entity, line.id));
    expect(await totalOf()).toBe(before);
    // A draft invoice itself cannot be archived (void it first).
    await expect(dataTabArchive(ctx, 'hhmc.invoice', draft)).rejects.toThrow(/Void it first/);
  });

  it('a booked appointment and a deposit belonging to an HHMC record cannot be archived on their own', async () => {
    const ctx = await ctxFor(USERS.superAdmin, 'hhmc', 'sandbox');
    const { appointments, payments } = await import('@/core/db/schema');
    const appt = await firstId(ctx, appointments, eq(appointments.kind, 'hhmc.job_day'));
    await expect(dataTabArchive(ctx, 'core.appointment', appt)).rejects.toThrow(/belongs to/);
    const deposit = await firstId(ctx, payments, and(eq(payments.subjectType, 'hhmc.estimate'), eq(payments.status, 'succeeded')));
    await expect(dataTabArchive(ctx, 'core.payment', deposit)).rejects.toThrow(/Refund it instead/);
  });

  it('a charge cannot be restored onto a closed BRSS order', async () => {
    const ctx = await ctxFor(USERS.superAdmin, 'brss', 'sandbox');
    const { arrange } = await import('./helpers');
    const itemEntity = entitiesFor('brss').find((e) => e.key === 'brss.order_item')!;
    const orderEntity = entitiesFor('brss').find((e) => e.key === 'brss.order')!;
    // An unpaid charge on an open order: archive it, close the order, then try to restore it.
    const item = await withScope(ctx, 'business.overview.read', async (s) => {
      const [row] = await s.db
        .select({ id: brssOrderItems.id, orderId: brssOrderItems.orderId, status: brssOrders.status })
        .from(brssOrderItems)
        .innerJoin(brssOrders, eq(brssOrders.id, brssOrderItems.orderId))
        .where(and(s.where(brssOrderItems), eq(brssOrderItems.status, 'new'), inArray(brssOrders.status, ['open', 'activated'])))
        .limit(1);
      return row;
    });
    expect(item).toBeTruthy();
    const { updateRecord } = await import('@/core/records/records');
    await arrange('brss', 'sandbox', async (s) => {
      await archiveRecord(s, itemEntity, item.id);
      await updateRecord(s, orderEntity, item.orderId, { status: 'closed' });
    });
    await expect(withScope(ctx, 'business.data.read', (s) => restoreRecord(s, itemEntity, item.id))).rejects.toThrow(/reopen it first/);
    await arrange('brss', 'sandbox', async (s) => {
      await updateRecord(s, orderEntity, item.orderId, { status: item.status });
      await restoreRecord(s, itemEntity, item.id);
    });
  });
});
