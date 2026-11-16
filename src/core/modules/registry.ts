/**
 * Read access to the list of modules. This is the one place the core looks at src/modules:
 * it imports the list, never an individual module.
 */
import { getTableName } from 'drizzle-orm';
import { MODULES } from '@/modules/registry';
import type { EntityDef, ModuleManifest } from './contract';
import { CORE_ACTIONS } from '../rbac/actions';
import { LINK_ALLOWED_CORE_PERMISSIONS } from '../links/allowed';
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

/** Problems that would make the registry unsafe to run with. Checked by a test and by system health. */
export function validateRegistry(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const coreActionKeys = new Set(CORE_ACTIONS.map((a) => a.key));
  const entityKeys = new Set<string>(CORE_ENTITIES.map((e) => e.key));
  for (const mod of MODULES) {
    if (seen.has(mod.key)) problems.push(`Module key "${mod.key}" is registered twice.`);
    seen.add(mod.key);
    const permissionKeys = new Set(mod.permissions.map((p) => p.key));
    for (const p of mod.permissions) {
      if (!p.key.startsWith(`${mod.key}.`))
        problems.push(`Permission "${p.key}" must start with "${mod.key}.".`);
      if (coreActionKeys.has(p.key))
        problems.push(`Permission "${p.key}" clashes with a core action.`);
    }
    const known = (permission: string) =>
      permissionKeys.has(permission) || coreActionKeys.has(permission);
    for (const e of mod.entities) {
      if (!e.key.startsWith(`${mod.key}.`))
        problems.push(`Entity "${e.key}" must start with "${mod.key}.".`);
      if (entityKeys.has(e.key)) problems.push(`Entity "${e.key}" is defined twice.`);
      if (!getTableName(e.table).startsWith(`${mod.key}_`))
        problems.push(
          `Table "${getTableName(e.table)}" of entity "${e.key}" must start with "${mod.key}_".`,
        );
      entityKeys.add(e.key);
      for (const permission of [e.readPermission, e.writePermission]) {
        if (!known(permission))
          problems.push(`Entity "${e.key}" uses unknown permission "${permission}".`);
      }
    }
    for (const portal of [mod.portals.staff, mod.portals.customer, mod.portals.field]) {
      for (const route of portal?.routes ?? []) {
        if (route.path.startsWith('/'))
          problems.push(`Route "${route.path}" in ${mod.key} must not start with "/".`);
        if (!known(route.permission))
          problems.push(
            `Route "${route.path}" in ${mod.key} uses unknown permission "${route.permission}".`,
          );
      }
    }
    for (const widget of mod.widgets) {
      if (!known(widget.permission))
        problems.push(
          `Widget "${widget.key}" in ${mod.key} uses unknown permission "${widget.permission}".`,
        );
    }
    // Customer links: a purpose may hold only its module's permissions and a short list of
    // core ones (never people, settings, data export or deletion).
    const linkCore = new Set<string>(LINK_ALLOWED_CORE_PERMISSIONS);
    for (const purpose of mod.linkPurposes ?? []) {
      if (!purpose.key.startsWith(`${mod.key}.`))
        problems.push(`Link purpose "${purpose.key}" must start with "${mod.key}.".`);
      if (!mod.portals.customer)
        problems.push(`Module ${mod.key} has link purposes but no customer portal to show them.`);
      for (const permission of purpose.permissions) {
        if (!permissionKeys.has(permission) && !linkCore.has(permission))
          problems.push(
            `Link purpose "${purpose.key}" may not hold "${permission}" (only ${mod.key} permissions and ${[...linkCore].join(', ')}).`,
          );
      }
    }
    // Public intakes: a website without an account may hold only this module's permissions.
    for (const intake of mod.publicIntakes ?? []) {
      if (!intake.key.startsWith(`${mod.key}.`))
        problems.push(`Public intake "${intake.key}" must start with "${mod.key}.".`);
      for (const permission of intake.permissions) {
        if (!permissionKeys.has(permission))
          problems.push(`Public intake "${intake.key}" may not hold "${permission}" (only ${mod.key} permissions).`);
      }
    }
    for (const task of mod.scheduledTasks ?? []) {
      if (!task.key.startsWith(`${mod.key}.`))
        problems.push(`Scheduled task "${task.key}" must start with "${mod.key}.".`);
      if (task.settingKey && typeof mod.settings?.defaults[task.settingKey] !== 'boolean')
        problems.push(`Scheduled task "${task.key}" names setting "${task.settingKey}", which is not a yes/no setting of ${mod.key}.`);
    }
    if (mod.workItem && !mod.entities.some((e) => e.key === mod.workItem?.entityKey)) {
      problems.push(
        `Module ${mod.key}: workItem.entityKey "${mod.workItem.entityKey}" is not one of its entities.`,
      );
    }
  }
  return problems;
}
