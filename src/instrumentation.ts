/**
 * Next.js instrumentation: every server error a page, route handler or server action throws is
 * recorded for the tech team (System health › Errors). The person sees the plain error page.
 */
import type { Instrumentation } from 'next';

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { logServerError } = await import('./core/health/errors');
  // The path without its query string: a query can hold what someone searched for.
  await logServerError(error, { source: context.routeType, path: request.path.split('?')[0] });
};
