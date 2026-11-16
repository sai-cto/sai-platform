/**
 * THE MODULE CONTRACT. A business module is a folder under src/modules/<key>/ that exports
 * one ModuleManifest. The console, data browser, importer, permissions, sandbox and
 * dashboards are all driven by manifests; none of them contain business names.
 *
 * How to write one: docs/MODULE_GUIDE.md.
 */
import type { ReactNode } from 'react';
import type { z } from 'zod';
import type { Scope } from '../db/scope';
import type { TenantTable } from '../records/types';
import type { BusinessContext } from '../tenancy/context';

/** A permission the module defines, e.g. { key: '<module>.orders.read', kind: 'read' }. */
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
  /** Globally unique, "<owner>.<name>", e.g. "core.customer" or "<module>.order". */
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
  /** Fields that are set when the record is created and can never be changed afterwards. */
  immutableFields?: string[];
  /**
   * Module rules about archiving ("delete"). Return a reason to refuse, or null to allow.
   * archiveRecord() calls it for EVERY archive — the Data tab, imports, the module's own
   * services — so a rule like "a signed estimate is never archived" cannot be bypassed.
   * Absent = always archivable.
   */
  archiveGuard?: (s: Scope, row: Record<string, unknown>) => Promise<string | null>;
  /** The same for restoring an archived row (a restore can break rules too). */
  restoreGuard?: (s: Scope, row: Record<string, unknown>) => Promise<string | null>;
  /**
   * Runs after this row is archived or restored, in the same transaction, for anything that
   * depends on it (for example re-pricing the invoice a line belongs to).
   */
  afterArchiveOrRestore?: (s: Scope, row: Record<string, unknown>) => Promise<void>;
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
  /** Prefix for links inside the portal, e.g. "/console/<business>/live/app". */
  basePath: string;
};

export type RouteDef = {
  /** Path inside the portal. "" is the portal home. ":id" captures a value. */
  path: string;
  title: string;
  /** The permission needed to open this page. */
  permission: string;
  /**
   * The page: a server-side function (usually async) that takes PortalPageProps and returns
   * what to show. The platform calls it directly, so it must not be a 'use client' component
   * and must not use React hooks. See "About route pages" in docs/MODULE_GUIDE.md.
   */
  component: (props: PortalPageProps) => ReactNode | Promise<ReactNode>;
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

/** One input in the module's Settings form. */
export type SettingField = {
  key: string;
  label: string;
  type: 'number' | 'text' | 'boolean';
  help?: string;
};

/**
 * A kind of customer link (src/core/links): a signed, expiring link about one record that
 * someone without an account can open, e.g. "review and sign this estimate".
 */
export type LinkPurposeDef = {
  /** Must start with "<module key>.". */
  key: string;
  /**
   * Exactly what the link may do. Module permissions, plus at most the core permissions in
   * LINK_ALLOWED_CORE_PERMISSIONS (src/core/links/links.ts). Checked by validateRegistry().
   */
  permissions: string[];
};

/**
 * A public intake: a way for a website the business owns to put ONE kind of record into the
 * business (a quote request becoming a lead). The visitor has no account and no link, so the
 * door is narrow: it holds exactly `permissions` (module permissions only, checked by
 * validateRegistry()) and `run` must check everything the website sent.
 */
export type PublicIntakeDef = {
  /** Must start with "<module key>.". */
  key: string;
  /** Exactly what the intake may do. Module permissions only, never a core one. */
  permissions: string[];
  /** Turns what the website sent into a record. Throws ValidationError for bad input. */
  run: (ctx: BusinessContext, body: unknown) => Promise<void>;
};

export type ModuleManifest = {
  /** Must equal the slug of the business this module serves (the name used in its URLs). */
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
  /**
   * Work to run on a schedule (hosting's cron calls /api/cron/scheduled). Runs once per
   * business and per mode (live, test) as the system actor. `settingKey` names a boolean
   * module setting that must be on, so a business switches it on deliberately.
   */
  scheduledTasks?: { key: string; settingKey?: string; run: (s: Scope, now: Date) => Promise<string> }[];
  /** Customer links this module hands out. Served at /l/<token>/… from portals.customer. */
  linkPurposes?: LinkPurposeDef[];
  publicIntakes?: PublicIntakeDef[];
  widgets: WidgetDef[];
  /**
   * The console's search box (Ctrl/Cmd-K) on this business's pages: records matching what was
   * typed. The module checks what the person may read; at most a few hits per kind.
   */
  search?: (ctx: BusinessContext, query: string, basePath: string) => Promise<SearchHit[]>;
  /**
   * Replaces the Overview's "Upcoming confirmed appointments" (a count of appointments, one per
   * resource) with the module's own count of what is coming up, so the Overview never disagrees
   * with the module's dashboard. Only the label and the count change.
   */
  upcoming?: {
    label: string;
    permission: string;
    load: (s: Scope) => Promise<number>;
  };
  /** The module's main unit of work, counted on the executive dashboard (for example "Orders"). */
  workItem?: {
    label: string;
    /** Entity key whose rows are counted, by created date. */
    entityKey: string;
  };
  /** Module configuration, edited in the console's Settings tab. */
  settings?: {
    schema: z.ZodType<Record<string, unknown>>;
    defaults: Record<string, unknown>;
    /** How each setting is shown in the Settings form. */
    fields: SettingField[];
  };
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

/** One search result: shown under its group, opens `href`. */
export type SearchHit = { group: string; label: string; detail?: string; href: string };
