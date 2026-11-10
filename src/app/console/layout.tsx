import type { ReactNode } from 'react';
import { ROLE_LABELS } from '@/core/rbac/roles';
import { listAccessibleBusinesses } from '@/core/tenancy/context';
import { logoutAction } from '../_lib/auth-actions';
import { requirePlatformContext } from '../_lib/session';
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

  return (
    <Shell
      user={{ name: ctx.actor.name, email: ctx.actor.email, roleLabel }}
      top={topLinks(ctx)}
      platform={platformLinks(ctx)}
      businesses={businesses.map((b) => ({ slug: b.slug, code: b.code, name: b.name, accentColor: b.accentColor }))}
      signOut={logoutAction}
    >
      {children}
    </Shell>
  );
}
