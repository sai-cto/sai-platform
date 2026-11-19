import type { ReactNode } from 'react';
import { AdminAppFrame } from '@/server/app-sections';
import { parseMode, requireBusinessContext } from '@/server/session';

/** Shown as a section of the app when the business's module runs its admin there (adminInApp). */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ business: string; mode: string }> }) {
  const { business, mode } = await params;
  const ctx = await requireBusinessContext(business, parseMode(mode));
  return <AdminAppFrame ctx={ctx} active="activity">{children}</AdminAppFrame>;
}
