/**
 * HHMC managers' feedback round 1 (Nov 2026): a converted lead's notes on its work request, and
 * the Leads list showing every lead, and the Terms & Conditions PDF on the estimate link. The service-type rule and the confirmed-only calendar have
 * their own tests (hhmc-service-type.test.ts, hhmc-calendar.test.ts).
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withScope } from '@/core/db/scope';
import { NotFoundError } from '@/core/errors';
import { buildLinkContext, openLinkFile } from '@/core/links/links';
import type { BusinessContext } from '@/core/tenancy/context';
import { hhmcEstimates } from '@/modules/hhmc/schema';
import { customerLinkFor, sendEstimate, signEstimateByLink } from '@/modules/hhmc/services/estimates';
import { NO_TERMS_PDF, TERMS_PDF_LINK_NAME, termsPdfInfo, uploadTermsPdf } from '@/modules/hhmc/services/terms-pdf';
import { addNote } from '@/modules/hhmc/services/jobs';
import { convertLead, createLead, disqualifyLead, listLeads } from '@/modules/hhmc/services/leads';
import { jobPage } from '@/modules/hhmc/services/views';
import { USERS, ctxFor } from './helpers';
import { dayFromNow, gm, newJob, signedJob, tag } from './hhmc-helpers';

async function lead(extra: Record<string, unknown> = {}) {
  const t = tag();
  return createLead(await gm(), {
    firstName: 'Notes',
    lastName: `Carry${t}`,
    email: `notes.${t}@example.com`,
    source: 'Google',
    moveDate: dayFromNow(600),
    originAddress: '1 Test St, Ithaca, NY',
    destinationAddress: '2 Test St, Ithaca, NY',
    ...extra,
  });
}

describe('a converted lead keeps its notes', () => {
  it("the lead's notes and calls show on the work request, marked as from the lead", async () => {
    const ctx = await gm();
    const l = await lead();
    await addNote(ctx, { leadId: l.id }, { kind: 'note', body: 'Has a piano on the second floor' });
    await addNote(ctx, { leadId: l.id }, { kind: 'call', callOutcome: 'voicemail', body: 'Left a message' });
    const { job } = await convertLead(ctx, l.id, {});
    await addNote(ctx, { jobId: job.id }, { kind: 'note', body: 'Quote sent by phone' });

    const page = await jobPage(ctx, job.id);
    const bodies = page.notes.map((n) => n.body);
    expect(bodies).toEqual(expect.arrayContaining(['Has a piano on the second floor', 'Left a message', 'Quote sent by phone']));
    expect(page.notes.filter((n) => n.leadId === l.id && n.jobId !== job.id)).toHaveLength(2);
    expect(page.lead?.id).toBe(l.id);
  });

  it("the lead's customer and internal notes are carried into the work request", async () => {
    const ctx = await gm();
    const l = await lead({ customerNote: 'Please call after 5', internalNote: 'Referred by a past customer' });
    const { job } = await convertLead(ctx, l.id, {});
    expect(job.customerComments).toBe('Please call after 5');
    expect(job.internalNotes).toBe('Referred by a past customer');
  });

  it('staff who may not read leads see only the notes of the job', async () => {
    const ctx = await gm();
    const l = await lead();
    await addNote(ctx, { leadId: l.id }, { kind: 'note', body: 'Lead only' });
    const { job } = await convertLead(ctx, l.id, {});
    const noLeads = { ...(await gm()), permissions: new Set([...(await gm()).permissions].filter((p) => p !== 'hhmc.leads.read')) };
    const page = await jobPage(noLeads, job.id);
    expect(page.notes.map((n) => n.body)).not.toContain('Lead only');
  });
});

describe('managers see all leads', () => {
  it('the Leads list shows every status by default, for the business admin and staff', async () => {
    const ctx = await gm();
    const t = tag();
    const open = await lead({ lastName: `AllLeads${t}` });
    const gone = await lead({ lastName: `AllLeads${t}` });
    await disqualifyLead(ctx, gone.id, 'Out of area');
    for (const who of [USERS.hhmcAdmin, USERS.hhmcStaff]) {
      const { rows } = await listLeads(await ctxFor(who, 'hhmc'), { q: `AllLeads${t}` });
      expect(rows.map((r) => r.id).sort()).toEqual([open.id, gone.id].sort());
    }
  });
});

describe('the full Terms & Conditions PDF on the estimate link', () => {
  const pdfBytes = (label: string) => new TextEncoder().encode(`%PDF-1.4\n% fake terms for tests: ${label}\n%%EOF\n`);
  const signedTermsOf = (ctx: BusinessContext, id: string) =>
    withScope(ctx, 'hhmc.jobs.read', async (s) => (await s.db.select().from(hhmcEstimates).where(eq(hhmcEstimates.id, id)))[0]);
  const tokenOf = async (ctx: BusinessContext, estimateId: string) => (await customerLinkFor(ctx, estimateId)).split('/l/')[1];

  it('without a PDF the signing record says so (test mode has none)', async () => {
    const ctx = await gm('sandbox');
    expect(await termsPdfInfo(ctx)).toBeNull();
    const { estimate } = await signedJob(ctx);
    const row = await signedTermsOf(ctx, estimate.id);
    expect(row.signedTermsVersion).toBe(NO_TERMS_PDF);
    await expect(openLinkFile(await tokenOf(ctx, estimate.id), TERMS_PDF_LINK_NAME)).rejects.toThrow(NotFoundError);
  });

  it('only a real PDF is accepted, and only by someone who may change the settings', async () => {
    await expect(uploadTermsPdf(await gm(), { filename: 'terms.txt', bytes: new TextEncoder().encode('plain text') })).rejects.toThrow(/not a PDF/);
    const staff = await ctxFor(USERS.hhmcStaff, 'hhmc');
    if (!staff.permissions.has('hhmc.catalog.write')) await expect(uploadTermsPdf(staff, { filename: 't.pdf', bytes: pdfBytes('staff') })).rejects.toThrow();
  });

  it('the link opens the PDF before signing, and the signature records the version shown', async () => {
    const ctx = await gm();
    const pdf = await uploadTermsPdf(ctx, { filename: 'Hired Hands terms.pdf', bytes: pdfBytes(tag()) });
    expect((await termsPdfInfo(ctx))?.version).toBe(pdf.version);
    const job = await newJob(ctx);
    const estimate = await sendEstimate(ctx, job.id);
    expect(estimate.snapshot.termsPdf?.version).toBe(pdf.version);
    const token = await tokenOf(ctx, estimate.id);
    const file = await openLinkFile(token, TERMS_PDF_LINK_NAME);
    expect(file.contentType).toBe('application/pdf');
    expect(new TextDecoder().decode(file.bytes.slice(0, 5))).toBe('%PDF-');
    await expect(openLinkFile(token, 'other.pdf')).rejects.toThrow(NotFoundError);
    // A newer upload does not change what this estimate shows or records.
    await uploadTermsPdf(ctx, { filename: 'terms v2.pdf', bytes: pdfBytes(tag()) });
    await signEstimateByLink(await buildLinkContext(token), { valuationInitials: 'NC', signatureName: 'Notes Carry', agree: true, ip: null, userAgent: null });
    const row = await signedTermsOf(ctx, estimate.id);
    expect(row.signedTermsVersion).toBe(pdf.version);
  });
});
