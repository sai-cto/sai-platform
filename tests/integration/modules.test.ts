/**
 * The module system: all nine businesses have a registered module, the registry is valid,
 * the template follows the contract, and nothing outside src/modules names a business.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/core/db/client';
import { ValidationError } from '@/core/errors';
import { getModuleConfig, isPortalAvailable, setPortalEnabled, updateModuleSettings } from '@/core/modules/config';
import { matchRoute } from '@/core/modules/portal';
import { entitiesFor, getModule, getModules, validateRegistry } from '@/core/modules/registry';
import { moduleRegistryReport } from '@/core/modules/report';
import { businessActions } from '@/core/rbac/permissions';
import { templateModule } from '@/modules/_template/manifest';
import { SEED_BUSINESSES } from '@/seed/businesses';
import { USERS, ctxFor, logFor, platformCtxFor } from './helpers';

const root = path.resolve(__dirname, '../..');

describe('the nine modules', () => {
  it('every seeded business has a registered module with the same key, and the registry is valid', () => {
    expect(getModules().map((m) => m.key)).toEqual(SEED_BUSINESSES.map((b) => b.slug));
    expect(validateRegistry()).toEqual([]);
  });

  it.each(SEED_BUSINESSES.map((b) => b.slug))('%s registers through the contract and has a staff portal home page', (slug) => {
    const mod = getModule(slug)!;
    expect(mod.name.length).toBeGreaterThan(3);
    expect(mod.description.length).toBeGreaterThan(10);
    expect(mod.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(['scaffold', 'in_development', 'live']).toContain(mod.status);
    const home = matchRoute(mod.portals.staff, []);
    expect(home, 'staff portal needs a "" route').not.toBeNull();
    // Whatever permission guards the home page must be one that exists in this business.
    expect(businessActions(slug).map((a) => a.key)).toContain(home!.route.permission);
    for (const entity of mod.entities) expect(entitiesFor(slug)).toContain(entity);
  });

  it('HHMC and Real Estate are scaffolds whose scope is "pending requirements" — nothing is built for them', () => {
    for (const slug of ['hhmc', 'sare']) {
      const mod = getModule(slug)!;
      expect(mod.status).toBe('scaffold');
      expect(mod.plannedScope).toEqual(['Pending requirements']);
      expect(mod.entities).toEqual([]);
      expect(mod.permissions).toEqual([]);
      expect(mod.portals.staff.routes).toHaveLength(1);
      expect(mod.portals.customer).toBeUndefined();
      expect(mod.portals.field).toBeUndefined();
      // The module's folder holds only its manifest and README.
      expect(fs.readdirSync(path.join(root, 'src/modules', slug)).sort()).toEqual(['README.md', 'manifest.ts']);
    }
  });

  it('the registry report shows all nine as registered', async () => {
    const report = await moduleRegistryReport(await platformCtxFor(USERS.tech));
    expect(report.problems).toEqual([]);
    expect(report.registered).toBe(9);
    expect(report.installed.every((row) => row.manifest && row.portals.staff.built && row.portals.staff.on)).toBe(true);
    expect(report.installed.every((row) => !row.portals.customer.built && !row.portals.field.built)).toBe(true);
  });
});

describe('portal switches and settings', () => {
  it('the staff portal can be switched off and on by tech, and both changes are logged under live', async () => {
    const tech = await ctxFor(USERS.tech, 'cp', 'sandbox'); // even from test mode
    const started = new Date(Date.now() - 1000);
    await setPortalEnabled(tech, 'staff', false);
    expect(await isPortalAvailable(tech.business.id, 'staff')).toBe(false);
    expect((await getModuleConfig(tech)).portals.staff).toBe(false);
    await setPortalEnabled(tech, 'staff', true);
    expect(await isPortalAvailable(tech.business.id, 'staff')).toBe(true);
    const entries = (await logFor('module.portal', 'cp.staff', started)).reverse();
    expect(entries.map((e) => [e.action, e.environment, e.after])).toEqual([
      ['settings_change', 'live', { staff: false }],
      ['settings_change', 'live', { staff: true }],
    ]);
  });

  it('a portal the module has not built cannot be switched on; a module without settings has none to change', async () => {
    const tech = await ctxFor(USERS.tech, 'cp');
    for (const portal of ['customer', 'field'] as const) {
      await expect(setPortalEnabled(tech, portal, true)).rejects.toBeInstanceOf(ValidationError);
      expect(await isPortalAvailable(tech.business.id, portal)).toBe(false);
    }
    await expect(updateModuleSettings(tech, { anything: 1 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('the module template (src/modules/_template)', () => {
  it('follows the contract but is not registered and has no table in the database', async () => {
    expect(getModules()).not.toContain(templateModule);
    const keys = new Set(templateModule.permissions.map((p) => p.key));
    expect([...keys].every((k) => k.startsWith('template.'))).toBe(true);
    for (const entity of templateModule.entities) {
      expect(entity.key.startsWith('template.')).toBe(true);
      expect(keys.has(entity.readPermission) && keys.has(entity.writePermission)).toBe(true);
    }
    for (const route of templateModule.portals.staff.routes) expect(keys.has(route.permission)).toBe(true);
    expect(templateModule.settings!.schema.safeParse(templateModule.settings!.defaults).success).toBe(true);
    const tables = [...(await getDb().execute<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_name like 'template_%'`))];
    expect(tables[0].n).toBe(0);
  });
});

describe('businesses are data, never code', () => {
  // Outside src/modules (one folder per business) and src/seed (the data itself), no file may
  // name a business: not its slug, its short code or its name. This is what makes "add a tenth
  // business" need no change to the core or the console.
  const names = SEED_BUSINESSES.map((b) => b.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const quotedKeys = SEED_BUSINESSES.flatMap((b) => [b.slug, b.code]).join('|');
  const pattern = new RegExp(`['"\`/](${quotedKeys})['"\`/]|${names.join('|')}`);

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx|css)$/.test(entry.name) ? [full] : [];
    });
  }

  it.each(['src/core', 'src/app', 'src/ui'])('no business is named in %s', (dir) => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(root, dir))) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (pattern.test(line)) offenders.push(`${path.relative(root, file)}:${index + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
