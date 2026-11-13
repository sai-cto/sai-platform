/**
 * Every HHMC dashboard number equals straight SQL over the tables (scripts/lib/hhmc-numbers.ts),
 * on the test database's HHMC data (seeded moves, everything the other tests made, and the
 * Movegistics fixture import). Plus: the overview's upcoming count, the 7-day widget and the
 * dashboard's booked moves share one definition, and system (import) entries are not "changes".
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { activityCount } from '@/core/analytics/analytics';
import { listBusinessActivity } from '@/core/audit/read';
import { withScope, type Scope } from '@/core/db/scope';
import { localDate } from '@/modules/hhmc/rules';
import { conversionPercent, dashboardSummary, upcomingMoves } from '@/modules/hhmc/services/dashboard';
import { loadIntoHhmc } from '../../scripts/hhmc-import/load';
import { FILE_NAMES, normalize, type Files } from '../../scripts/hhmc-import/movegistics';
import { compareNumbers, dashboardNumbers, sqlNumbers } from '../../scripts/lib/hhmc-numbers';
import { ctxFor, systemContext, USERS } from './helpers';

const fixture = (() => {
  const dir = path.resolve(__dirname, '../fixtures/movegistics');
  return Object.fromEntries(Object.entries(FILE_NAMES).map(([k, f]) => [k, fs.readFileSync(path.join(dir, f), 'utf8')])) as Files;
})();

async function withOwner<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.TEST_DATABASE_OWNER_URL as string, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

const importAs = async (files: Files) => {
  const system = await systemContext('hhmc', 'live');
  return loadIntoHhmc(<T,>(fn: (s: Scope) => Promise<T>) => withScope(system, 'hhmc.import.run', fn), normalize(files));
};

describe('every dashboard number equals direct SQL', () => {
  it('leads, enquiries, conversion, estimates, bookings, moves, invoiced, collected, open and past due', async () => {
    await importAs(fixture);
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    const now = new Date();
    const today = localDate(now, gm.business.timeZone);
    const shown = await withScope(gm, 'hhmc.jobs.read', (s) => dashboardNumbers(s, now));
    const direct = await withOwner((sql) => sqlNumbers(sql, gm.business.id, 'live', today));
    expect(compareNumbers(shown, direct).filter((r) => r.dashboard !== r.sql)).toEqual([]);
    // Something real is being compared, not zeros.
    expect(direct.invoicedCount).toBeGreaterThan(0);
    expect(direct.collectedCents).toBeGreaterThan(0);
    expect(direct.enquiries).toBeGreaterThan(direct.leads); // imported work requests count as enquiries
  });

  it('the same in test mode', async () => {
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'sandbox');
    const now = new Date();
    const shown = await withScope(gm, 'hhmc.jobs.read', (s) => dashboardNumbers(s, now));
    const direct = await withOwner((sql) => sqlNumbers(sql, gm.business.id, 'sandbox', localDate(now, gm.business.timeZone)));
    expect(compareNumbers(shown, direct).filter((r) => r.dashboard !== r.sql)).toEqual([]);
  });

  it('conversion is the share of enquiries that became work requests', async () => {
    expect(conversionPercent(0, 0)).toBe(0);
    expect(conversionPercent(1, 3)).toBe(33);
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    const d = await withScope(gm, 'hhmc.jobs.read', (s) => dashboardSummary(s, { from: null, to: null }));
    expect(d.leads!.conversionPercent).toBe(conversionPercent(d.leads!.converted, d.leads!.enquiries));
    expect(d.leads!.conversionPercent).toBeGreaterThan(0);
  });

  it("upcoming moves, the 7-day widget and the dashboard's booked moves use one definition", async () => {
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    const now = new Date();
    const today = localDate(now, gm.business.timeZone);
    const [all, week, fromToday] = await withScope(gm, 'hhmc.jobs.read', async (s) => [
      await upcomingMoves(s, now),
      await upcomingMoves(s, now, 7),
      (await dashboardSummary(s, { from: today, to: '2999-12-31' }, now)).moves,
    ]);
    expect(all).toBe(fromToday);
    expect(week).toBeLessThanOrEqual(all);
  });
});

describe('the importer and other system jobs are not "changes"', () => {
  it('activity lists and counts leave out system entries; the import log shows only them', async () => {
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    const range = { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 3600_000) };
    const before = await withScope(gm, 'business.activity.read', (s) => activityCount(s, range));
    await importAs({ ...fixture, contacts: fixture.contacts.replace('"CN900001","Avery","Fixture"', '"CN900001","Avery","Fixturely"') });
    const after = await withScope(gm, 'business.activity.read', (s) => activityCount(s, range));
    expect(after).toBe(before);
    const people = await listBusinessActivity(gm, { limit: 200 });
    expect(people.rows.every((r) => r.actorUserId !== null || r.actorRole === 'customer_link')).toBe(true);
    const imports = await listBusinessActivity(gm, { actors: 'system', limit: 50 });
    expect(imports.rows.length).toBeGreaterThan(0);
    expect(imports.rows.every((r) => r.actorUserId === null && r.actorRole !== 'customer_link')).toBe(true);
    await importAs(fixture);
  });
});
