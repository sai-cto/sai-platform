/**
 * The copy engine behind `npm run hhmc:sync-to-pilot`: makes one database's Hired Hands (HHMC)
 * LIVE data and settings match another's, and proves it.
 *
 * It takes two open connections (source, target) and knows nothing about hosts or TLS: the
 * guard in scripts/lib/pilot-target.ts decides WHICH target may be written. Both connections
 * are expected to be the restricted app role (sai_app); every read and write sets the tenant
 * context the way withScope() does, so row-level security stays in force.
 *
 * Rules (DECISIONS: "the website matches the laptop until managers use it"):
 *   - only business slug 'hhmc', environment 'live': test mode and other businesses are never read
 *     or written;
 *   - every tenant table is discovered at run time and copied in foreign-key order, except
 *     `files` (the bytes live on the laptop's disk; the hosting keeps no files) and other
 *     modules' tables (brss_* …);
 *   - user columns are mapped by email; references to users the target does not have become null;
 *   - the activity log is append-only (even for the owner): entries already on the target are
 *     kept, missing ones added, and a target entry the source does not have stops the copy;
 *   - the target's fingerprint (per table: rows + md5) is stored after each copy, and the next
 *     copy refuses if the target no longer matches it: someone used the website.
 */
import type postgres from 'postgres';

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

export const SLUG = 'hhmc';
export const ENVIRONMENT = 'live';
/** platform_settings key holding the target's fingerprint after the last copy. */
export const SYNC_KEY = 'hhmc.pilotSync';
/** Tenant tables never copied, and why (printed). */
export const NOT_COPIED: Record<string, string> = {
  files: 'file bytes live on the laptop; the hosting keeps no files',
};
/** Columns holding a user id (no foreign key): mapped by email, null when the target lacks the user. */
const USER_COLUMNS = ['created_by', 'updated_by', 'archived_by', 'actor_user_id'];
/** Append-only tables (a trigger refuses UPDATE / DELETE even for the owner). */
const APPEND_ONLY = new Set(['activity_log']);
const BATCH = 200;
const EMPTY_MD5 = 'd41d8cd98f00b204e9800998ecf8427e'; // md5('')

/** A refusal: nothing was written. The message is safe to print (counts and table names only). */
export class SyncRefused extends Error {
  constructor(message: string) {
    super(message.startsWith('Refusing') ? message : `Refusing: ${message}`);
    this.name = 'SyncRefused';
  }
}

export type TableFingerprint = { rows: number; md5: string };
export type Fingerprint = { tables: Record<string, TableFingerprint>; settings: string };
export type StoredSync = { version: 1; syncedAt: string; fingerprint: Fingerprint };

/** What to copy and how, worked out from the source's schema. */
export type Plan = {
  /** Every HHMC-scoped tenant table (fingerprinted), copied or not. */
  scope: string[];
  /** Copied tables, parents before children. */
  copy: string[];
  /** Columns written on insert (generated columns left out). */
  columns: Record<string, string[]>;
  userColumns: Record<string, string[]>;
  /** Columns pointing at a table that is not copied (files): written as null. */
  droppedRefs: Record<string, string[]>;
  /** Single-column references from a table to itself (column → referenced column). */
  selfRefs: Record<string, [string, string][]>;
  /** Columns left out of the md5: business_id, user columns, dropped references. */
  excluded: Record<string, string[]>;
  /** table → "column type, …", to check both databases have the same shape. */
  shape: Record<string, string>;
};

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const lit = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** Business id by slug, then the tenant context (as withScope sets it) and UTC timestamps. */
async function enter(tx: Tx): Promise<string> {
  const [b] = await tx`select id::text as id from businesses where slug = ${SLUG}`;
  if (!b) throw new SyncRefused(`there is no business "${SLUG}" in this database.`);
  await tx`select set_config('app.scope', 'business', true), set_config('app.business_id', ${b.id}, true),
    set_config('app.environment', ${ENVIRONMENT}, true), set_config('TimeZone', 'UTC', true)`;
  return b.id as string;
}

type Fk = { table: string; ref: string; cols: string[]; refCols: string[] };

