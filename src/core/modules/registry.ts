/**
 * Read access to the list of modules. This is the one place the core looks at src/modules:
 * it imports the list, never an individual module.
 */
import { MODULES } from '@/modules/registry';
import type { EntityDef, ModuleManifest } from './contract';
import { CORE_ENTITIES } from '../records/core-entities';

export function getModules(): ModuleManifest[] {
  return MODULES;
}

export function getModule(key: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.key === key);
}

/** Entities available inside one business: the shared core's plus its module's. */
export function entitiesFor(moduleKey: string | null): EntityDef[] {
  const mod = moduleKey ? getModule(moduleKey) : undefined;
  return [...CORE_ENTITIES, ...(mod?.entities ?? [])];
}

export function findEntity(moduleKey: string | null, entityKey: string): EntityDef | undefined {
  return entitiesFor(moduleKey).find((e) => e.key === entityKey);
}

/** Problems that would make the registry unsafe to run with. Checked by a test and by health. */
export function validateRegistry(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const mod of MODULES) {
    if (seen.has(mod.key)) problems.push(`Module key "${mod.key}" is registered twice.`);
    seen.add(mod.key);
    for (const p of mod.permissions) {
      if (!p.key.startsWith(`${mod.key}.`))
        problems.push(`Permission "${p.key}" must start with "${mod.key}.".`);
    }
    const permissionKeys = new Set(mod.permissions.map((p) => p.key));
    for (const e of mod.entities) {
      if (!e.key.startsWith(`${mod.key}.`))
        problems.push(`Entity "${e.key}" must start with "${mod.key}.".`);
      for (const perm of [e.readPermission, e.writePermission]) {
        if (!permissionKeys.has(perm) && !perm.includes('.'))
          problems.push(`Entity "${e.key}" uses unknown permission "${perm}".`);
      }
    }
    for (const portal of [mod.portals.staff, mod.portals.customer, mod.portals.field]) {
      for (const route of portal?.routes ?? []) {
        if (route.path.startsWith('/'))
          problems.push(`Route "${route.path}" in ${mod.key} must not start with "/".`);
      }
    }
  }
  return problems;
}
