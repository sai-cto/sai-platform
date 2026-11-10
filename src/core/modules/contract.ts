/**
 * THE MODULE CONTRACT. A business module is a folder under src/modules/<key>/ that exports
 * one ModuleManifest. The console, data browser, importer, permissions, sandbox and
 * dashboards are all driven by manifests; none of them contain business names.
 *
 * How to write one: docs/MODULE_GUIDE.md.
 */
import type { ComponentType, ReactNode } from 'react';
import type { z } from 'zod';
import type { Scope } from '../db/scope';
import type { TenantTable } from '../records/types';
import type { BusinessContext } from '../tenancy/context';

/** A permission the module defines, e.g. { key: 'brss.orders.read', kind: 'read' }. */
export type PermissionDef = {
  /** Must start with "<module key>." */
  key: string;
  label: string;
  kind: 'read' | 'write';
  /** Switched on automatically when a business_admin adds a new staff member. */
  defaultForStaff: boolean;
};

/** One column shown in the Data browser and CSV export. */
export type ListColumn = {
  /** Property name on the row (camelCase). */
  key: string;
  label: string;
  format?: 'text' | 'money' | 'date' | 'datetime' | 'boolean';
};

/** A field a CSV column can be mapped to in the import tool. */
export type ImportField = { key: string; label: string; required: boolean };

/**
 * A table the platform should know about: it appears in the Data tab (browse, search, export,
 * archive, restore, purge), is covered by the tenant-isolation tests, and can be imported into.
 */
export type EntityDef<T extends TenantTable = TenantTable> = {
  /** Globally unique, "<owner>.<name>", e.g. "core.customer" or "brss.order". */
  key: string;
  label: string;
  labelPlural: string;
  table: T;
  readPermission: string;
  writePermission: string;
  /** Short human name for one row, used in the activity log ("Archived customer 'Ana Lee'"). */
  titleOf: (row: Record<string, unknown>) => string;
  listColumns: ListColumn[];
  /** Property names searched by the Data tab's search box. */
  searchColumns: string[];
  /**
   * Clean-up outside the database after a row is permanently deleted (for example removing
   * a stored file's bytes). Most entities do not need this.
   */
  afterPurge?: (row: Record<string, unknown>) => Promise<void>;
  /** Present = the import tool can create these from a CSV. */
  import?: {
    fields: ImportField[];
    /** Turns one mapped CSV row into values for createRecord. Throw ValidationError to reject. */
    toValues: (row: Record<string, string>) => Record<string, unknown>;
  };
};

export type NavItem = { label: string; path: string };

/** What a portal page receives. */
export type PortalPageProps = {
  ctx: BusinessContext;
  /** Values captured from ":name" parts of the route path. */
  params: Record<string, string>;
  searchParams: Record<string, string | undefined>;
  /** Prefix for links inside the portal, e.g. "/console/brss/live/app". */
  basePath: string;
};

export type RouteDef = {
  /** Path inside the portal. "" is the portal home. ":id" captures a value. */
  path: string;
  title: string;
  /** The permission needed to open this page. */
  permission: string;
  component: ComponentType<PortalPageProps>;
};

export type PortalDef = { nav: NavItem[]; routes: RouteDef[] };

/** A key number on the business Overview tab. */
export type WidgetDef = {
  key: string;
  label: string;
  permission: string;
  /** Returns the value to display, already formatted, plus an optional hint line. */
  load: (s: Scope) => Promise<{ value: string; hint?: string }>;
};

export type HealthCheck = { name: string; ok: boolean; detail: string };

export type ModuleManifest = {
  /** Must equal the slug of the business this module serves, e.g. "brss". */
  key: string;
  name: string;
  version: string;
  status: 'scaffold' | 'in_development' | 'live';
  description: string;
  /** Shown on the "not built yet" page and in the module registry. */
  plannedScope: string[];

  permissions: PermissionDef[];
  entities: EntityDef[];
  portals: {
    staff: PortalDef;
    /** Absent = this module has no customer portal yet. */
    customer?: PortalDef;
    /** Absent = this module has no field (mobile crew) portal yet. */
    field?: PortalDef;
  };
  widgets: WidgetDef[];
  /** The module's main unit of work, counted on the executive dashboard ("Orders" for BRSS). */
  workItem?: {
    label: string;
    /** Entity key whose rows are counted, by created date. */
    entityKey: string;
  };
  /** Module configuration, edited in the console's Settings tab. */
  settings?: { schema: z.ZodType<Record<string, unknown>>; defaults: Record<string, unknown> };
  featureFlags?: { key: string; description: string }[];
  /** Fills a business with fake data. Used for the sandbox and for local demo data. */
  seedDemoData?: (s: Scope) => Promise<void>;
  healthChecks?: (s: Scope) => Promise<HealthCheck[]>;
};

/** Helper so manifests get type-checked where they are written. */
export function defineModule(manifest: ModuleManifest): ModuleManifest {
  return manifest;
}

export type { ReactNode };