async function readSchema(tx: Tx) {
  const cols = await tx<{ table: string; column: string; type: string; generated: string }[]>`
    select c.relname::text as table, a.attname::text as column, format_type(a.atttypid, a.atttypmod) as type,
      a.attgenerated::text as generated
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
    order by c.relname, a.attnum`;
  const fks = await tx<{ table: string; ref: string; cols: string; refCols: string }[]>`
    select cl.relname::text as table, rf.relname::text as ref,
      (select json_agg(a.attname::text order by k.o) from unnest(con.conkey) with ordinality k(n, o)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n)::text as cols,
      (select json_agg(a.attname::text order by k.o) from unnest(con.confkey) with ordinality k(n, o)
        join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n)::text as "refCols"
    from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_class rf on rf.oid = con.confrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where con.contype = 'f' and n.nspname = 'public'`;
  const tables = new Map<string, { column: string; type: string; generated: boolean }[]>();
  for (const c of cols) {
    if (!tables.has(c.table)) tables.set(c.table, []);
    tables.get(c.table)!.push({ column: c.column, type: c.type, generated: c.generated !== '' });
  }
  const keys = await tx<{ key: string }[]>`select distinct module_key as key from business_modules m
    join businesses b on b.id = m.business_id where b.slug <> ${SLUG}`;
  return {
    tables,
    fks: fks.map((f): Fk => ({ table: f.table, ref: f.ref, cols: JSON.parse(f.cols), refCols: JSON.parse(f.refCols) })),
    otherModules: keys.map((k) => k.key),
  };
}

function makePlan(schema: Awaited<ReturnType<typeof readSchema>>): Plan {
  const otherPrefixes = schema.otherModules.filter((k) => k !== SLUG).map((k) => `${k}_`);
  const scope = [...schema.tables.keys()]
    .filter((t) => {
      const names = schema.tables.get(t)!.map((c) => c.column);
      return names.includes('business_id') && names.includes('environment');
    })
    .filter((t) => !otherPrefixes.some((p) => t.startsWith(p)))
    .sort();
  if (!scope.includes('activity_log') || !scope.some((t) => t.startsWith(`${SLUG}_`)))
    throw new SyncRefused('the database does not have the expected tables.');
  const copySet = new Set(scope.filter((t) => !(t in NOT_COPIED)));
  const plan: Plan = { scope, copy: [], columns: {}, userColumns: {}, droppedRefs: {}, selfRefs: {}, excluded: {}, shape: {} };
  const deps = new Map<string, Set<string>>();
  for (const t of scope) {
    const cols = schema.tables.get(t)!;
    plan.shape[t] = cols.map((c) => `${c.column} ${c.type}${c.generated ? ' generated' : ''}`).join(', ');
    plan.columns[t] = cols.filter((c) => !c.generated).map((c) => c.column);
    plan.userColumns[t] = cols.map((c) => c.column).filter((c) => USER_COLUMNS.includes(c));
    plan.droppedRefs[t] = [];
    plan.selfRefs[t] = [];
    deps.set(t, new Set());
    for (const fk of schema.fks.filter((f) => f.table === t)) {
      const own = fk.cols.filter((c) => c !== 'business_id' && c !== 'environment');
      if (fk.ref === 'businesses') continue;
      if (fk.ref === t) {
        const refOwn = fk.refCols.filter((c) => c !== 'business_id' && c !== 'environment');
        if (own.length !== 1 || refOwn.length !== 1) throw new SyncRefused(`${t} refers to itself in a way this copy does not handle.`);
        plan.selfRefs[t].push([own[0], refOwn[0]]);
      } else if (copySet.has(fk.ref)) {
        deps.get(t)!.add(fk.ref);
      } else if (fk.ref in NOT_COPIED && scope.includes(fk.ref)) {
        plan.droppedRefs[t].push(...own);
      } else if (copySet.has(t)) {
        throw new SyncRefused(`${t} refers to ${fk.ref}, which this copy does not handle.`);
      }
    }
    plan.excluded[t] = ['business_id', ...plan.userColumns[t], ...plan.droppedRefs[t]];
  }
  // Parents first (Kahn's algorithm, alphabetical among equals so the order is stable).
  const left = new Set(copySet);
  while (left.size) {
    const ready = [...left].filter((t) => [...deps.get(t)!].every((d) => !left.has(d))).sort();
    if (!ready.length) throw new SyncRefused(`circular references between ${[...left].join(', ')}.`);
    for (const t of ready) {
      plan.copy.push(t);
      left.delete(t);
    }
  }
  return plan;
}

