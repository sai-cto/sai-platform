import { CircleAlert, CircleCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { runHealthChecks } from '@/core/health/health';
import { Card, PageHeader } from '@/ui/layout';
import { guarded, requirePlatformContext } from '../../../_lib/session';

export const metadata: Metadata = { title: 'System health' };

export default async function HealthPage() {
  const ctx = await requirePlatformContext();
  const groups = await guarded(() => runHealthChecks(ctx));
  const failing = groups.flatMap((g) => g.checks).filter((c) => !c.ok).length;
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
    </>
  );
}
