import type { ReactNode } from 'react';
import { ROLE_LABELS } from '@/core/rbac/roles';
import { requireBusinessContext } from '../../_lib/session';
import { BusinessHeader } from '../_components/business-header';
import { businessTabs } from '../_lib/nav';

/** Frame for every page of one business. A business you cannot open is "not found". */
export default async function BusinessLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ business: string }>;
}) {
  const { business: slug } = await params;
  const ctx = await requireBusinessContext(slug, 'live');
  return (
    <>
      <BusinessHeader
        business={{
          slug: ctx.business.slug,
          code: ctx.business.code,
          name: ctx.business.name,
          description: ctx.business.description,
          accentColor: ctx.business.accentColor,
        }}
        roleLabel={ROLE_LABELS[ctx.role]}
        tabs={businessTabs(ctx).map(({ key, label, usesMode, shortcut }) => ({
          key,
          label,
          usesMode,
          shortcut,
        }))}
        canUseSandbox={ctx.permissions.has('business.sandbox.use')}
      />
      {children}
    </>
  );
}
