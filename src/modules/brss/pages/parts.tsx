/** Small display pieces shared by the BRSS pages. */
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/ui/badge';
import { cn } from '@/ui/cn';
import { inputClass } from '@/ui/layout';
import {
  APPOINTMENT_STATUSES,
  ARTICLE_STATUSES,
  ORDER_SERVICES,
  ORDER_STATUSES,
  labelOf,
  type AppointmentStatus,
} from '../rules';
import type { ArticleStatus, OrderService, OrderStatus } from '../schema';

const ORDER_TONES: Record<OrderStatus, BadgeTone> = {
  open: 'blue',
  activated: 'green',
  closed: 'neutral',
  cancelled: 'red',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_TONES[status]}>{labelOf(ORDER_STATUSES, status)}</Badge>;
}

export function ArticleStatusBadge({ status }: { status: ArticleStatus | null }) {
  if (!status) return <Badge>No status yet</Badge>;
  const done = status === 'delivered' || status === 'shipped';
  const stored = status === 'stored' || status === 'in_warehouse';
  return (
    <Badge tone={done ? 'neutral' : stored ? 'green' : 'blue'}>
      {labelOf(ARTICLE_STATUSES, status)}
    </Badge>
  );
}

const APPOINTMENT_TONES: Record<AppointmentStatus, BadgeTone> = {
  unconfirmed: 'amber',
  confirmed: 'green',
  in_progress: 'blue',
  completed: 'neutral',
  canceled: 'red',
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return <Badge tone={APPOINTMENT_TONES[status]}>{labelOf(APPOINTMENT_STATUSES, status)}</Badge>;
}

/** Shows a calendar date ("2026-05-14") as "May 14, 2026". Empty shows a dash. */
export function formatDay(date: string | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** The same, with the weekday: "Thu, May 14". */
export function formatWeekday(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function ServiceList({ services }: { services: OrderService[] }) {
  return <>{services.map((service) => labelOf(ORDER_SERVICES, service)).join(', ')}</>;
}

export const CAMPUS_LABELS: Record<string, string> = {
  on_campus: 'On campus',
  off_campus: 'Off campus',
  counter: 'Counter',
};

/** A <select> styled like the other inputs. */
export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={cn(inputClass, className)} {...props}>
      {children}
    </select>
  );
}

/** A tick box with its label beside it. */
export function Check({
  name,
  label,
  value,
  defaultChecked,
}: {
  name: string;
  label: ReactNode;
  value?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-800">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="size-4 rounded border-zinc-300"
      />
      {label}
    </label>
  );
}

/** A label and its value, for read-only facts. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-zinc-900">{children}</dd>
    </div>
  );
}

/** A fold-out section ("Change details ▸") that needs no JavaScript. */
export function Disclosure({
  summary,
  children,
  open,
}: {
  summary: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="group border-t border-zinc-200">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-zinc-700 select-none hover:text-zinc-900 [&::-webkit-details-marker]:hidden">
        <span className="mr-1.5 inline-block text-zinc-400 transition-transform group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

/** An amber box for things staff must not miss. */
export function Warning({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      role="note"
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <p className="font-medium">{title}</p>
      <div className="mt-1 space-y-1">{children}</div>
    </div>
  );
}
