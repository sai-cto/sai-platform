/**
 * withScope() and withPlatformScope(): the only doors to tenant data.
 *
 * withScope(ctx, permission, fn)
 *   1. checks the permission,
 *   2. opens a transaction,
 *   3. tells the database which business and environment this transaction is for
 *      (row-level security then hides every other row),
 *   4. hands fn a Scope: a READ-ONLY query handle plus scope.where(table), the filter every
 *      tenant query must use. Writes go through src/core/records (which also logs them).
 *
 * withPlatformScope() is the explicit cross-business door, for platform roles only.
 */
import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { authorize } from '../rbac/permissions';
import type { BusinessContext, PlatformContext } from '../tenancy/context';
import type { TenantTable } from '../records/types';
import { getDb, type Tx } from './client';

const TX = Symbol('sai.tx');
const HOOKS = Symbol('sai.hooks');

type Hooks = { committed: (() => Promise<void>)[]; rolledBack: (() => Promise<void>)[] };

/** Query handle given to callers. It can read; it cannot insert, update or delete. */
export type ReadDb = Pick<Tx, 'select' | 'selectDistinct' | '$count'>;

export type ArchivedFilter = 'exclude' | 'only' | 'include';

export type Scope = {
  ctx: BusinessContext;
  db: ReadDb;
  /**
   * The tenant filter: this business, this environment, and (by default) not archived.
   * Every query on a tenant table must include it: .where(and(s.where(table), ...)).
   */
  where: (table: TenantTable, archived?: ArchivedFilter) => SQL;
  [TX]: Tx;
  [HOOKS]: Hooks;
};

export type PlatformScope = {
  ctx: PlatformContext;
  db: ReadDb;
  [TX]: Tx;
};

/** For src/core only: the real transaction behind a scope. Record functions use it to write. */
export function txOf(scope: Scope | PlatformScope): Tx {
  return scope[TX];
}

function readOnly(tx: Tx): ReadDb {
  return {
    select: tx.select.bind(tx),
    selectDistinct: tx.selectDistinct.bind(tx),
    $count: tx.$count.bind(tx),
  } as ReadDb;
}

export function tenantFilter(
  ctx: BusinessContext,
  table: TenantTable,
  archived: ArchivedFilter = 'exclude',
): SQL {
  const parts: SQL[] = [
    eq(table.businessId, ctx.business.id),
    eq(table.environment, ctx.environment),
  ];
  if (archived === 'exclude') parts.push(isNull(table.archivedAt));
  if (archived === 'only') parts.push(isNotNull(table.archivedAt));
  return and(...parts) as SQL;
}

/**
 * For things OUTSIDE the database that must follow the transaction's fate (file bytes).
 *   afterCommit: runs only once the transaction has really committed (e.g. delete the bytes
 *                of a permanently deleted file — never before, or a rollback would keep the
 *                row and lose the file).
 *   onRollback:  runs only if the transaction fails (e.g. remove bytes written for a row
 *                that was never saved).
 */
export function afterCommit(scope: Scope, fn: () => Promise<void>): void {
  scope[HOOKS].committed.push(fn);
}

export function onRollback(scope: Scope, fn: () => Promise<void>): void {
  scope[HOOKS].rolledBack.push(fn);
}

async function runHooks(hooks: (() => Promise<void>)[]): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook();
    } catch (error) {
      // The database work is already decided; a failed clean-up must not change the outcome.
      console.error('Clean-up after a transaction failed:', error);
    }
  }
}

export async function withScope<T>(
  ctx: BusinessContext,
  permission: string,
  fn: (scope: Scope) => Promise<T>,
): Promise<T> {
  authorize(ctx, permission);
  const hooks: Hooks = { committed: [], rolledBack: [] };
  let result: T;
  try {
    result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`select
        set_config('app.scope', 'business', true),
        set_config('app.business_id', ${ctx.business.id}, true),
        set_config('app.environment', ${ctx.environment}, true)`);
      const scope: Scope = {
        ctx,
        db: readOnly(tx),
        where: (table, archived) => tenantFilter(ctx, table, archived),
        [TX]: tx,
        [HOOKS]: hooks,
      };
      return fn(scope);
    });
  } catch (error) {
    await runHooks(hooks.rolledBack);
    throw error;
  }
  await runHooks(hooks.committed);
  return result;
}

export async function withPlatformScope<T>(
  ctx: PlatformContext,
  permission: string,
  fn: (scope: PlatformScope) => Promise<T>,
): Promise<T> {
  authorize(ctx, permission);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.scope', 'platform', true),
      set_config('app.business_id', '', true),
      set_config('app.environment', '', true)`);
    return fn({ ctx, db: readOnly(tx), [TX]: tx });
  });
}
