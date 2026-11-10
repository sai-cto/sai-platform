import { cn } from './cn';

/**
 * A business's identity in the console: its short code on a tile of its accent colour.
 * (No brand logos, by design.) The colour comes from the businesses table, never from code.
 */
export function Monogram({
  code,
  color,
  size = 'md',
  className,
}: {
  code: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box =
    size === 'sm' ? 'size-6 rounded' : size === 'lg' ? 'size-10 rounded-lg' : 'size-7 rounded-md';
  const long = code.length > 3;
  const text =
    size === 'lg'
      ? long
        ? 'text-[11px]'
        : 'text-sm'
      : size === 'sm'
        ? long
          ? 'text-[7px]'
          : 'text-[9px]'
        : long
          ? 'text-[8px]'
          : 'text-[10px]';
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: color }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold tracking-tight text-white select-none',
        box,
        text,
        className,
      )}
    >
      {code}
    </span>
  );
}
