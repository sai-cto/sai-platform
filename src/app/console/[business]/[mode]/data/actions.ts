'use server';

import { withScope } from '@/core/db/scope';
import { NotFoundError } from '@/core/errors';
import { findEntity } from '@/core/modules/registry';
import { archiveRecord, purgeRecord, restoreRecord } from '@/core/records/records';
import type { ActionResult } from '@/ui/action-form';
import { act } from '../../../../_lib/actions';
import { parseMode, requireBusinessContext } from '../../../../_lib/session';

async function resolve(slug: string, mode: string, entityKey: string) {
  const ctx = await requireBusinessContext(slug, parseMode(mode));
  const entity = findEntity(ctx.business.moduleKey, entityKey);
  if (!entity) throw new NotFoundError();
  return { ctx, entity };
}

/** "Delete" in the Data tab: archives the record. It can be restored. */
export async function archiveRecordAction(slug: string, mode: string, entityKey: string, id: string): Promise<ActionResult> {
  return act(async () => {
    const { ctx, entity } = await resolve(slug, mode, entityKey);
    await withScope(ctx, 'business.data.read', (s) => archiveRecord(s, entity, id));
  });
}

export async function restoreRecordAction(slug: string, mode: string, entityKey: string, id: string): Promise<ActionResult> {
  return act(async () => {
    const { ctx, entity } = await resolve(slug, mode, entityKey);
    await withScope(ctx, 'business.data.read', (s) => restoreRecord(s, entity, id));
  });
}

/** Permanent delete. The core refuses unless the caller is super_admin and retention has passed. */
export async function purgeRecordAction(slug: string, mode: string, entityKey: string, id: string): Promise<ActionResult> {
  return act(async () => {
    const { ctx, entity } = await resolve(slug, mode, entityKey);
    await withScope(ctx, 'business.data.purge', (s) => purgeRecord(s, entity, id));
  });
}
