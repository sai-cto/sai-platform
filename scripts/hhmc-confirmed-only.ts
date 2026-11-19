/**
 * Brings existing HHMC moves in line with "the calendar shows only confirmed moves" (managers'
 * feedback round 1, Nov 2026):  npm run hhmc:confirmed-only            (dry run: lists only)
 *                               npm run hhmc:confirmed-only -- --apply (makes the change)
 *
 * A Booked move whose deposit was never paid goes back to "Estimate sent" (appointments
 * cancelled, a note on the move); nothing is deleted. It also counts the requests and estimates
 * that the calendar used to show and no longer does. LOCAL database only (.env.local).
 */
import { loadEnv } from './lib/env';

async function main() {
  loadEnv();
  const apply = process.argv.includes('--apply');
  const { systemContext } = await import('../src/core/tenancy/system');
  const { withScope } = await import('../src/core/db/scope');
  const { and, eq, inArray, isNotNull } = await import('drizzle-orm');
  const { hhmcJobs } = await import('../src/modules/hhmc/schema');
  const { unconfirmMovesWithoutDeposit } = await import('../src/modules/hhmc/services/booking');
  const { closeDb } = await import('../src/core/db/client');
  for (const environment of ['live', 'sandbox'] as const) {
    const ctx = await systemContext('hhmc', environment);
    const result = await withScope(ctx, 'hhmc.jobs.book', async (s) => {
      // Requests and estimates with a move date were on the old calendar; now they are not.
      const notConfirmed = await s.db.$count(
        hhmcJobs,
        and(s.where(hhmcJobs), inArray(hhmcJobs.stage, ['qualified', 'estimate_sent']), isNotNull(hhmcJobs.moveDate)),
      );
      const moved = await unconfirmMovesWithoutDeposit(s, { apply });
      const confirmed = await s.db.$count(hhmcJobs, and(s.where(hhmcJobs), eq(hhmcJobs.stage, 'booked')));
      return { notConfirmed, moved, confirmed };
    });
    console.log(
      `${environment}: ${result.moved.length} booked move(s) without a paid deposit ${apply ? 'moved back to Estimate sent' : 'would move back to Estimate sent'}` +
        `${result.moved.length ? ` (${result.moved.map((m) => m.jobNumber).join(', ')})` : ''}; ` +
        `${result.notConfirmed} request(s)/estimate(s) no longer shown on the calendar; ${result.confirmed} confirmed move(s) ${apply ? 'remain' : 'now'}.`,
    );
  }
  if (!apply) console.log('Dry run: nothing changed. Add --apply to make the change.');
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
