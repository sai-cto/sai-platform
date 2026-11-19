/**
 * HHMC managers' feedback round 1 (Nov 2026): a converted lead's notes on its work request, and
 * the Leads list showing every lead. The service-type rule and the confirmed-only calendar have
 * their own tests (hhmc-service-type.test.ts, hhmc-calendar.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { addNote } from '@/modules/hhmc/services/jobs';
import { convertLead, createLead, disqualifyLead, listLeads } from '@/modules/hhmc/services/leads';
import { jobPage } from '@/modules/hhmc/services/views';
import { USERS, ctxFor } from './helpers';
import { dayFromNow, gm, tag } from './hhmc-helpers';

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
