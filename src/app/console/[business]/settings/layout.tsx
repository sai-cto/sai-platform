import type { ReactNode } from 'react';
import { AdminAppFrame } from '@/server/app-sections';
import { requireBusinessContext } from '@/server/session';

/** Shown as part of the app's Settings when the business's module runs its admin there (adminInApp). */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ business: string }> }) {
  const { business } = await params;
  const ctx = await requireBusinessContext(business);
  return <AdminAppFrame ctx={ctx} active="business-settings" padded>{children}</AdminAppFrame>;
}
