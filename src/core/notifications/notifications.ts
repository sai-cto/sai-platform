/**
 * The notifications interface. Business code calls sendNotification(); a channel adapter
 * delivers it and every message is stored in the notifications table. Adapters: the console
 * (nothing is sent: the email is "held" in the log) and Amazon SES (ses.ts), chosen from the
 * environment (EMAIL_PROVIDER=ses + EMAIL_FROM).
 *
 * Who gets real email (channelFor):
 * - EMAIL_ALLOWED_RECIPIENTS set: ONLY those addresses, in every mode (Live, Test, pilot). This is
 *   how the hosted site is tested before the owner approves emailing customers.
 * - Not set: Live sends for real; Test mode (sandbox), the demo and the pilot never do.
 */
import type { notifications } from '../db/schema';
import type { Scope } from '../db/scope';
import { isDemoMode } from '../demo/demo';
import { isPilotMode } from '../demo/pilot';
import { authorize } from '../rbac/permissions';
import { notificationEntity } from '../records/core-entities';
import { createRecord } from '../records/records';
import type { Row } from '../records/types';
import { sesEmailChannel } from './ses';

export type OutgoingMessage = { recipient: string; subject: string; body: string };

export interface NotificationChannel {
  name: string;
  send(message: OutgoingMessage): Promise<{ ok: true } | { ok: false; error: string }>;
}

/** Development adapter: prints the email instead of sending it. */
export const consoleEmailChannel: NotificationChannel = {
  name: 'console-email',
  async send(message) {
    if (process.env.NODE_ENV !== 'test') {
      // Nothing from the message: recipient, subject and body can all hold real customer data
      // (local real-data import, pilot mode). EMAIL_CONSOLE_FULL=true prints it, for fake data.
      console.log(
        process.env.EMAIL_CONSOLE_FULL === 'true'
          ? `\n[email — not actually sent]\n  To:      ${message.recipient}\n  Subject: ${message.subject}\n  ${message.body.replace(/\n/g, '\n  ')}\n`
          : '[email — not actually sent]',
      );
    }
    return { ok: true };
  },
};

/** The real adapter the environment asks for, or the console when none is configured. */
export function emailChannelFromEnv(): NotificationChannel {
  const from = process.env.EMAIL_FROM?.trim();
  if (process.env.EMAIL_PROVIDER === 'ses' && from) {
    return sesEmailChannel({ from, configurationSet: process.env.EMAIL_CONFIGURATION_SET?.trim() || undefined });
  }
  return consoleEmailChannel;
}

let emailChannel: NotificationChannel = emailChannelFromEnv();

/** Swap the email adapter (a real provider later; a recorder in tests). */
export function setEmailChannel(channel: NotificationChannel): void {
  emailChannel = channel;
}

function allowedRecipients(): Set<string> | null {
  const list = (process.env.EMAIL_ALLOWED_RECIPIENTS ?? '')
    .split(/[,;\s]+/)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}

/** The adapter this email goes through: the real one, or the console (held in the log). */
export function channelFor(s: Scope, recipient: string): NotificationChannel {
  const allowed = allowedRecipients();
  if (allowed) return allowed.has(recipient.trim().toLowerCase()) ? emailChannel : consoleEmailChannel;
  // The sandbox and the hosted demo site never send for real, whatever adapter is configured.
  // The pilot (real data, not yet live) never emails customers either: P5-31.
  return s.ctx.environment === 'sandbox' || isDemoMode() || isPilotMode() ? consoleEmailChannel : emailChannel;
}

export async function sendNotification(
  s: Scope,
  input: OutgoingMessage & { subjectType?: string; subjectId?: string },
): Promise<Row<typeof notifications>> {
  // Permission first: nobody without notifications.write can make the platform send anything.
  authorize(s.ctx, 'notifications.write');
  const channel = channelFor(s, input.recipient);
  const result = await channel.send({
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
  });
  return createRecord(s, notificationEntity, {
    channel: 'email',
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    status: result.ok ? 'sent' : 'failed',
    adapter: channel.name,
    error: result.ok ? null : result.error,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
  });
}
