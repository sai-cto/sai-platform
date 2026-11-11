/**
 * Sends HHMC's due automation emails, live and test mode:  npm run hhmc:automations
 *
 * Stand-in for a scheduler, which the platform does not have yet (docs/HANDOFF.md). Run it by
 * hand, or from cron once the app is hosted. It runs as the system actor; every email is
 * re-checked before it is sent, and every send is in the activity log.
 */
import { loadEnv } from './lib/env';

async function main() {
  loadEnv();
  const { systemContext } = await import('../src/core/tenancy/system');
  const { withScope } = await import('../src/core/db/scope');
  const { processDueAutomationsInScope } = await import('../src/modules/hhmc/services/automations');
  const { closeDb } = await import('../src/core/db/client');
  const now = new Date();
  for (const environment of ['live', 'sandbox'] as const) {
    const ctx = await systemContext('hhmc', environment);
    const result = await withScope(ctx, 'hhmc.automations.run', (s) => processDueAutomationsInScope(s, now));
    console.log(`  ${environment}: sent ${result.sent}, cancelled ${result.cancelled}, failed ${result.failed}`);
  }
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
