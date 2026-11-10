/**
 * Core tenant tables: owned by exactly one business, shared by every module.
 * Each is created with tenantTable(), which adds business/environment/audit/archive columns.
 */
import { boolean, date, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantTable } from '../tenant-table';

export const customers = tenantTable(
  'customers',
  {
    kind: text('kind').$type<'person' | 'organization'>().notNull().default('person'),
    firstName: text('first_name').notNull().default(''),
    lastName: text('last_name').notNull().default(''),
    organizationName: text('organization_name'),
    email: text('email'),
    phone: text('phone'),
    notes: text('notes'),
    /** The id this customer had in the system it was imported from, if any. */
    externalRef: text('external_ref'),
  },
  (t) => [index('customers_email_idx').on(t.businessId, t.email)],
);

export const payments = tenantTable(
  'payments',
  {
    customerId: uuid('customer_id').references(() => customers.id),
    kind: text('kind').$type<'charge' | 'authorization'>().notNull().default('charge'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    status: text('status').$type<'pending' | 'succeeded' | 'failed' | 'canceled'>().notNull(),
    method: text('method').$type<'card' | 'cash' | 'check' | 'other'>().notNull().default('card'),
    provider: text('provider').$type<'mock' | 'stripe' | 'manual'>().notNull(),
    providerRef: text('provider_ref'),
    idempotencyKey: text('idempotency_key'),
    cardBrand: text('card_brand'),
    cardLast4: text('card_last4'),
    failureReason: text('failure_reason'),
    description: text('description').notNull().default(''),
    /** What this payment is for, e.g. subjectType "brss.order". */
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    index('payments_subject_idx').on(t.subjectType, t.subjectId),
    index('payments_paid_idx').on(t.businessId, t.environment, t.paidAt),
  ],
);

export const refunds = tenantTable('refunds', {
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason').notNull().default(''),
  status: text('status').$type<'succeeded' | 'failed'>().notNull(),
  providerRef: text('provider_ref'),
});

/** Something that can be scheduled: a truck, a crew, a room. */
export const resources = tenantTable('resources', {
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const appointments = tenantTable(
  'appointments',
  {
    customerId: uuid('customer_id').references(() => customers.id),
    kind: text('kind').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'unconfirmed' | 'confirmed' | 'in_progress' | 'completed' | 'canceled'>()
      .notNull()
      .default('unconfirmed'),
    resourceId: uuid('resource_id').references(() => resources.id),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    notes: text('notes'),
  },
  (t) => [index('appointments_time_idx').on(t.businessId, t.environment, t.startsAt)],
);

/** A blocked time range. resourceId null = the whole business is unavailable. */
export const unavailability = tenantTable('unavailability', {
  resourceId: uuid('resource_id').references(() => resources.id),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  reason: text('reason').notNull().default(''),
});

/** Every message the platform sent or tried to send. */
export const notifications = tenantTable('notifications', {
  channel: text('channel').$type<'email'>().notNull().default('email'),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').$type<'sent' | 'failed'>().notNull(),
  adapter: text('adapter').notNull(),
  error: text('error'),
  subjectType: text('subject_type'),
  subjectId: uuid('subject_id'),
});

/** Metadata for a stored file. The bytes live in the storage adapter. */
export const files = tenantTable('files', {
  storageKey: text('storage_key').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  subjectType: text('subject_type'),
  subjectId: uuid('subject_id'),
});

/** One row per CSV import run. */
export const importJobs = tenantTable('import_jobs', {
  entityKey: text('entity_key').notNull(),
  filename: text('filename').notNull(),
  fileId: uuid('file_id').references(() => files.id),
  mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
  status: text('status')
    .$type<'uploaded' | 'dry_run_ok' | 'dry_run_failed' | 'imported' | 'failed'>()
    .notNull()
    .default('uploaded'),
  rowCount: integer('row_count').notNull().default(0),
  importedCount: integer('imported_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  errors: jsonb('errors').$type<{ row: number; message: string }[]>().notNull().default([]),
  /** SHA-256 of file + mapping, used to check a sandbox run happened before a live run. */
  fingerprint: text('fingerprint').notNull().default(''),
  completedOn: date('completed_on'),
});
