/**
 * "How to test": the page HHMC's managers read before trying the app. What to try, how to stay
 * in test mode, and how to send feedback. Plain words, no setup needed.
 */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { Card, PageHeader } from '@/ui/layout';

export function HowToTestPage({ ctx, basePath }: PortalPageProps) {
  const sandbox = `/console/${ctx.business.slug}/sandbox/app`;
  const steps: { title: string; detail: string; href: string }[] = [
    { title: 'Add a lead', detail: 'Leads › Add lead. Use any made-up name and an email or phone.', href: `${basePath}/leads/new` },
    { title: 'Turn it into a work request', detail: 'On the lead, press Convert to job. It keeps the contact if one already exists.', href: `${basePath}/leads` },
    { title: 'Build and send the estimate', detail: 'On the work request, add line items (or use the estimate builder), then Send estimate.', href: `${basePath}/jobs` },
    { title: 'Sign it as the customer', detail: 'Copy link on the estimate, open it in a private window, sign, and pay the deposit with the test card.', href: `${basePath}/estimates` },
    { title: 'Record a deposit by hand', detail: 'Or, on a signed estimate, Record deposit: cash, check, card (Shopify) or other.', href: `${basePath}/jobs` },
    { title: 'Book it and find it on the calendar', detail: 'Book this move, then open the Calendar. Try Reschedule on a booked move.', href: `${basePath}/schedule` },
    { title: 'Invoice and get paid', detail: 'After the move: actual hours, Create invoice, Send, then Record payment until it shows Paid and the move is Closed.', href: `${basePath}/invoices` },
    { title: 'Cancel a move', detail: 'Cancel job on a booked move: give a reason and say what happens to the deposit.', href: `${basePath}/jobs` },
    { title: 'Search and print', detail: 'Search (top of every page, or Ctrl/⌘ K) by name, phone, email or number. Print / PDF on an estimate or invoice.', href: basePath },
    { title: 'Check the numbers', detail: 'The Dashboard: every number opens the list behind it. Compare a few with what you know.', href: basePath },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="How to test" description="Try everything you do in Movegistics today, in test mode, and tell us what is confusing, wrong or missing." />

      <Card title="1. Switch to test mode first">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-700">
          <li>
            Use the <strong>Live / Test mode</strong> switch at the top right. In test mode a striped yellow banner stays on screen, and the address
            has <span className="font-mono text-xs">/sandbox/</span> in it.
          </li>
          <li>Test mode is filled with made-up customers and moves at every stage. Nothing there touches real customers, no email is sent and no card is charged.</li>
          <li>
            <strong>Live</strong> is HHMC&apos;s real data from Movegistics. Look around, but please practise in test mode.
          </li>
        </ul>
        {ctx.environment === 'live' && ctx.permissions.has('business.sandbox.use') ? (
          <Link href={`${sandbox}/how-to-test`} className="mt-3 inline-flex min-h-11 items-center rounded-md bg-amber-300 px-4 text-sm font-medium text-amber-950 hover:bg-amber-400">
            Open test mode
          </Link>
        ) : null}
      </Card>

      <Card title="2. What to try" flush>
        <ol className="divide-y divide-zinc-100">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Link href={s.href} className="flex min-h-11 gap-3 px-4 py-3 hover:bg-zinc-50">
                <span className="w-6 shrink-0 text-sm font-semibold text-zinc-400 tabular-nums">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-zinc-900">{s.title}</span>
                  <span className="block text-sm text-zinc-600">{s.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="3. Tell us what you think">
        <p className="text-sm text-zinc-700">
          Press <strong>Send feedback</strong> (bottom right of every page). Say what you were doing and what you expected; the page you are on is sent with it.
          Small things count: a word that is wrong, a number that looks off, a button that is hard to find. Fonts, colours and layout are open to change too.
        </p>
      </Card>
    </div>
  );
}
