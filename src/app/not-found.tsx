import Link from 'next/link';
import { buttonClass } from '@/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium text-zinc-500">404</p>
      <h1 className="mt-1 text-lg font-semibold text-zinc-900">Page not found</h1>
      <p className="mt-1 max-w-sm text-sm text-zinc-600">
        It does not exist, or you do not have access to it.
      </p>
      <Link href="/console" className={buttonClass({ className: 'mt-4' })}>
        Back to the console
      </Link>
    </div>
  );
}
