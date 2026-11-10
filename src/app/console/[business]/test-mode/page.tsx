import { FlaskConical } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { sandboxSummary } from '@/core/sandbox/sandbox';
import { buttonClass } from '@/ui/button';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDateTime, formatNumber } from '@/ui/format';
import { Card, PageHeader, Table, Td, Th } from '@/ui/layout';
import { guarded, requireBusinessContext } from '@/server/session';
import { resetSandboxAction } from './actions';

export const metadata: Metadata = { title: 'Test mode' };

export default async function TestModePage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const ctx = await requireBusinessContext(business);
  const summary = await guarded(() => sandboxSummary(ctx));
  const canReset = ctx.permissions.has('business.sandbox.reset');
  const sandboxHome = ctx.permissions.has('business.app.use') ? 'app' : 'overview';

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 lg:px-6">
      <PageHeader
        title="Test mode"
        description={`A safe copy of ${ctx.business.name} filled with fake data. Try anything here: nothing touches the real business, no real payment is taken and no email is sent.`}
        actions={
          <Link
            href={`/console/${ctx.business.slug}/sandbox/${sandboxHome}`}
            className={buttonClass({ variant: 'primary' })}
          >
            <FlaskConical className="size-4" aria-hidden="true" /> Open test mode
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="How it works" className="lg:col-span-2">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-700">
            <li>
              Use the <strong>Live / Test mode</strong> switch at the top of the page to move
              between real data and the sandbox.
            </li>
            <li>
              In test mode a striped yellow banner and a yellow frame stay on screen the whole time,
              so you always know where you are.
            </li>
            <li>
              The address bar shows it too: test-mode pages have{' '}
              <span className="font-mono text-xs">/sandbox/</span> in the address.
            </li>
            <li>Sandbox data is invented. Real customer data is never copied into it.</li>
            <li>
              Resetting throws away everything in the sandbox and fills it with fresh fake data.
              Live data is not affected.
            </li>
          </ul>
        </Card>
        <Card title="Reset">
          <p className="text-sm text-zinc-600">
            {summary.lastResetAt ? (
              <>
                Last reset {formatDateTime(summary.lastResetAt)} by {summary.lastResetBy}.
              </>
            ) : (
              'Never reset since it was first set up.'
            )}
          </p>
          {canReset ? (
            <div className="mt-3">
              <ConfirmButton
                action={resetSandboxAction.bind(null, ctx.business.slug)}
                size="md"
                variant="danger"
                confirmTitle="Reset the sandbox?"
                confirmBody={`Everything in the ${ctx.business.name} sandbox is replaced with fresh fake data. Live data is not touched.`}
                confirmLabel="Reset sandbox"
              >
                Reset sandbox
              </ConfirmButton>
            </div>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">
              A business admin or the tech team can reset it.
            </p>
          )}
        </Card>
      </div>

      <Card title="What is in the sandbox now" flush>
        <Table>
          <thead>
            <tr>
              <Th className="w-full">Records</Th>
              <Th className="text-right">Rows</Th>
            </tr>
          </thead>
          <tbody>
            {summary.counts.map((c) => (
              <tr key={c.entityKey}>
                <Td>{c.label}</Td>
                <Td className="text-right tabular-nums">{formatNumber(c.rows)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