async function tableFingerprint(tx: Tx, plan: Plan, table: string, businessId: string): Promise<TableFingerprint> {
  const ex = `array[${plan.excluded[table].map(lit).join(', ')}]::text[]`;
  const [r] = await tx.unsafe(
    `select count(*)::int as rows, md5(coalesce(string_agg(r, E'\\n' order by r collate "C"), '')) as md5
     from (select (to_jsonb(t.*) - ${ex})::text as r from ${q(table)} t where t.business_id = $1 and t.environment = '${ENVIRONMENT}') x`,
    [businessId],
  );
  return { rows: r.rows as number, md5: r.md5 as string };
}

/** The settings that are copied, as one canonical text (module row, HHMC flags, descriptive fields). */
async function settingsText(tx: Tx, businessId: string): Promise<string> {
  const [r] = await tx`select jsonb_build_object(
      'module', (select to_jsonb(m.*) - 'business_id' - 'updated_at' from business_modules m where m.business_id = ${businessId}),
      'flags', (select coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'enabled', f.enabled, 'description', f.description) order by f.key), '[]'::jsonb)
                from feature_flags f where f.business_id = ${businessId}),
      'business', (select jsonb_build_object('name', b.name, 'description', b.description, 'accent_color', b.accent_color,
                'secondary_color', b.secondary_color, 'time_zone', b.time_zone) from businesses b where b.id = ${businessId})
    )::text as t`;
  return r.t as string;
}

async function fingerprint(tx: Tx, plan: Plan, businessId: string): Promise<Fingerprint> {
  const tables: Record<string, TableFingerprint> = {};
  for (const t of plan.scope) tables[t] = await tableFingerprint(tx, plan, t, businessId);
  const [s] = await tx`select md5(${await settingsText(tx, businessId)}) as m`;
  return { tables, settings: s.m as string };
}

