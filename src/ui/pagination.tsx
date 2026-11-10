import Link from 'next/link';
import { buttonClass } from './button';
import { formatNumber } from './format';

/** "1–50 of 312" with previous/next links. `hrefFor(page)` builds the link for a page number. */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const hasPrevious = page > 1;
  const hasNext = last < total;
  return (
    <nav
      aria-label="Pages"
      className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-zinc-500"
    >
      <span className="tabular-nums">
        {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
      </span>
      <span className="flex gap-2">
        {hasPrevious ? (
          <Link className={buttonClass({ size: 'sm' })} href={hrefFor(page - 1)}>
            Previous
          </Link>
        ) : null}
        {hasNext ? (
          <Link className={buttonClass({ size: 'sm' })} href={hrefFor(page + 1)}>
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
