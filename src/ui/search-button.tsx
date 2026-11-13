'use client';

import { Search } from 'lucide-react';
import { SearchShortcut } from './shortcut-key';

/** Opens the console's search box (the same one as Ctrl/Cmd-K). */
export function SearchButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('sai:open-search'))}
      className="flex min-h-11 sm:min-h-9 shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap text-zinc-600 hover:bg-white hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-zinc-900"
    >
      <Search className="size-3.5" aria-hidden="true" />
      Search
      <kbd className="hidden rounded border border-zinc-200 bg-white px-1 font-sans text-[10px] text-zinc-500 sm:inline"><SearchShortcut /></kbd>
    </button>
  );
}
