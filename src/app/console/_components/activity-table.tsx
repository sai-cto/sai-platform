import type { ActivityRow } from '@/core/audit/read';
import { Badge, type BadgeTone } from '@/ui/badge';
import { formatDateTime } from '@/ui/format';
import { EmptyState, Table, Td, Th } from '@/ui/layout';

const ACTION_TONE: Record<string, BadgeTone> = {
  create: 'green',
  update: 'blue',
  archive: 'amber',
  restore: 'green',
  purge: 'red',
  permission_change: 'amber',
  settings_change: 'amber',
  login_failed: 'red',
  sandbox_reset: 'amber',
};

export const ACTIVITY_ACTIONS = ['create', 'update', 'archive', 'restore', 'purge', 'permission_change', 'settings_change', 'login', 'login_failed', 'logout', 'export', 'import', 'sandbox_reset'];

export const actionLabel = (action: string) => action.replace(/_/g, ' ');

function Changes({ before, after }: { before: unknown; after: unknown }) {
  if (!before && !after) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900">Before / after</summary>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        <pre className="max-h-48 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-700">{before ? JSON.stringify(before, null, 2) : '—'}</pre>
        <pre className="max-h-48 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-700">{after ? JSON.stringify(after, null, 2) : '—'}</pre>
      </div>
    </details>
  );
}

/** The activity log as a table. `businessLabel` adds a Business column (platform view). */
export function ActivityTable({ rows, businessLabel, compact }: { rows: ActivityRow[]; businessLabel?: (businessId: string | null) => string; compact?: boolean }) {
  if (rows.length === 0) return <EmptyState title="Nothing logged yet">Activity appears here as soon as someone makes a change.</EmptyState>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Who</Th>
          {businessLabel ? <Th>Business</Th> : null}
          <Th>Action</Th>
          <Th className="w-full">What</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="align-top">
            <Td className="text-xs whitespace-nowrap text-zinc-500">{formatDateTime(row.occurredAt)}</Td>
            <Td className="whitespace-nowrap">
              <div className="text-[13px]">{row.actorName}</div>
              <div className="text-[11px] text-zinc-500">{row.actorRole.replace(/_/g, ' ')}</div>
            </Td>
            {businessLabel ? <Td className="text-xs whitespace-nowrap">{businessLabel(row.businessId)}{row.environment === 'sandbox' ? <Badge tone="amber" className="ml-1">test</Badge> : null}</Td> : null}
            <Td><Badge tone={ACTION_TONE[row.action] ?? 'neutral'}>{actionLabel(row.action)}</Badge></Td>
            <Td>
              <div className="text-[13px]">{row.summary}</div>
              {compact ? null : <Changes before={row.before} after={row.after} />}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
