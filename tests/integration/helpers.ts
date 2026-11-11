import { and, asc, desc, eq, getTableName, gte, ne } from 'drizzle-orm';
import postgres from 'postgres';
import { getDb } from '@/core/db/client';
import {
  activityLog,
  appointments,
  customers,
  files,
  importJobs,
  notifications,
  payments,
  refunds,
  resources,
  unavailability,
  users,
} from '@/core/db/schema';
import { withScope, type Scope } from '@/core/db/scope';
import type { EntityDef } from '@/core/modules/contract';
import { CORE_ENTITIES } from '@/core/records/core-entities';
import { createRecord } from '@/core/records/records';
import {
  buildBusinessContext,
  buildPlatformContext,
  type BusinessContext,
  type Environment,
  type PlatformContext,
} from '@/core/tenancy/context';
import { systemContext } from '@/core/tenancy/system';

/** Seed user emails by what they are, so tests read clearly. */
export const USERS = {
  superAdmin: 'cto@sai.example',
  tech: 'tech@sai.example',
  executive: 'ceo@sai.example',
  brssAdmin: 'brss.admin@sai.example',
  brssStaff: 'brss.staff@sai.example',
  brssNewHire: 'brss.newhire@sai.example',
  hhmcAdmin: 'hhmc.admin@sai.example',
  hhmcStaff: 'hhmc.staff@sai.example',
  multi: 'multi@sai.example',
} as const;

export async function userId(email: string): Promise<string> {
  const [user] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) throw new Error(`No seed user ${email}`);
  return user.id;
}

export async function ctxFor(
  email: string,
  business: string,
  environment: Environment = 'live',
): Promise<BusinessContext> {
  return buildBusinessContext(await userId(email), business, environment);
}

export async function platformCtxFor(email: string): Promise<PlatformContext> {
  return buildPlatformContext(await userId(email));
}

export { systemContext };

/** Activity log rows about one entity, newest first (read as the test's own platform view). */
export async function logFor(entityType: string, entityId: string, since?: Date) {
  return getDb().transaction(async (tx) => {
    await tx.execute(`select set_config('app.scope', 'platform', true)`);
    return tx
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityType, entityType),
          eq(activityLog.entityId, entityId),
          since ? gte(activityLog.occurredAt, since) : undefined,
        ),
      )
      .orderBy(desc(activityLog.occurredAt));
  });
}

/** A connection as the database OWNER. Tests use it only to arrange things the app cannot do (ageing an archive). */
export async function asOwner<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.TEST_DATABASE_OWNER_URL as string, {
    max: 1,
    onnotice: () => {},
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

export async function ageArchive(tableName: string, id: string, days: number): Promise<void> {
  await asOwner(
    (sql) =>
      sql`update ${sql(tableName)} set archived_at = now() - make_interval(days => ${days}) where id = ${id}`,
  );
}

// ---- fixtures: valid values for creating one row of each core entity -----------------

type Fixture = (s: Scope) => Promise<Record<string, unknown>>;
const customerId = async (s: Scope) =>
  (
    await createRecord(s, entityByKey('core.customer'), {
      firstName: 'Fixture',
      lastName: 'Customer',
    } as never)
  ).id;

const entityLookup = new Map(CORE_ENTITIES.map((e) => [e.key, e as EntityDef]));
function entityByKey(key: string): EntityDef {
  return entityLookup.get(key) as EntityDef;
}

const soon = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000);

export const FIXTURES: Record<string, Fixture> = {
  'core.customer': async () => ({
    firstName: 'Fixture',
    lastName: `Person ${Math.random().toString(36).slice(2, 8)}`,
    email: 'fixture@example.com',
  }),
  'core.payment': async (s) => ({
    customerId: await customerId(s),
    amountCents: 1234,
    status: 'succeeded',
    provider: 'mock',
    description: 'Fixture payment',
    paidAt: new Date(),
  }),
  'core.refund': async (s) => {
    const payment = await createRecord(s, entityByKey('core.payment'), {
      amountCents: 5000,
      status: 'succeeded',
      provider: 'mock',
      paidAt: new Date(),
    } as never);
    return {
      paymentId: payment.id,
      amountCents: 100,
      status: 'succeeded',
      reason: 'Fixture refund',
    };
  },
  'core.resource': async () => ({
    kind: 'truck',
    name: `Fixture truck ${Math.random().toString(36).slice(2, 6)}`,
  }),
  'core.appointment': async (s) => ({
    customerId: await customerId(s),
    kind: 'visit',
    startsAt: soon(1000),
    endsAt: soon(1002),
  }),
  'core.unavailability': async () => ({
    startsAt: soon(5000),
    endsAt: soon(5002),
    reason: 'Fixture block',
  }),
  'core.notification': async () => ({
    recipient: 'fixture@example.com',
    subject: 'Fixture',
    body: 'Hello',
    status: 'sent',
    adapter: 'console-email',
  }),
  'core.file': async () => ({
    storageKey: `fixture/${Math.random().toString(36).slice(2)}`,
    filename: 'fixture.txt',
    contentType: 'text/plain',
    sizeBytes: 5,
  }),
  'core.import_job': async () => ({ entityKey: 'core.customer', filename: 'fixture.csv' }),
};

/**
 * Makes sure one row of the entity exists in the scope and returns its id.
 * Core entities are created from FIXTURES (a fresh row every call). Module entities come
 * from the module's seedDemoData — if this throws for your new entity, add fake rows for it
 * there (at least two per table). Pass `not` to get a different row from one you already hold.
 */
export async function ensureRow(s: Scope, entity: EntityDef, not?: string): Promise<string> {
  const fixture = FIXTURES[entity.key];
  if (fixture) return String((await createRecord(s, entity, (await fixture(s)) as never)).id);
  const candidates = await s.db
    .select()
    .from(entity.table)
    .where(and(s.where(entity.table), not ? ne(entity.table.id, not) : undefined))
    .orderBy(asc(entity.table.id))
    .limit(200);
  // Prefer a row the module allows to be archived and restored (tests do both).
  let existing = candidates[0] as { id: unknown } | undefined;
  if (entity.archiveGuard || entity.restoreGuard) {
    for (const row of candidates) {
      const r = row as Record<string, unknown>;
      // A row that can be archived AND brought back (tests archive, then restore).
      if (!(await entity.archiveGuard?.(s, r)) && !(await entity.restoreGuard?.(s, r))) {
        existing = row as { id: unknown };
        break;
      }
    }
  }
  if (!existing)
    throw new Error(
      `Not enough rows for entity "${entity.key}" in ${s.ctx.business.slug}/${s.ctx.environment}. Add fake rows in the module's seedDemoData (at least two).`,
    );
  return String(existing.id);
}

/** Runs fn as the system actor inside a business (arranging test data). */
export async function arrange<T>(
  business: string,
  environment: Environment,
  fn: (s: Scope) => Promise<T>,
): Promise<T> {
  return withScope(await systemContext(business, environment), 'business.overview.read', fn);
}

export const CORE_TABLES = {
  customers,
  payments,
  refunds,
  resources,
  appointments,
  unavailability,
  notifications,
  files,
  importJobs,
};

/** The SQL name of an entity's table. */
export function tableNameOf(entity: EntityDef): string {
  return getTableName(entity.table);
}
