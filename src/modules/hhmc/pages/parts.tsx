/** Small display pieces shared by the HHMC pages. */
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/ui/badge';
import { cn } from '@/ui/cn';
import { inputClass } from '@/ui/layout';
import {
  ESTIMATE_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  STAGE_LABELS,
} from '../rules';
import type { EstimateStatus, InvoiceStatus, LeadStatus, Stage } from '../schema';

const STAGE_TONES: Record<Stage, BadgeTone> = {
  qualified: 'neutral',
  estimate_sent: 'blue',
  booked: 'green',
  completed: 'amber',
  closed: 'neutral',
  lost: 'red',
  cancelled: 'red',
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge tone={STAGE_TONES[stage]}>{STAGE_LABELS[stage]}</Badge>;
}

const LEAD_TONES: Record<LeadStatus, BadgeTone> = { new: 'blue', disqualified: 'red', converted: 'green' };

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <Badge tone={LEAD_TONES[status]}>{LEAD_STATUS_LABELS[status]}</Badge>;
}

const ESTIMATE_TONES: Record<EstimateStatus, BadgeTone> = { draft: 'neutral', sent: 'blue', viewed: 'amber', signed: 'green', void: 'neutral' };

export function EstimateStatusBadge({ status }: { status: EstimateStatus }) {
  return <Badge tone={ESTIMATE_TONES[status]}>{ESTIMATE_STATUS_LABELS[status]}</Badge>;
}

const INVOICE_TONES: Record<InvoiceStatus, BadgeTone> = { draft: 'neutral', sent: 'blue', partially_paid: 'amber', paid: 'green', void: 'neutral' };

export function InvoiceStatusBadge({ status, pastDue }: { status: InvoiceStatus; pastDue?: boolean }) {
  return (
    <span className="inline-flex gap-1">
      <Badge tone={INVOICE_TONES[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>
      {pastDue ? <Badge tone="red">Past due</Badge> : null}
    </span>
  );
}

/** "2026-05-14" → "May 14, 2026". Empty shows a dash. */
// One formatter each, shared by every screen (src/ui/format.ts); re-exported for the pages here.
export { formatDay, formatWeekday, formatTime } from '@/ui/format';

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={cn(inputClass, className)} {...props}>
      {children}
    </select>
  );
}

export function Check({ name, label, defaultChecked }: { name: string; label: ReactNode; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-800">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 rounded border-zinc-300" />
      {label}
    </label>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-zinc-900">{children}</dd>
    </div>
  );
}

export function Note({ tone = 'amber', title, children }: { tone?: 'amber' | 'green'; title: string; children?: ReactNode }) {
  return (
    <div
      role="note"
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900',
      )}
    >
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 space-y-1">{children}</div> : null}
    </div>
  );
}

/** The query string of a list page with one value changed (for filters and paging links). */
export function hrefWith(basePath: string, params: Record<string, string | undefined>, change: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...change })) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}
