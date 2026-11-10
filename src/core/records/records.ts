/**
 * THE ONLY WAY TO WRITE TENANT DATA.
 *
 * createRecord / updateRecord / archiveRecord / restoreRecord / purgeRecord each:
 *   1. check the permission,
 *   2. find the row INSIDE the caller's scope (another business's row does not exist here),
 *   3. write,
 *   4. add the activity log entry in the same transaction.
 *
 * "Delete" in the product means archiveRecord (recoverable). purgeRecord is the single
 * permanent delete: super_admin only, and only after the retention window.
 */
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { logActivity } from '../audit/log';
import { txOf, type ArchivedFilter, type Scope } from '../db/scope';
import { STANDARD_COLUMN_KEYS } from '../db/tenant-table';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { EntityDef } from '../modules/contract';
import { authorize } from '../rbac/permissions';
import { getRetentionDays } from '../settings/platform';
import type { NewValues, Patch, Row, TenantTable } from './types';

type AnyRow = Record<string, unknown>;
const STANDARD = new Set<string>(STANDARD_COLUMN_KEYS);

/** Removes standard columns from caller-supplied values: the core sets those, nobody else. */
function withoutStandard(values: AnyRow): AnyRow {
  return Object.fromEntries(
    Object.entries(values).filter(([key, v]) => !STANDARD.has(key) && v !== undefined),
  );
}

