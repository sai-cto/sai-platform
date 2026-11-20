'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from './cn';
import { inputClass } from './layout';

type Suggestion = { id: string; text: string };

/** Suggestions start after this many characters (same as the server: core/places/places.ts). */
const MIN_QUERY = 4;
const DEBOUNCE_MS = 250;
const ENDPOINT = '/api/public/address';

const newSession = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`;

/**
 * An address box that suggests real addresses as you type (Google, through /api/public/address).
 * Click one, or pick it with the arrow keys and Enter, and the full address with its ZIP is filled
 * in. Typing your own address always works too: suggestions only help.
 */
export function AddressInput({ id, name, defaultValue, className }: { id: string; name: string; defaultValue?: string; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const session = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const listId = useId();

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const close = () => {
    setItems([]);
    setActive(-1);
  };

  async function lookUp(query: string) {
    const ticket = ++latest.current;
    session.current ||= newSession();
    const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&s=${session.current}`;
    const body = (await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { suggestions?: Suggestion[] } | null;
    if (ticket !== latest.current) return; // a newer keystroke already asked
    setItems(body?.suggestions ?? []);
    setActive(-1);
  }

  function onInput(value: string) {
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < MIN_QUERY) {
      latest.current++;
      close();
      return;
    }
    timer.current = setTimeout(() => void lookUp(value), DEBOUNCE_MS);
  }

  async function pick(item: Suggestion) {
    latest.current++;
    close();
    const el = input.current;
    if (!el) return;
    el.value = item.text; // shown straight away; replaced by the full address with its ZIP
    const url = `${ENDPOINT}?id=${encodeURIComponent(item.id)}&s=${session.current}`;
    session.current = ''; // the next address is a new session
    const body = (await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { address?: { full?: string } | null } | null;
    if (body?.address?.full) el.value = body.address.full;
    el.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (items.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + items.length) % items.length);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault(); // pick, don't submit the form
      void pick(items[active]);
    } else if (event.key === 'Escape') {
      close();
    }
  }

  const open = items.length > 0;
  return (
    <div className="relative">
      <input
        ref={input}
        id={id}
        name={name}
        defaultValue={defaultValue}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(close, 150)}
        className={cn(inputClass, className)}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Suggested addresses"
        hidden={!open}
        className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg"
      >
        {items.map((item, i) => (
          <li
            key={item.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()} // keep focus in the box
            onClick={() => void pick(item)}
            className={cn('cursor-pointer px-2.5 py-2 text-zinc-800 sm:py-1.5', i === active ? 'bg-zinc-100' : 'hover:bg-zinc-50')}
          >
            {item.text}
          </li>
        ))}
        <li aria-hidden="true" className="px-2.5 pt-1 text-[10px] text-zinc-400">Suggestions by Google</li>
      </ul>
    </div>
  );
}
