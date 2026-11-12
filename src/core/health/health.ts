/** System health checks, shown in Platform → System health and at /api/health. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { OAUTH_PROVIDERS, isDevLoginEnabled } from '../auth/login';
import { getDb } from '../db/client';
import { withScope } from '../db/scope';
import type { HealthCheck } from '../modules/contract';
import { getModule, getModules, validateRegistry } from '../modules/registry';
import { authorize } from '../rbac/permissions';
import {
  buildBusinessContext,
  listAccessibleBusinesses,
  type PlatformContext,
} from '../tenancy/context';

export async function pingDatabase(): Promise<{ ok: boolean; detail: string }> {
  try {
    const started = Date.now();
    await getDb().execute(sql`select 1`);
    return { ok: true, detail: `Responded in ${Date.now() - started} ms` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Unreachable' };
  }
}

export type HealthGroup = { title: string; checks: HealthCheck[] };

async function check(
  name: string,
  fn: () => Promise<{ ok: boolean; detail: string }>,
): Promise<HealthCheck> {
  try {
    return { name, ...(await fn()) };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : 'Check failed' };
  }
}

export async function runHealthChecks(ctx: PlatformContext): Promise<HealthGroup[]> {
  authorize(ctx, 'platform.health.read');
  const db = getDb();

  const database: HealthCheck[] = [
    { name: 'Database reachable', ...(await pingDatabase()) },
    await check('App uses the restricted database role', async () => {
      const [role] = [
        ...(await db.execute<{ name: string; rolsuper: boolean; rolbypassrls: boolean }>(
          sql`select rolname as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
        )),
      ];
      const ok = Boolean(role) && !role.rolsuper && !role.rolbypassrls;
      return {
        ok,
        detail: ok
          ? `Connected as ${role.name}; cannot bypass row-level security`
          : `Connected as ${role?.name}: this role can bypass business separation`,
      };
    }),
    await check('Every business table has row-level security', async () => {
      const rows = [
        ...(await db.execute<{ name: string; rls: boolean }>(sql`
        select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and exists (select 1 from information_schema.columns col where col.table_name = c.relname and col.column_name = 'archived_at')`)),
      ];
      const unprotected = rows.filter((r) => !r.rls).map((r) => r.name);
      return {
        ok: unprotected.length === 0,
        detail:
          unprotected.length === 0
            ? `${rows.length} tables protected`
            : `Not protected: ${unprotected.join(', ')}`,
      };
    }),
    await check('Activity log is append-only', async () => {
      const rows = [
        ...(await db.execute<{ n: number }>(
          sql`select count(*)::int as n from pg_trigger where tgrelid = 'activity_log'::regclass and not tgisinternal`,
        )),
      ];
      return {
        ok: rows[0].n >= 2,
        detail:
          rows[0].n >= 2
            ? 'Update, delete and truncate are blocked by triggers'
            : 'Protection triggers are missing',
      };
    }),
  ];

  const problems = validateRegistry();
  const businesses = await listAccessibleBusinesses(ctx.actor.id as string);
  const missing = businesses.filter((b) => !getModule(b.slug)).map((b) => b.code);
  const modules: HealthCheck[] = [
    {
      name: 'Module registry is valid',
      ok: problems.length === 0,
      detail:
        problems.length === 0 ? `${getModules().length} modules registered` : problems.join(' '),
    },
    {
      name: 'Every business has a module',
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `${businesses.length} of ${businesses.length}`
          : `No module registered for: ${missing.join(', ')}`,
    },
  ];
  for (const b of businesses) {
    const mod = getModule(b.slug);
    if (!mod?.healthChecks) continue;
    const businessCtx = await buildBusinessContext({ userId: ctx.actor.id as string, actingBy: ctx.actor.actingBy }, b.slug, 'live');
    const results = await withScope(businessCtx, 'business.overview.read', (s) =>
      mod.healthChecks!(s),
    );
    modules.push(...results.map((r) => ({ ...r, name: `${b.code}: ${r.name}` })));
  }

  const storageDir = path.resolve(process.env.FILE_STORAGE_DIR || './storage');
  const adapters: HealthCheck[] = [
    {
      name: 'Payments',
      ok: true,
      detail:
        process.env.PAYMENT_PROVIDER === 'stripe'
          ? 'Stripe adapter, test mode only (the sandbox always uses the mock)'
          : 'Mock provider: no real money moves',
    },
    {
      name: 'Email',
      ok: true,
      detail: 'Console adapter: emails are printed to the server log, not sent',
    },
    await check('File storage', async () => {
      await fs.mkdir(storageDir, { recursive: true });
      await fs.access(storageDir, fs.constants.W_OK);
      return { ok: true, detail: 'Local disk folder is writable' };
    }),
  ];

  const signIn: HealthCheck[] = [
    {
      name: 'Dev login',
      ok: true,
      detail: isDevLoginEnabled() ? 'ON — for local development only' : 'Off',
    },
    ...OAUTH_PROVIDERS.map((p) => ({
      name: p.label,
      ok: true,
      detail: p.isEnabled() ? 'Configured' : 'Built, not configured',
    })),
  ];

  return [
    { title: 'Database', checks: database },
    { title: 'Modules', checks: modules },
    { title: 'Adapters', checks: adapters },
    { title: 'Sign-in', checks: signIn },
  ];
}
