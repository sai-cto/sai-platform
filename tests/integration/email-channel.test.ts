/**
 * Real email (Amazon SES) and who may receive it. Amazon is never called: the SES client's send()
 * is replaced. Until the owner approves real customers, only EMAIL_ALLOWED_RECIPIENTS get real
 * email; everyone else's email is written to the log ("held"), in every mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { withScope } from '@/core/db/scope';
import {
  channelFor,
  consoleEmailChannel,
  emailChannelFromEnv,
  sendNotification,
  setEmailChannel,
  type NotificationChannel,
} from '@/core/notifications/notifications';
import { sesEmailChannel } from '@/core/notifications/ses';
import { P } from '@/modules/hhmc/permissions';
import { USERS, ctxFor } from './helpers';

const saved = { ...process.env };
const KEYS = ['EMAIL_ALLOWED_RECIPIENTS', 'EMAIL_PROVIDER', 'EMAIL_FROM', 'PILOT_MODE'];

afterEach(() => {
  for (const key of KEYS)
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  setEmailChannel(consoleEmailChannel);
  vi.restoreAllMocks();
});

function recorder(): NotificationChannel & { sent: string[] } {
  const sent: string[] = [];
  return { name: 'recorder', sent, async send(m) { sent.push(m.recipient); return { ok: true }; } };
}

describe('Amazon SES channel', () => {
  it('sends a plain-text email from the configured address and reports SES errors', async () => {
    const calls: Record<string, unknown>[] = [];
    vi.spyOn(SESv2Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      expect(command).toBeInstanceOf(SendEmailCommand);
      calls.push((command as { input: Record<string, unknown> }).input);
      return { MessageId: 'm-1' };
    });
    const ses = sesEmailChannel({ from: 'Hired Hands <hiredhands@example.org>' });
    expect(await ses.send({ recipient: 'a@example.com', subject: 'Hi', body: 'Line 1\nLine 2' })).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      FromEmailAddress: 'Hired Hands <hiredhands@example.org>',
      Destination: { ToAddresses: ['a@example.com'] },
      Content: { Simple: { Subject: { Data: 'Hi', Charset: 'UTF-8' }, Body: { Text: { Data: 'Line 1\nLine 2', Charset: 'UTF-8' } } } },
    });

    vi.spyOn(SESv2Client.prototype, 'send').mockRejectedValue(Object.assign(new Error('Email address is not verified.'), { name: 'MessageRejected' }));
    expect(await ses.send({ recipient: 'b@example.com', subject: 'Hi', body: 'x' })).toEqual({ ok: false, error: 'MessageRejected: Email address is not verified.' });
  });

  it('is chosen from the environment only when EMAIL_PROVIDER=ses and EMAIL_FROM are both set', () => {
    delete process.env.EMAIL_PROVIDER;
    expect(emailChannelFromEnv().name).toBe('console-email');
    process.env.EMAIL_PROVIDER = 'ses';
    delete process.env.EMAIL_FROM;
    expect(emailChannelFromEnv().name).toBe('console-email');
    process.env.EMAIL_FROM = 'hiredhands@example.org';
    expect(emailChannelFromEnv().name).toBe('ses');
  });
});

describe('who gets real email', () => {
  it('only allow-listed recipients, in every mode; everyone else is held in the log', async () => {
    const real = recorder();
    setEmailChannel(real);
    process.env.EMAIL_ALLOWED_RECIPIENTS = 'Tester@Example.com, other@example.com';
    process.env.PILOT_MODE = 'true';
    const live = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    const test = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'sandbox');
    await withScope(live, P.jobsWrite, async (s) => {
      expect(channelFor(s, 'tester@example.com').name).toBe('recorder');
      expect(channelFor(s, 'customer@example.com').name).toBe('console-email');
    });
    await withScope(test, P.jobsWrite, async (s) => {
      expect(channelFor(s, 'tester@example.com').name).toBe('recorder');
      expect(channelFor(s, 'customer@example.com').name).toBe('console-email');
    });
    // Out of pilot mode the allow-list still holds while it is set.
    delete process.env.PILOT_MODE;
    await withScope(live, P.jobsWrite, async (s) => {
      expect(channelFor(s, 'customer@example.com').name).toBe('console-email');
      const held = await sendNotification(s, { recipient: 'customer@example.com', subject: 'S', body: 'B' });
      expect(held.adapter).toBe('console-email');
      const sent = await sendNotification(s, { recipient: 'TESTER@example.com', subject: 'S', body: 'B' });
      expect(sent.adapter).toBe('recorder');
    });
    expect(real.sent).toEqual(['TESTER@example.com']);
  });

  it('with no allow-list: Live outside pilot mode sends for real; Test mode and the pilot never do', async () => {
    const real = recorder();
    setEmailChannel(real);
    delete process.env.EMAIL_ALLOWED_RECIPIENTS;
    delete process.env.PILOT_MODE;
    const live = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    const test = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'sandbox');
    await withScope(live, P.jobsWrite, async (s) => expect(channelFor(s, 'customer@example.com').name).toBe('recorder'));
    await withScope(test, P.jobsWrite, async (s) => expect(channelFor(s, 'customer@example.com').name).toBe('console-email'));
    process.env.PILOT_MODE = 'true';
    await withScope(live, P.jobsWrite, async (s) => expect(channelFor(s, 'customer@example.com').name).toBe('console-email'));
  });
});
