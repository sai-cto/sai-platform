import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export const buttonClass = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-zinc-900 text-white hover:bg-zinc-700',
        secondary: 'border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50',
        ghost: 'text-zinc-700 hover:bg-zinc-100',
        danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
        dangerSolid: 'bg-red-600 text-white hover:bg-red-700',
      },
      // On a phone every button is a 44px tap target; from the sm breakpoint up, the compact sizes.
      size: { sm: 'h-11 px-3 text-sm sm:h-7 sm:px-2.5 sm:text-xs', md: 'h-11 px-3 text-sm sm:h-8' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonClass>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonClass({ variant, size }), className)} {...props} />
  );
}
