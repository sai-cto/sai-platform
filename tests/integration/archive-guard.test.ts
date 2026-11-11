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
    // Restoring brings them back as they were.
    const entity = entitiesFor('hhmc').find((e) => e.key === 'hhmc.job')!;
    await withScope(ctx, 'business.data.read', (s) => restoreRecord(s, entity, closed));
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
    await expect(dataTabArchive(ctx, 'hhmc.quote_line', ids.line)).rejects.toThrow(/locked/);
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
  });
});
