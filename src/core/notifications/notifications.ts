/**
 * The notifications interface. Business code calls sendNotification(); a channel adapter
 * delivers it. The only adapter today writes the email to the server console — nothing is
 * actually sent — and every message is stored in the notifications table.
 */
import type { notifications } from '../db/schema';
import type { Scope } from '../db/scope';
import { notificationEntity } from '../records/core-entities';
import { createRecord } from '../records/records';
import type { Row } from '../records/types';

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
      console.log(
        `\n[email — not actually sent]\n  To:      ${message.recipient}\n  Subject: ${message.subject}\n  ${message.body.replace(/\n/g, '\n  ')}\n`,
      );
    }
    return { ok: true };
  },
};

let emailChannel: NotificationChannel = consoleEmailChannel;

/** Swap the email adapter (a real provider later; a recorder in tests). */
export function setEmailChannel(channel: NotificationChannel): void {
  emailChannel = channel;
}

export async function sendNotification(
  s: Scope,
  input: OutgoingMessage & { subjectType?: string; subjectId?: string },
): Promise<Row<typeof notifications>> {
  // The sandbox never sends for real, whatever adapter is configured.
  const channel = s.ctx.environment === 'sandbox' ? consoleEmailChannel : emailChannel;
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
