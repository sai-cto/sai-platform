/**
 * "Send feedback" (saved with page, person and time; only the tech team and super admins read
 * it) and the server error log (scrubbed of data; read by the same people). Unexpected action
 * errors become a plain message and are logged.
 */
import { describe, expect, it } from 'vitest';
import { listFeedback, sendFeedback, setFeedbackStatus } from '@/core/feedback/feedback';
import { listServerErrors, logServerError, scrubError } from '@/core/health/errors';
import { ForbiddenError } from '@/core/errors';
import { act } from '@/server/actions';
import { ctxFor, platformCtxFor, USERS } from './helpers';

describe('feedback', () => {
  it('a manager sends feedback with the page; the tech team reads it and marks it done', async () => {
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    const stamp = `Calendar is confusing ${Date.now()}`;
    const row = await sendFeedback(gm, { message: `  ${stamp}  `, pageUrl: 'http://localhost:3000/console/hhmc/live/app/schedule?view=month' });
    expect(row).toMatchObject({ message: stamp, pageUrl: '/console/hhmc/live/app/schedule?view=month', authorName: gm.actor.name, status: 'new' });
    expect(row.createdBy).toBe(gm.actor.id);

    const tech = await platformCtxFor(USERS.tech);
    const listed = await listFeedback(tech, { status: 'new' });
    expect(listed.find((f) => f.id === row.id)).toMatchObject({ businessName: gm.business.name, environment: 'live' });

    const techInHhmc = await ctxFor(USERS.tech, 'hhmc', 'live');
    await setFeedbackStatus(techInHhmc, row.id, 'done');
    expect((await listFeedback(tech, { status: 'done' })).some((f) => f.id === row.id)).toBe(true);
  });

  it('an empty message is refused; another site\'s address is not kept', async () => {
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'sandbox');
    await expect(sendFeedback(gm, { message: '   ', pageUrl: '/x' })).rejects.toThrow(/Write what you noticed/);
    const row = await sendFeedback(gm, { message: 'Test-mode note', pageUrl: 'javascript:alert(1)' });
    expect(row.pageUrl).toBe('');
    expect(row.environment).toBe('sandbox');
  });

  it('managers cannot read feedback or the error log', async () => {
    const manager = await platformCtxFor(USERS.hhmcAdmin);
    await expect(listFeedback(manager)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listServerErrors(manager)).rejects.toBeInstanceOf(ForbiddenError);
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    await expect(setFeedbackStatus(gm, '00000000-0000-0000-0000-000000000000', 'done')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('server errors', () => {
  it('are recorded without query parameters (they can hold customer data)', async () => {
    const err = new Error('Failed query: select * from customers where email = $1\nparams: jane@example.com');
    expect(scrubError(err).message).toBe('Failed query: select * from customers where email = $1\nparams: [hidden]');
    const marker = `Boom ${Date.now()}`;
    await logServerError(new Error(marker), { source: 'render', path: '/console/hhmc/live/app' });
    const tech = await platformCtxFor(USERS.tech);
    expect((await listServerErrors(tech)).some((e) => e.message === marker && e.path === '/console/hhmc/live/app')).toBe(true);
  });

  it('an unexpected failure in an action is a plain message, and logged', async () => {
    const marker = `Unexpected ${Date.now()}`;
    const result = await act(async () => {
      throw new Error(marker);
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Something went wrong on our side/);
    const tech = await platformCtxFor(USERS.tech);
    expect((await listServerErrors(tech)).some((e) => e.message === marker && e.source === 'action')).toBe(true);
  });
});
