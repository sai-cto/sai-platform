/**
 * Email through Amazon SES (docs/aws.md). Used when EMAIL_PROVIDER=ses and EMAIL_FROM are set.
 * Credentials come from the console's AWS role; nothing is configured here. Plain text only:
 * every template is plain text.
 */
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { NotificationChannel } from './notifications';

let client: SESv2Client | null = null;

export function sesEmailChannel(options: { from: string; configurationSet?: string }): NotificationChannel {
  return {
    name: 'ses',
    async send(message) {
      client ??= new SESv2Client({});
      try {
        await client.send(
          new SendEmailCommand({
            FromEmailAddress: options.from,
            Destination: { ToAddresses: [message.recipient] },
            Content: {
              Simple: {
                Subject: { Data: message.subject, Charset: 'UTF-8' },
                Body: { Text: { Data: message.body, Charset: 'UTF-8' } },
              },
            },
            ...(options.configurationSet ? { ConfigurationSetName: options.configurationSet } : {}),
          }),
        );
        return { ok: true };
      } catch (error) {
        const e = error as { name?: string; message?: string };
        // The error names the problem (unverified address, throttling…), never the message itself.
        return { ok: false, error: `${e.name ?? 'Error'}: ${e.message ?? 'could not send'}` };
      }
    },
  };
}
