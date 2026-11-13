import { CircleAlert, CircleCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { listServerErrors } from '@/core/health/errors';
import { runHealthChecks } from '@/core/health/health';
import { formatDateTime } from '@/ui/format';
import { Card, PageHeader } from '@/ui/layout';
import { guarded, requirePlatformContext } from '@/server/session';

export const metadata: Metadata = { title: 'System health' };

export default async function HealthPage() {
  const ctx = await requirePlatformContext();
  const groups = await guarded(() => runHealthChecks(ctx));
  const failing = groups.flatMap((g) => g.checks).filter((c) => !c.ok).length;
  const errors = await guarded(() => listServerErrors(ctx, 100));
  return (
    <>
      <PageHeader
        title="System health"
        description={
          failing === 0
            ? 'Everything checked is working.'
            : `${failing} check${failing === 1 ? ' needs' : 's need'} attention.`
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {groups.map((group) => (
          <Card key={group.title} title={group.title} flush>
            <ul className="divide-y divide-zinc-100">
              {group.checks.map((check) => (
                <li key={check.name} className="flex items-start gap-3 px-4 py-2.5">
                  {check.ok ? (
                    <CircleCheck
                      className="mt-0.5 size-4 shrink-0 text-emerald-600"
                      aria-hidden="true"
                    />
                  ) : (
                    <CircleAlert
                      className="mt-0.5 size-4 shrink-0 text-red-600"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900">
                      {check.name}{' '}
                      <span className="sr-only">{check.ok ? '(OK)' : '(problem)'}</span>
                    </div>
                    <div className="text-xs text-zinc-500">{check.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <Card
        title="Server errors"
        description="Unexpected errors on the server, newest first (the last 100). People who hit one saw a plain message; nothing here was shown to them."
        className="mt-5"
        flush
      >
        {errors.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">No server errors recorded.</p>
        ) : (
          <ul data-testid="server-errors" className="divide-y divide-zinc-100">
            {errors.map((e) => (
              <li key={e.id} className="px-4 py-2.5">
                <div className="text-sm font-medium break-words text-zinc-900">{e.message}</div>
                <div className="text-xs text-zinc-500">
                  {[formatDateTime(e.occurredAt), e.source, e.path, e.digest ? `ref ${e.digest}` : null].filter(Boolean).join(' · ')}
                </div>
                {e.stack ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-zinc-500">Stack</summary>
                    <pre className="mt-1 overflow-x-auto text-[11px] whitespace-pre-wrap text-zinc-600">{e.stack}</pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
