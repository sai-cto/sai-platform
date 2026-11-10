import type { ReactNode } from 'react';
import { cn } from './cn';

/** The title row at the top of a page. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description ? (
          <p className="mt-0.5 max-w-2xl text-sm text-zinc-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A bordered white panel, optionally with a title bar. */
export function Card({
  title,
  description,
  actions,
  children,
  className,
  flush,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={cn('min-w-0 rounded-lg border border-zinc-200 bg-white', className)}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-zinc-500">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

/** One key number. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900 tabular-nums">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-zinc-900">{title}</p>
      {children ? (
        <div className="mx-auto mt-1 max-w-md text-sm text-zinc-500">{children}</div>
      ) : null}
    </div>
  );
}

/** A table that scrolls sideways on small screens instead of breaking the page. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-left text-sm', className)}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium whitespace-nowrap text-zinc-500',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn('border-b border-zinc-100 px-3 py-2 align-middle text-zinc-800', className)}>
      {children}
    </td>
  );
}

/** Label + control + optional help text, stacked. */
export function Field({
  label,
  htmlFor,
  help,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-zinc-700">
        {label}
      </label>
      {children}
      {help ? <p className="mt-1 text-xs text-zinc-500">{help}</p> : null}
    </div>
  );
}

export const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:border-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-500';