/** Tables (and "settings") whose fingerprint differs. A table missing on one side counts as empty. */
export function differences(a: Fingerprint, b: Fingerprint, only?: string[]): string[] {
  const names = only ?? [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort();
  const empty = { rows: 0, md5: EMPTY_MD5 };
  const out = names.filter((t) => {
    const x = a.tables[t] ?? empty;
    const y = b.tables[t] ?? empty;
    return x.rows !== y.rows || x.md5 !== y.md5;
  });
  if (a.settings !== b.settings) out.push('settings');
  return out;
}

function checkSameShape(plan: Plan, target: Plan) {
  const bad = plan.scope.filter((t) => plan.shape[t] !== target.shape[t]);
  if (bad.length) throw new SyncRefused(`the two databases' tables differ (${bad.join(', ')}). Update both to the same code first.`);
}

type Snapshot = {
  businessId: string;
  plan: Plan;
  fingerprint: Fingerprint;
  rows: Record<string, string[]>;
  module: Record<string, unknown> & { settings: string };
  flags: { key: string; enabled: boolean; description: string }[];
  business: Record<string, unknown>;
  users: Map<string, string>;
};

/** One consistent read of the source (repeatable read, read only). */
async function readSource(source: Sql): Promise<Snapshot> {
  return source.begin('isolation level repeatable read read only', async (tx) => {
    const businessId = await enter(tx);
    const plan = makePlan(await readSchema(tx));
    const rows: Record<string, string[]> = {};
    for (const t of plan.copy) {
      const r = await tx.unsafe(`select to_jsonb(t.*)::text as r from ${q(t)} t where t.business_id = $1 and t.environment = '${ENVIRONMENT}'`, [businessId]);
      rows[t] = r.map((x) => x.r as string);
    }
    const [module] = await tx`select module_key, enabled, staff_portal_enabled, customer_portal_enabled, field_portal_enabled,
      settings::text as settings, updated_at::text as updated_at from business_modules where business_id = ${businessId}`;
    if (!module) throw new SyncRefused('HHMC has no module settings in the source.');
    const flags = await tx<{ key: string; enabled: boolean; description: string }[]>`
      select key, enabled, description from feature_flags where business_id = ${businessId} order by key`;
    const [business] = await tx`select name, description, accent_color, secondary_color, time_zone from businesses where id = ${businessId}`;
    const users = new Map<string, string>();
    for (const u of await tx`select id::text as id, lower(email) as email from users`) users.set(u.id as string, u.email as string);
    return {
      businessId,
      plan,
      fingerprint: await fingerprint(tx, plan, businessId),
      rows,
      module: module as Snapshot['module'],
      flags: [...flags],
      business,
      users,
    };
  }) as Promise<Snapshot>;
}

export type CompareRow = { table: string; local: number; website: number; matches: boolean };
export type Comparison = {
  rows: CompareRow[];
  settingsMatch: boolean;
  allMatch: boolean;
  /** Files on each side (never copied). */
  files: { local: number; website: number };
  /** null: no copy recorded on the website; []: unchanged since the last copy; else what changed. */
  changedSinceLastCopy: string[] | null;
  lastCopyAt: string | null;
};

function comparison(plan: Plan, src: Fingerprint, dst: Fingerprint, stored: StoredSync | null): Comparison {
  const rows = plan.copy.map((t) => {
    const a = src.tables[t];
    const b = dst.tables[t];
    return { table: t, local: a.rows, website: b.rows, matches: a.rows === b.rows && a.md5 === b.md5 };
  });
  const settingsMatch = src.settings === dst.settings;
  return {
    rows,
    settingsMatch,
    allMatch: settingsMatch && rows.every((r) => r.matches),
    files: { local: src.tables.files?.rows ?? 0, website: dst.tables.files?.rows ?? 0 },
    changedSinceLastCopy: stored ? differences(stored.fingerprint, dst) : null,
    lastCopyAt: stored?.syncedAt ?? null,
  };
}

async function readStored(tx: Tx): Promise<StoredSync | null> {
  const [r] = await tx`select value::text as v from platform_settings where key = ${SYNC_KEY}`;
  return r ? (JSON.parse(r.v as string) as StoredSync) : null;
}

/** --check: compares the two databases. Read-only transactions on both sides; writes nothing. */
export async function compareDatabases(source: Sql, target: Sql): Promise<Comparison> {
  const src = await source.begin('isolation level repeatable read read only', async (tx) => {
    const businessId = await enter(tx);
    const plan = makePlan(await readSchema(tx));
    return { plan, fp: await fingerprint(tx, plan, businessId) };
  });
  return target.begin('isolation level repeatable read read only', async (tx) => {
    const businessId = await enter(tx);
    checkSameShape(src.plan, makePlan(await readSchema(tx)));
    const dst = await fingerprint(tx, src.plan, businessId);
    return comparison(src.plan, src.fp, dst, await readStored(tx));
  }) as Promise<Comparison>;
}

export type SyncResult = {
  comparison: Comparison;
  copied: Record<string, number>;
  /** Activity log entries already on the website (kept: the log is append-only). */
  logAlreadyThere: number;
  userRefs: { mapped: number; unmapped: number };
  fileRefsCleared: number;
  firstCopy: boolean;
};

/** Parents before children within one table (single-column self references). */
function orderSelf(rows: string[], parsed: Record<string, unknown>[], refs: [string, string][]): string[] {
  if (!refs.length) return rows;
  const out: string[] = [];
  const done = new Set<unknown>();
  let left = rows.map((r, i) => ({ r, p: parsed[i] }));
  while (left.length) {
    const ready = left.filter(({ p }) => refs.every(([c, ref]) => p[c] == null || done.has(p[c]) || !left.some((o) => o.p[ref] === p[c] && o.p !== p)));
    if (!ready.length) throw new SyncRefused('rows refer to each other in a circle; this copy cannot order them.');
    for (const x of ready) {
      out.push(x.r);
      for (const [, ref] of refs) done.add(x.p[ref]);
    }
    left = left.filter((x) => !ready.includes(x));
  }
  return out;
}

/**
 * Replace the target's HHMC live data and settings with the source's, in ONE transaction on the
 * target, then check every table matches and store the target's fingerprint. Any refusal or
 * error rolls everything back: the target is unchanged.
 */
export async function syncDatabases(source: Sql, target: Sql, opts: { firstCopy?: boolean } = {}): Promise<SyncResult> {
  const src = await readSource(source);
  const { plan } = src;
  return target.begin(async (tx) => {
    const businessId = await enter(tx);
    checkSameShape(plan, makePlan(await readSchema(tx)));
    // Nobody may change HHMC data or settings while this runs (reads still work). sai_app may not
    // take this lock on the append-only activity log; every change to a record also locks its table.
    await tx`set local lock_timeout = '20s'`;
    const locked = [...plan.scope.filter((t) => !APPEND_ONLY.has(t)), 'business_modules', 'feature_flags', 'businesses', 'platform_settings'];
    await tx.unsafe(`lock table ${locked.map(q).join(', ')} in exclusive mode`);

    // 1. Has anyone changed the website since the last copy?
    const before = await fingerprint(tx, plan, businessId);
    const stored = await readStored(tx);
    let firstCopy = false;
    if (stored) {
      const changed = differences(stored.fingerprint, before);
      if (changed.length)
        throw new SyncRefused(
          `the website's HHMC data changed since the last copy (${stored.syncedAt}) in: ${changed.join(', ')}. ` +
            'Managers may have used it; from now on the website is the master copy. Nothing was changed.',
        );
    } else {
      const holding = plan.scope.filter((t) => before.tables[t].rows > 0);
      if (holding.length) {
        if (!opts.firstCopy)
          throw new SyncRefused(
            `no copy has been recorded on the website, but its HHMC live data is not empty (${holding.join(', ')}). ` +
              'If nobody has used the website yet, run again with --first-copy. Nothing was changed.',
          );
        const [used] = await tx`select count(*)::int as n from activity_log
          where business_id = ${businessId} and environment = ${ENVIRONMENT} and actor_user_id in (select id from users)`;
        if (used.n > 0)
          throw new SyncRefused(
            `the website's HHMC activity log has ${used.n} entries made by people signed in to it: it has been used, ` +
              'so it is now the master copy. Nothing was changed.',
          );
        firstCopy = true;
      }
    }

    // 2. The activity log can only grow: every website entry must also be on the laptop.
    const parsed: Record<string, Record<string, unknown>[]> = {};
    for (const t of plan.copy) parsed[t] = src.rows[t].map((r) => JSON.parse(r) as Record<string, unknown>);
    const already = new Map<string, Set<string>>();
    for (const t of plan.copy.filter((x) => APPEND_ONLY.has(x))) {
      const ids = new Set((await tx.unsafe(`select id::text as id from ${q(t)} where business_id = $1 and environment = '${ENVIRONMENT}'`, [businessId])).map((r) => r.id as string));
      const mine = new Set(parsed[t].map((p) => String(p.id)));
      const extra = [...ids].filter((id) => !mine.has(id)).length;
      if (extra)
        throw new SyncRefused(
          `the website's ${t} has ${extra} HHMC live entries that are not on this laptop. The log can never be deleted, ` +
            'so the website cannot be made to match. Nothing was changed.',
        );
      already.set(t, ids);
    }

    // 3. Users by email.
    const targetUsers = new Map<string, string>();
    for (const u of await tx`select id::text as id, lower(email) as email from users`) targetUsers.set(u.email as string, u.id as string);
    const userMap: Record<string, string> = {};
    for (const [id, email] of src.users) if (targetUsers.has(email)) userMap[id] = targetUsers.get(email)!;
    const userRefs = { mapped: 0, unmapped: 0 };
    let fileRefsCleared = 0;
    for (const t of plan.copy)
      for (const p of parsed[t]) {
        for (const c of plan.userColumns[t]) if (p[c] != null) userRefs[userMap[String(p[c])] ? 'mapped' : 'unmapped'] += 1;
        for (const c of plan.droppedRefs[t]) if (p[c] != null) fileRefsCleared += 1;
      }

    // 4. Replace: children first out, parents first in.
    for (const t of [...plan.copy].reverse())
      if (!APPEND_ONLY.has(t)) await tx.unsafe(`delete from ${q(t)} where business_id = $1 and environment = '${ENVIRONMENT}'`, [businessId]);
    const copied: Record<string, number> = {};
    let logAlreadyThere = 0;
    const mapText = JSON.stringify(userMap);
    for (const t of plan.copy) {
      let rows = src.rows[t];
      let rowsParsed = parsed[t];
      const have = already.get(t);
      if (have) {
        const keep = rowsParsed.map((p) => !have.has(String(p.id)));
        logAlreadyThere += keep.filter((k) => !k).length;
        rows = rows.filter((_, i) => keep[i]);
        rowsParsed = rowsParsed.filter((_, i) => keep[i]);
      }
      rows = orderSelf(rows, rowsParsed, plan.selfRefs[t]);
      const cols = plan.columns[t].map(q).join(', ');
      const changes = [
        `'business_id', to_jsonb($2::uuid)`,
        ...plan.userColumns[t].map((c) => `${lit(c)}, ($3::text)::jsonb -> (r ->> ${lit(c)})`),
        ...plan.droppedRefs[t].map((c) => `${lit(c)}, null::jsonb`),
      ].join(', ');
      const insert = `insert into ${q(t)} (${cols}) overriding system value
        select ${cols} from jsonb_populate_recordset(null::${q(t)}, (
          select coalesce(jsonb_agg(r || jsonb_build_object(${changes}) order by n), '[]'::jsonb)
          from jsonb_array_elements(($1::text)::jsonb) with ordinality e(r, n)))`;
      for (let i = 0; i < rows.length; i += BATCH)
        await tx.unsafe(insert, [`[${rows.slice(i, i + BATCH).join(',')}]`, businessId, mapText]);
      copied[t] = rows.length;
    }

    // 5. Settings: the module row, HHMC's feature flags, the descriptive fields (never id or slug).
    const m = src.module;
    const updated = await tx`update business_modules set enabled = ${m.enabled as boolean}, staff_portal_enabled = ${m.staff_portal_enabled as boolean},
      customer_portal_enabled = ${m.customer_portal_enabled as boolean}, field_portal_enabled = ${m.field_portal_enabled as boolean},
      settings = (${m.settings}::text)::jsonb, updated_at = (${m.updated_at as string}::text)::timestamptz
      where business_id = ${businessId} and module_key = ${m.module_key as string}`;
    if (updated.count !== 1) throw new SyncRefused('HHMC runs a different module on the website. Nothing was changed.');
    await tx`delete from feature_flags where business_id = ${businessId}`;
    for (const f of src.flags)
      await tx`insert into feature_flags (key, business_id, enabled, description) values (${f.key}, ${businessId}, ${f.enabled}, ${f.description})`;
    const b = src.business;
    await tx`update businesses set name = ${b.name as string}, description = ${b.description as string}, accent_color = ${b.accent_color as string},
      secondary_color = ${(b.secondary_color as string | null) ?? null}, time_zone = ${b.time_zone as string} where id = ${businessId}`;

    // 6. Every copied table and the settings must now match, or nothing is kept.
    const after = await fingerprint(tx, plan, businessId);
    const wrong = differences(src.fingerprint, after, plan.copy);
    if (wrong.length) throw new Error(`Copy check failed: ${wrong.join(', ')} did not match after writing. Rolled back; the website is unchanged.`);
    const record: StoredSync = { version: 1, syncedAt: new Date().toISOString(), fingerprint: after };
    await tx`insert into platform_settings (key, value, updated_at) values (${SYNC_KEY}, (${JSON.stringify(record)}::text)::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
    return {
      comparison: comparison(plan, src.fingerprint, after, record),
      copied,
      logAlreadyThere,
      userRefs,
      fileRefsCleared,
      firstCopy,
    };
  }) as Promise<SyncResult>;
}

/** "table · local rows · website rows · matches", for the terminal. */
export function formatComparison(c: Comparison): string {
  const w = Math.max(...c.rows.map((r) => r.table.length), 'files (not copied)'.length);
  const line = (a: string, b: string, d: string, e: string) => `  ${a.padEnd(w)}  ${b.padStart(11)}  ${d.padStart(13)}  ${e}`;
  return [
    line('table', 'local rows', 'website rows', 'matches'),
    ...c.rows.map((r) => line(r.table, String(r.local), String(r.website), r.matches ? 'yes' : 'NO')),
    line('settings', '', '', c.settingsMatch ? 'yes' : 'NO'),
    line('files (not copied)', String(c.files.local), String(c.files.website), '-'),
  ].join('\n');
}
