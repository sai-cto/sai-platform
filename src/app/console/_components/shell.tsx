'use client';

import { Command } from 'cmdk';
import { Activity, Boxes, ChartNoAxesColumn, Flag, HeartPulse, House, LogOut, Menu, Search, Settings, Upload, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/ui/cn';
import { Monogram } from '@/ui/monogram';
import type { NavIcon, NavLink } from '../_lib/nav';

export type ShellBusiness = { slug: string; code: string; name: string; accentColor: string };
export type ShellUser = { name: string; email: string; roleLabel: string };

const ICONS: Record<NavIcon, typeof House> = {
  home: House,
  chart: ChartNoAxesColumn,
  users: Users,
  boxes: Boxes,
  flag: Flag,
  activity: Activity,
  upload: Upload,
  heart: HeartPulse,
  settings: Settings,
};

function isActive(pathname: string, href: string): boolean {
  if (href === '/console') return pathname === '/console';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({ link, pathname, onNavigate }: { link: NavLink; pathname: string; onNavigate?: () => void }) {
  const Icon = ICONS[link.icon];
  const active = isActive(pathname, link.href);
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-zinc-900',
        active && 'bg-zinc-200/80 font-medium text-zinc-900',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{link.label}</span>
    </Link>
  );
}

function SidebarContent({
  user,
  top,
  platform,
  businesses,
  pathname,
  onNavigate,
  onOpenPalette,
  signOut,
}: {
  user: ShellUser;
  top: NavLink[];
  platform: NavLink[];
  businesses: ShellBusiness[];
  pathname: string;
  onNavigate?: () => void;
  onOpenPalette: () => void;
  signOut: () => Promise<void>;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <span className="flex size-6 items-center justify-center rounded bg-zinc-900 text-[9px] font-bold tracking-tight text-white">SAI</span>
        <span className="text-sm font-semibold tracking-tight text-zinc-900">Console</span>
      </div>

      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 text-left text-[13px] text-zinc-500 hover:border-zinc-300 focus-visible:outline-2 focus-visible:outline-zinc-900"
        >
          <Search className="size-3.5" aria-hidden="true" />
          <span className="flex-1">Go to…</span>
          <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1 font-sans text-[10px] text-zinc-500">⌘K</kbd>
        </button>
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        <div className="space-y-0.5">
          {top.map((link) => (
            <NavItem key={link.href} link={link} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </div>

        {platform.length > 0 ? (
          <div data-testid="nav-platform">
            <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Platform</div>
            <div className="space-y-0.5">
              {platform.map((link) => (
                <NavItem key={link.href} link={link} pathname={pathname} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ) : null}

        <div data-testid="nav-businesses">
          <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Businesses</div>
          <div className="space-y-0.5">
            {businesses.map((b) => {
              const active = isActive(pathname, `/console/${b.slug}`);
              return (
                <Link
                  key={b.slug}
                  href={`/console/${b.slug}`}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  title={b.name}
                  className={cn(
                    'relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-zinc-900',
                    active && 'bg-zinc-200/80 font-medium text-zinc-900',
                  )}
                >
                  <Monogram code={b.code} color={b.accentColor} size="sm" />
                  <span className="truncate">{b.name}</span>
                </Link>
              );
            })}
            {businesses.length === 0 ? <p className="px-2 py-1 text-xs text-zinc-500">You have not been given access to a business yet.</p> : null}
          </div>
        </div>
      </nav>

      <div className="shrink-0 border-t border-zinc-200 p-2">
        <div className="flex items-center gap-2 px-1">
          <div className="min-w-0 flex-1">
            <div data-testid="whoami" className="truncate text-[13px] font-medium text-zinc-900">{user.name}</div>
            <div data-testid="whoami-role" className="truncate text-[11px] text-zinc-500">{user.roleLabel}</div>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-zinc-900"
            >
              <LogOut className="size-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export type PaletteItem = { label: string; href: string; group: string; keywords?: string };

/**
 * The console frame: sidebar on desktop, a slide-in drawer on phones, the command palette
 * (Ctrl/Cmd-K) and the keyboard shortcuts.
 *
 * Shortcuts:  Ctrl/Cmd-K  go to anything ·  [ and ]  previous / next business ·
 *             g then a letter  jump to a tab of the current business (letters: _lib/nav.ts)
 */
export function Shell({
  user,
  top,
  platform,
  businesses,
  signOut,
  children,
}: {
  user: ShellUser;
  top: NavLink[];
  platform: NavLink[];
  businesses: ShellBusiness[];
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pendingG = useRef(false);

  const current = useMemo(() => {
    const [, , slug, maybeMode] = pathname.split('/');
    const business = businesses.find((b) => b.slug === slug);
    const mode = maybeMode === 'sandbox' ? 'sandbox' : 'live';
    return business ? { business, mode } : null;
  }, [pathname, businesses]);

  // The current business's tabs are read from the page itself (the links the business header
  // rendered), so the palette and shortcuts only ever offer tabs this person can open.
  const [tabItems, setTabItems] = useState<PaletteItem[]>([]);
  const openPalette = () => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-business-tab]'));
    const code = current?.business.code ?? '';
    setTabItems(links.map((a) => ({ label: `${code}: ${a.textContent ?? ''}`, href: a.getAttribute('href') ?? '', group: 'This business', keywords: `g ${a.dataset.shortcut ?? ''}` })));
    setPaletteOpen(true);
  };
  const openPaletteRef = useRef(openPalette);
  useEffect(() => {
    openPaletteRef.current = openPalette;
  });

  const paletteItems = useMemo<PaletteItem[]>(
    () => [
      ...tabItems,
      ...top.map((l) => ({ label: l.label, href: l.href, group: 'Go to' })),
      ...platform.map((l) => ({ label: l.label, href: l.href, group: 'Platform' })),
      ...businesses.map((b) => ({ label: b.name, href: `/console/${b.slug}`, group: 'Businesses', keywords: b.code })),
    ],
    [tabItems, top, platform, businesses],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openPaletteRef.current();
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === '[' || event.key === ']') {
        if (businesses.length === 0) return;
        const index = current ? businesses.findIndex((b) => b.slug === current.business.slug) : -1;
        const next = event.key === ']' ? (index + 1) % businesses.length : (index - 1 + businesses.length) % businesses.length;
        router.push(`/console/${businesses[next].slug}`);
        return;
      }
      if (pendingG.current) {
        pendingG.current = false;
        const key = event.key.toLowerCase();
        const link = /^[a-z]$/.test(key) ? document.querySelector<HTMLAnchorElement>(`a[data-business-tab][data-shortcut="${key}"]`) : null;
        const href = link?.getAttribute('href');
        if (href) {
          event.preventDefault();
          router.push(href);
        }
        return;
      }
      pendingG.current = event.key === 'g';
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [businesses, current, router]);

  const sidebar = (onNavigate?: () => void) => (
    <SidebarContent
      user={user}
      top={top}
      platform={platform}
      businesses={businesses}
      pathname={pathname}
      onNavigate={onNavigate}
      onOpenPalette={() => {
        onNavigate?.();
        openPalette();
      }}
      signOut={signOut}
    />
  );

  return (
    <div className="flex min-h-screen bg-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-zinc-200 bg-zinc-50 lg:block">{sidebar()}</aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone / tablet top bar */}
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3 lg:hidden">
          <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <Dialog.Trigger asChild>
              <button type="button" aria-label="Open menu" className="flex size-8 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-900">
                <Menu className="size-5" aria-hidden="true" />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-zinc-950/40" />
              <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-zinc-200 bg-zinc-50 shadow-xl focus:outline-none">
                <Dialog.Title className="sr-only">Menu</Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" aria-label="Close menu" className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-200/60">
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </Dialog.Close>
                {sidebar(() => setDrawerOpen(false))}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <span className="flex size-6 items-center justify-center rounded bg-zinc-900 text-[9px] font-bold text-white">SAI</span>
          <span className="truncate text-sm font-semibold text-zinc-900">{current ? current.business.name : 'Console'}</span>
          <button type="button" aria-label="Go to…" onClick={openPalette} className="ml-auto flex size-8 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-900">
            <Search className="size-4" aria-hidden="true" />
          </button>
        </header>

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>

      <Dialog.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-zinc-950/40" />
          <Dialog.Content aria-describedby={undefined} className="fixed top-[15vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl focus:outline-none">
            <Dialog.Title className="sr-only">Go to a page</Dialog.Title>
            <Command label="Go to a page">
              <Command.Input autoFocus placeholder="Type a page or business…" className="h-11 w-full border-b border-zinc-200 px-4 text-sm outline-none placeholder:text-zinc-400" />
              <Command.List className="max-h-80 overflow-y-auto p-1.5">
                <Command.Empty className="px-3 py-6 text-center text-sm text-zinc-500">Nothing matches.</Command.Empty>
                {[...new Set(paletteItems.map((i) => i.group))].map((group) => (
                  <Command.Group key={group} heading={group} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-zinc-400 [&_[cmdk-group-heading]]:uppercase">
                    {paletteItems
                      .filter((i) => i.group === group)
                      .map((item) => (
                        <Command.Item
                          key={`${group}:${item.href}`}
                          value={`${item.label} ${item.keywords ?? ''}`}
                          onSelect={() => {
                            setPaletteOpen(false);
                            router.push(item.href);
                          }}
                          className="flex h-9 cursor-pointer items-center rounded-md px-2 text-sm text-zinc-700 data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900"
                        >
                          {item.label}
                        </Command.Item>
                      ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
