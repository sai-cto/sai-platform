import type { ReactNode } from 'react';
import { ROLE_LABELS } from '@/core/rbac/roles';
import { listAccessibleBusinesses } from '@/core/tenancy/context';
import { logoutAction } from '@/server/auth-actions';
import { stopActingAsAction } from '@/server/acting-as-actions';
import { requirePlatformContext } from '@/server/session';
import { Shell } from './_components/shell';
import { platformLinks, topLinks } from './_lib/nav';

/**
 * The console frame. Everything it shows (links, businesses) is worked out on the server
 * from the signed-in person's permissions. Pages still check permissions themselves:
 * this layout is navigation, not security.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePlatformContext();
  const businesses = await listAccessibleBusinesses(ctx.actor.id as string);
  const roleLabel = ctx.role
    ? ROLE_LABELS[ctx.role]
    : [...new Set(businesses.map((b) => ROLE_LABELS[b.role]))].join(' · ') || 'No access yet';

  const acting = ctx.actor.actingBy;
  const shell = (
    <Shell
      user={{ name: ctx.actor.name, email: ctx.actor.email, roleLabel }}
      top={topLinks(ctx, businesses.length)}
      platform={platformLinks(ctx)}
      businesses={businesses.map((b) => ({
        slug: b.slug,
        code: b.code,
        name: b.name,
        accentColor: b.accentColor,
      }))}
      signOut={logoutAction}
    >
      {children}
    </Shell>
  );
  if (!acting) return shell;
  return (
    <>
      <form
        action={stopActingAsAction}
        role="note"
        data-testid="acting-as-banner"
        className="relative flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-3 py-1.5 text-center text-sm font-semibold text-zinc-950 print:hidden"
      >
        <span>
          {acting.name}, you are acting as {ctx.actor.name} ({roleLabel}). What you
          change is real and logged as you.
        </span>
        <button type="submit" className="rounded bg-zinc-950 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-zinc-800">
          Stop acting
        </button>
      </form>
      {shell}
    </>
  );
}
