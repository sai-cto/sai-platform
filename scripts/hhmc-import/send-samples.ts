/**
 * Sends ONE sample of each chosen HHMC email, with HHMC Live's own templates filled with made-up
 * values, to ONE allow-listed address, through the real channel (Amazon SES). For checking how
 * the emails look in a real inbox before customers get them.
 *
 *   npx tsx scripts/hhmc-import/send-samples.ts --to <address> --keys booked,move_reminder --confirm-host <db host>
 *
 * Refuses: more than MAX_SAMPLES keys, a recipient not in EMAIL_ALLOWED_RECIPIENTS, no SES
 * configuration, or a key with no template. Each email is logged like any other (notifications).
 * Run on AWS by scripts/aws/send-sample-emails.sh.
 */
import { withScope } from '../../src/core/db/scope';
import { connectPilotDatabase } from '../lib/pilot-target';

/** The owner's limit for test emails. */
const MAX_SAMPLES = 10;

const SAMPLE_VALUES: Record<string, string> = {
  businessName: 'Hired Hands Moving Company',
  firstName: 'Sample',
  customerName: 'Sample Customer',
  jobNumber: 'J-SAMPLE',
  moveDate: '2026-12-15',
  estimateTitle: 'Local Estimate for Sample Customer',
  estimateNumber: 'E-SAMPLE',
  estimateTotal: '$585.00',
  invoiceNumber: 'I-SAMPLE',
  invoiceTotal: '$585.00',
  balanceDue: '$468.00',
  balanceDueByCard: '$486.72',
  dueDate: '2026-12-15',
  amount: '$117.00',
  paymentDate: '2026-12-01',
  paymentId: 'SAMPLE01',
  originAddress: '1 Sample St, Ithaca, NY 14850',
  link: 'https://example.com/sample-link (sample: no real estimate or invoice)',
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = (arg('--to') ?? '').trim().toLowerCase();
  const keys = (arg('--keys') ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  if (!to || keys.length === 0) throw new Error('Refusing: give --to and --keys.');
  if (new Set(keys).size !== keys.length) throw new Error('Refusing: a key is listed twice.');
  if (keys.length > MAX_SAMPLES) throw new Error(`Refusing: at most ${MAX_SAMPLES} sample emails.`);
  const allowed = (process.env.EMAIL_ALLOWED_RECIPIENTS ?? '').split(/[,;\s]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(to)) throw new Error('Refusing: the recipient is not in EMAIL_ALLOWED_RECIPIENTS.');
  if (process.env.EMAIL_PROVIDER !== 'ses' || !process.env.EMAIL_FROM) throw new Error('Refusing: EMAIL_PROVIDER=ses and EMAIL_FROM must be set.');

  await connectPilotDatabase(arg('--confirm-host'));
  const { systemContext } = await import('../../src/core/tenancy/system');
  const { renderEmail, loadTemplate } = await import('../../src/modules/hhmc/services/common');
  const { sendNotification } = await import('../../src/core/notifications/notifications');
  const { closeDb } = await import('../../src/core/db/client');
  const ctx = await systemContext('hhmc', 'live');
  try {
    await withScope(ctx, 'notifications.write', async (s) => {
      for (const key of keys) if (!(await loadTemplate(s, key))) throw new Error(`Refusing: no template "${key}" in HHMC Live.`);
      for (const key of keys) {
        const email = await renderEmail(s, key, SAMPLE_VALUES);
        const sent = await sendNotification(s, { recipient: to, subject: `[Sample] ${email.subject}`, body: email.body, subjectType: 'hhmc.sample' });
        console.log(`${key}: ${sent.status} via ${sent.adapter}`);
      }
    });
  } finally {
    await closeDb();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : '';
  console.error(message.startsWith('Refusing') ? message : `Failed: ${error instanceof Error ? error.name : 'error'}.`);
  process.exit(1);
});
