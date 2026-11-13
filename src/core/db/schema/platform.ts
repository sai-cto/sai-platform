/**
 * Platform tables: not owned by any one business.
 * See docs/ARCHITECTURE.md ("Data model") for what each table is for.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** The restricted database role the app connects as. Created by scripts/setup.ts. */
export const appRole = pgRole('sai_app').existing();

export const platformRoleEnum = pgEnum('platform_role', ['super_admin', 'tech', 'executive']);
export const businessRoleEnum = pgEnum('business_role', ['business_admin', 'business_staff']);
export const environmentEnum = pgEnum('environment', ['live', 'sandbox']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  accentColor: text('accent_color').notNull(),
  secondaryColor: text('secondary_color'),
  timeZone: text('time_zone').notNull().default('America/New_York'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: createdAt(),
});

/** What each business has switched on. One row per business. */
export const businessModules = pgTable('business_modules', {
  businessId: uuid('business_id')
    .primaryKey()
    .references(() => businesses.id),
  moduleKey: text('module_key').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  staffPortalEnabled: boolean('staff_portal_enabled').notNull().default(true),
  customerPortalEnabled: boolean('customer_portal_enabled').notNull().default(false),
  fieldPortalEnabled: boolean('field_portal_enabled').notNull().default(false),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  /** Null for people who only have business roles. */
  platformRole: platformRoleEnum('platform_role'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** Links a user to a sign-in provider (dev, microsoft, google). */
export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('auth_identities_provider_subject').on(t.provider, t.providerSubject)],
);

/** Server-side sessions. The cookie holds a random token; this table holds its SHA-256 hash. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** A super admin "acting as" someone else (src/core/auth/acting-as.ts): whom, and since when. */
    actingAsUserId: uuid('acting_as_user_id').references(() => users.id),
    actingAsSince: timestamp('acting_as_since', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** A person's role in one business. */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    role: businessRoleEnum('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('memberships_user_business').on(t.userId, t.businessId),
    index('memberships_business_idx').on(t.businessId),
  ],
);

/** What a business_staff member has been granted by their business_admin. */
export const membershipPermissions = pgTable(
  'membership_permissions',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull(),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.permissionKey] })],
);

/** Feature flags. businessId null = applies to every business. */
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    businessId: uuid('business_id').references(() => businesses.id),
    enabled: boolean('enabled').notNull().default(false),
    description: text('description').notNull().default(''),
    updatedAt: updatedAt(),
  },
  (t) => [unique('feature_flags_key_business').on(t.key, t.businessId).nullsNotDistinct()],
);

/** Settings only super_admin can change (for example retention_days). */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

/**
 * The append-only activity log. Rows can be inserted and read, never changed or
 * removed: a database trigger rejects UPDATE and DELETE (see the custom migration).
 */
export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorName: text('actor_name').notNull(),
    actorRole: text('actor_role').notNull(),
    /** Null for platform-level events such as logins. */
    businessId: uuid('business_id'),
    environment: environmentEnum('environment').notNull().default('live'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    summary: text('summary').notNull(),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
  },
  (t) => [
    index('activity_log_business_idx').on(t.businessId, t.occurredAt),
    index('activity_log_entity_idx').on(t.entityType, t.entityId),
    index('activity_log_occurred_idx').on(t.occurredAt),
    // Reading: platform scope sees everything; a business scope sees only its own rows.
    pgPolicy('activity_log_read', {
      for: 'select',
      to: appRole,
      using: sql`current_setting('app.scope', true) = 'platform' or business_id = nullif(current_setting('app.business_id', true), '')::uuid`,
    }),
    // Writing: inserts are always allowed. There is no UPDATE or DELETE policy.
    pgPolicy('activity_log_insert', { for: 'insert', to: appRole, withCheck: sql`true` }),
  ],
);

/**
 * Unexpected server errors (System health › Errors, tech team and super admin only). Written by
 * src/instrumentation.ts and by server actions that fail unexpectedly; never shown to the person
 * who hit the error (they see a plain message). The message and a short stack, no request body.
 */
export const serverErrors = pgTable(
  'server_errors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** render / route / action / proxy / client */
    source: text('source').notNull(),
    message: text('message').notNull(),
    /** Next.js's id for the error (also shown to the person, so a report can be matched). */
    digest: text('digest'),
    path: text('path'),
    stack: text('stack'),
    userId: uuid('user_id'),
  },
  (t) => [index('server_errors_occurred_idx').on(t.occurredAt)],
);
