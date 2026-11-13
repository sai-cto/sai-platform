/**
 * "Send feedback" from any app page: the message, the page it came from and who sent it, kept per
 * business and mode. Read by the tech team and super admins (Platform › Feedback).
 */
import { and, desc, eq } from 'drizzle-orm';
import { businesses, feedback } from '../db/schema';
import { withPlatformScope, withScope } from '../db/scope';
import { NotFoundError, ValidationError } from '../errors';
import { isUuid } from '../ids';
import { feedbackEntity } from '../records/core-entities';
import { createRecord, updateRecord } from '../records/records';
import type { BusinessContext, PlatformContext } from '../tenancy/context';

export const FEEDBACK_MAX = 4000;

export async function sendFeedback(ctx: BusinessContext, input: { message: string; pageUrl: string }) {
  const message = (input.message ?? '').trim();
  if (!message) throw new ValidationError('Write what you noticed or would like changed.');
  if (message.length > FEEDBACK_MAX) throw new ValidationError(`Keep it under ${FEEDBACK_MAX} characters (or send two).`);
  if (message.includes('\u0000')) throw new ValidationError('The message contains characters that cannot be stored.');
  // Only the path and query of a page in this app: never another site's address.
  let pageUrl = '';
  try {
    const url = new URL(input.pageUrl ?? '', 'http://app.local');
    // Only the path of a console page is kept (never a host). A path starting "//" would link to another site.
    const inApp = /^\/console(\/|$)/.test(url.pathname) && !url.pathname.startsWith('//');
    pageUrl = inApp ? `${url.pathname}${url.search}`.slice(0, 500) : '';
  } catch {
    pageUrl = '';
  }
  return withScope(ctx, 'business.feedback.send', (s) =>
    createRecord(s, feedbackEntity, {
      message,
      pageUrl,
      authorName: ctx.actor.name,
      authorEmail: ctx.actor.email || null,
      status: 'new',
    }),
  );
}

export type FeedbackRow = typeof feedback.$inferSelect & { businessName: string };

/** Every business's feedback, newest first (both modes). */
export async function listFeedback(ctx: PlatformContext, options: { status?: 'new' | 'read' | 'done' | 'all'; limit?: number } = {}): Promise<FeedbackRow[]> {
  return withPlatformScope(ctx, 'platform.feedback.read', async (s) => {
    const status = options.status ?? 'all';
    const rows = await s.db
      .select({ f: feedback, businessName: businesses.name })
      .from(feedback)
      .innerJoin(businesses, eq(businesses.id, feedback.businessId))
      .where(status === 'all' ? undefined : eq(feedback.status, status))
      .orderBy(desc(feedback.createdAt))
      .limit(Math.min(options.limit ?? 200, 1000));
    return rows.map((r) => ({ ...r.f, businessName: r.businessName }));
  });
}

/** Marks a message read or done (in its own business's scope, so the change is logged there). */
export async function setFeedbackStatus(ctx: BusinessContext, id: string, status: 'new' | 'read' | 'done') {
  if (!isUuid(id) || !['new', 'read', 'done'].includes(status)) throw new NotFoundError();
  return withScope(ctx, 'business.feedback.read', async (s) => {
    const [row] = await s.db.select({ id: feedback.id }).from(feedback).where(and(s.where(feedback), eq(feedback.id, id))).limit(1);
    if (!row) throw new NotFoundError();
    return updateRecord(s, feedbackEntity, id, { status });
  });
}