function businessFields(row: AnyRow): AnyRow {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !STANDARD.has(key)));
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function findInScope(
  s: Scope,
  table: TenantTable,
  id: string,
  archived: ArchivedFilter,
): Promise<AnyRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError();
  const [row] = await s.db
    .select()
    .from(table)
    .where(and(s.where(table, archived), eq(table.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row as AnyRow;
}

export async function getRecord<T extends TenantTable>(
  s: Scope,
  entity: EntityDef<T>,
  id: string,
  archived: ArchivedFilter = 'exclude',
): Promise<Row<T>> {
  authorize(s.ctx, entity.readPermission);
  return (await findInScope(s, entity.table, id, archived)) as Row<T>;
}

export type ListOptions = {
  search?: string;
  archived?: ArchivedFilter;
  limit?: number;
  offset?: number;
  /** Extra conditions, combined with AND. */
  where?: SQL;
  orderBy?: { column: AnyPgColumn; direction: 'asc' | 'desc' };
};

export async function listRecords<T extends TenantTable>(
  s: Scope,
  entity: EntityDef<T>,
  options: ListOptions = {},
): Promise<{ rows: Row<T>[]; total: number }> {
  authorize(s.ctx, entity.readPermission);
  const table = entity.table as TenantTable & Record<string, AnyPgColumn>;
  const conditions: (SQL | undefined)[] = [
    s.where(table, options.archived ?? 'exclude'),
    options.where,
  ];
  const term = options.search?.trim();
  if (term && entity.searchColumns.length > 0) {
    const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(...entity.searchColumns.map((key) => ilike(sql`${table[key]}::text`, pattern))),
    );
  }
  const where = and(...conditions);
  const order = options.orderBy
    ? options.orderBy.direction === 'asc'
      ? asc(options.orderBy.column)
      : desc(options.orderBy.column)
    : desc(table.createdAt);
  const rows = await s.db
    .select()
    .from(table)
    .where(where)
    .orderBy(order, asc(table.id))
    .limit(Math.min(options.limit ?? 50, 5000))
    .offset(options.offset ?? 0);
  const total = await s.db.$count(table, where);
  return { rows: rows as Row<T>[], total };
}

export async function createRecord<T extends TenantTable>(
  s: Scope,
  entity: EntityDef<T>,
  values: NewValues<T>,
): Promise<Row<T>> {
  authorize(s.ctx, entity.writePermission);
  const [row] = await txOf(s)
    .insert(entity.table)
    .values({
      ...withoutStandard(values as AnyRow),
      businessId: s.ctx.business.id,
      environment: s.ctx.environment,
      createdBy: s.ctx.actor.id,
      updatedBy: s.ctx.actor.id,
    } as never)
    .returning();
  const created = row as AnyRow;
  await logActivity(txOf(s), s.ctx, {
    action: 'create',
    entityType: entity.key,
    entityId: String(created.id),
    summary: `Created ${entity.label} "${entity.titleOf(created)}"`,
    before: null,
    after: businessFields(created),
  });
  return created as Row<T>;
}

export async function updateRecord<T extends TenantTable>(
  s: Scope,
  entity: EntityDef<T>,
  id: string,
  patch: Patch<T>,
): Promise<Row<T>> {
  authorize(s.ctx, entity.writePermission);
  const before = await findInScope(s, entity.table, id, 'exclude');
  const changes = Object.fromEntries(
    Object.entries(withoutStandard(patch as AnyRow)).filter(
      ([key, value]) => !same(before[key], value),
    ),
  );
  if (Object.keys(changes).length === 0) return before as Row<T>;
  const [row] = await txOf(s)
    .update(entity.table)
    .set({ ...changes, updatedAt: new Date(), updatedBy: s.ctx.actor.id } as never)
    .where(and(s.where(entity.table), eq(entity.table.id, id)))
    .returning();
  const after = row as AnyRow;
  await logActivity(txOf(s), s.ctx, {
    action: 'update',
    entityType: entity.key,
    entityId: id,
    summary: `Updated ${entity.label} "${entity.titleOf(after)}" (${Object.keys(changes).join(', ')})`,
    before: Object.fromEntries(Object.keys(changes).map((key) => [key, before[key]])),
    after: changes,
  });
  return after as Row<T>;
}

/** "Delete": hides the record and keeps it recoverable. */
export async function archiveRecord<T extends TenantTable>(
  s: Scope,
  entity: EntityDef<T>,
  id: string,
): Promise<void> {
  authorize(s.ctx, entity.writePermission);
  const before = await findInScope(s, entity.table, id, 'exclude');
  const now = new Date();
  await txOf(s)
    .update(entity.table)
    .set({ archivedAt: now, archivedBy: s.ctx.actor.id } as never)
    .where(and(s.where(entity.table), eq(entity.table.id, id)));
  await logActivity(txOf(s), s.ctx, {
    action: 'archive',
    entityType: entity.key,
    entityId: id,
    summary: `Archived ${entity.label} "${entity.titleOf(before)}"`,
    before: { archivedAt: null },
    after: { archivedAt: now.toISOString() },
  });
}

export async function restoreRecord<T extends TenantTable>(
  s: Scope,
  entity: EntityDef<T>,
  id: string,
): Promise<void> {
  authorize(s.ctx, entity.writePermission);
  const before = await findInScope(s, entity.table, id, 'only');
  await txOf(s)
    .update(entity.table)
    .set({ archivedAt: null, archivedBy: null } as never)
    .where(and(s.where(entity.table, 'only'), eq(entity.table.id, id)));
  await logActivity(txOf(s), s.ctx, {
    action: 'restore',
    entityType: entity.key,
    entityId: id,
    summary: `Restored ${entity.label} "${entity.titleOf(before)}"`,
    before: {
      archivedAt:
        before.archivedAt instanceof Date ? before.archivedAt.toISOString() : before.archivedAt,
    },
    after: { archivedAt: null },
  });
}

/** When an archived record becomes eligible for permanent deletion. */
export function purgeEligibleAt(archivedAt: Date, retentionDays: number): Date {
  return new Date(archivedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

/** Has this archived record passed the retention window? */
export function isPurgeEligible(archivedAt: Date, retentionDays: number): boolean {
  return purgeEligibleAt(archivedAt, retentionDays).getTime() <= Date.now();
}

/**
 * Permanent delete. super_admin only, and only for a record that has been archived for
 * longer than the retention window. The log keeps a tombstone (who, what, when), not the
 * record's contents.
 */
export async function purgeRecord<T extends TenantTable>(
  s: Scope,
  entity: EntityDef<T>,
  id: string,
): Promise<void> {
  authorize(s.ctx, 'business.data.purge');
  if (s.ctx.role !== 'super_admin') throw new ForbiddenError('business.data.purge');
  const row = await findInScope(s, entity.table, id, 'only');
  const retentionDays = await getRetentionDays(txOf(s));
  const eligibleAt = purgeEligibleAt(row.archivedAt as Date, retentionDays);
  if (!isPurgeEligible(row.archivedAt as Date, retentionDays)) {
    throw new ValidationError(
      `This record can be permanently deleted on ${eligibleAt.toISOString().slice(0, 10)} (${retentionDays} days after it was archived).`,
    );
  }
  try {
    // A savepoint, so a refusal by the database does not poison the surrounding transaction.
    await txOf(s).transaction(async (inner) => {
      await inner
        .delete(entity.table)
        .where(and(s.where(entity.table, 'only'), eq(entity.table.id, id)));
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ValidationError(
        'Other records still refer to this one. Permanently delete those first.',
      );
    }
    throw error;
  }
  await logActivity(txOf(s), s.ctx, {
    action: 'purge',
    entityType: entity.key,
    entityId: id,
    summary: `Permanently deleted ${entity.label} "${entity.titleOf(row)}"`,
    before: { label: entity.titleOf(row), archivedAt: (row.archivedAt as Date).toISOString() },
    after: null,
  });
}

function isForeignKeyViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: string }).code === '23503') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
