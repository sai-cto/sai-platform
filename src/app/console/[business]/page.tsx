import { redirect } from 'next/navigation';
import { requireBusinessContext } from '../../_lib/session';
import { businessTabs, tabHref } from '../_lib/nav';

/** /console/<business> → the first tab this person can open, in live mode. */
export default async function BusinessIndex({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const ctx = await requireBusinessContext(business, 'live');
  const [first] = businessTabs(ctx);
  redirect(first ? tabHref(ctx.business.slug, 'live', first) : '/console');
}
