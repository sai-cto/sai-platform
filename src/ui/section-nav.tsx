/**
 * The two kinds of in-page navigation of an app: its sections (Dashboard, Leads, …) as a pill
 * bar, and the areas of one section (Settings › Line items, …) as underlined tabs. Shared by
 * module pages and by the console pages an app shows as its own (ModuleManifest.adminInApp).
 */
import Link from 'next/link';
import { cn } from './cn';
import { SearchButton } from './search-button';

export type SectionLink = { label: string; href: string; active: boolean };

export function AppSectionsNav({ links }: { links: SectionLink[] }) {
  if (links.length < 2) return null;
  return (
    <nav aria-label="App sections" className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-1 print:hidden">
      {links.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'flex min-h-11 shrink-0 items-center rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap text-zinc-600 hover:text-zinc-900 sm:min-h-0',
            item.active && 'bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200',
          )}
        >
          {item.label}
        </Link>
      ))}
      {/* The one search box: same as Ctrl/Cmd-K, on every page of the app. */}
      {/* On a phone the top bar's search button does this; here it would sit off-screen. */}
      <span className="ml-auto hidden sm:block" />
      <span className="hidden sm:contents">
        <SearchButton />
      </span>
    </nav>
  );
}

export function SectionAreasNav({ label, links }: { label: string; links: SectionLink[] }) {
  return (
    <nav aria-label={label} className="mb-5 flex flex-wrap gap-1 border-b border-zinc-200">
      {links.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          aria-current={a.active ? 'page' : undefined}
          className={`-mb-px flex min-h-11 items-center border-b-2 px-3 py-2 text-sm sm:min-h-0 ${a.active ? 'border-zinc-900 font-medium text-zinc-900' : 'border-transparent text-zinc-600 hover:text-zinc-900'}`}
        >
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
