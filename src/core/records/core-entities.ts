/**
 * The shared core's own entities. They appear in every business's Data tab and are
 * covered by the same isolation and audit tests as module entities.
 */
import { z } from 'zod';
import {
  appointments,
  customers,
  files,
  importJobs,
  notifications,
  payments,
  refunds,
  resources,
  unavailability,
} from '../db/schema';
import { ValidationError } from '../errors';
import { fileStorage, ownsStorageKey } from '../files/storage';
import type { EntityDef } from '../modules/contract';

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

export function customerName(row: Record<string, unknown>): string {
  if (row.kind === 'organization' && row.organizationName) return text(row.organizationName);
  return (
    `${text(row.firstName)} ${text(row.lastName)}`.trim() || text(row.email) || 'Unnamed customer'
  );
}

const customerImport = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  email: z.union([z.literal(''), z.string().trim().email('Email is not valid')]).optional(),
  phone: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  externalRef: z.string().trim().optional(),
});

export const customerEntity: EntityDef<typeof customers> = {
  key: 'core.customer',
  label: 'customer',
  labelPlural: 'Customers',
  table: customers,
  readPermission: 'customers.read',
  writePermission: 'customers.write',
  titleOf: customerName,
  listColumns: [
    { key: 'firstName', label: 'First name' },
    { key: 'lastName', label: 'Last name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'createdAt', label: 'Created', format: 'date' },
  ],
  searchColumns: ['firstName', 'lastName', 'email', 'phone', 'organizationName'],
  import: {
    fields: [
      { key: 'firstName', label: 'First name', required: true },
      { key: 'lastName', label: 'Last name', required: true },
      { key: 'email', label: 'Email', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'notes', label: 'Notes', required: false },
      { key: 'externalRef', label: 'Old system id', required: false },
    ],
    toValues: (row) => {
      const parsed = customerImport.safeParse(row);
      if (!parsed.success)
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      const v = parsed.data;
      return {
        kind: 'person',
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email ? v.email.toLowerCase() : null,
        phone: v.phone || null,
        notes: v.notes || null,
        externalRef: v.externalRef || null,
      };
    },
  },
};

export const paymentEntity: EntityDef<typeof payments> = {
  // Money taken for a module record stays visible: refund it instead.
  archiveGuard: async (_s, row) =>
    row.subjectType && row.status === 'succeeded'
      ? `This payment belongs to a ${String(row.subjectType)} record. Refund it instead of archiving it.`
      : null,
  key: 'core.payment',
  label: 'payment',
  labelPlural: 'Payments',
  table: payments,
  readPermission: 'payments.read',
  writePermission: 'payments.write',
  titleOf: (row) =>
    `${(Number(row.amountCents) / 100).toFixed(2)} ${text(row.currency).toUpperCase()} ${text(row.kind)}`,
  listColumns: [
    { key: 'paidAt', label: 'Paid', format: 'datetime' },
    { key: 'amountCents', label: 'Amount', format: 'money' },
    { key: 'kind', label: 'Kind' },
    { key: 'status', label: 'Status' },
    { key: 'method', label: 'Method' },
    { key: 'provider', label: 'Provider' },
    { key: 'description', label: 'Description' },
  ],
  searchColumns: ['description', 'providerRef', 'status'],
};

export const refundEntity: EntityDef<typeof refunds> = {
  key: 'core.refund',
  label: 'refund',
  labelPlural: 'Refunds',
  table: refunds,
  readPermission: 'payments.read',
  writePermission: 'payments.write',
  titleOf: (row) => `${(Number(row.amountCents) / 100).toFixed(2)} refund`,
  listColumns: [
    { key: 'createdAt', label: 'Refunded', format: 'datetime' },
    { key: 'amountCents', label: 'Amount', format: 'money' },
    { key: 'status', label: 'Status' },
    { key: 'reason', label: 'Reason' },
  ],
  searchColumns: ['reason'],
};

export const resourceEntity: EntityDef<typeof resources> = {
  key: 'core.resource',
  label: 'resource',
  labelPlural: 'Resources',
  table: resources,
  readPermission: 'scheduling.read',
  writePermission: 'scheduling.write',
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'kind', label: 'Kind' },
    { key: 'isActive', label: 'Active', format: 'boolean' },
  ],
  searchColumns: ['name', 'kind'],
};

/**
 * A core row that belongs to a module record (subject_type set: a booked job day, a deposit)
 * is changed only through that record's own page, never archived on its own from the Data tab.
 */
const ownedBySubject = (what: string) => async (_s: unknown, row: Record<string, unknown>) =>
  row.subjectType ? `This ${what} belongs to a ${String(row.subjectType)} record: change it from that record's page.` : null;

export const appointmentEntity: EntityDef<typeof appointments> = {
  archiveGuard: ownedBySubject('appointment'),
  key: 'core.appointment',
  label: 'appointment',
  labelPlural: 'Appointments',
  table: appointments,
  readPermission: 'scheduling.read',
  writePermission: 'scheduling.write',
  titleOf: (row) =>
    `${text(row.kind)} on ${row.startsAt instanceof Date ? row.startsAt.toISOString().slice(0, 16).replace('T', ' ') : text(row.startsAt)}`,
  listColumns: [
    { key: 'startsAt', label: 'Starts', format: 'datetime' },
    { key: 'endsAt', label: 'Ends', format: 'datetime' },
    { key: 'kind', label: 'Kind' },
    { key: 'status', label: 'Status' },
    { key: 'notes', label: 'Notes' },
  ],
  searchColumns: ['kind', 'status', 'notes'],
};

export const unavailabilityEntity: EntityDef<typeof unavailability> = {
  key: 'core.unavailability',
  label: 'unavailability',
  labelPlural: 'Unavailability',
  table: unavailability,
  readPermission: 'scheduling.read',
  writePermission: 'scheduling.write',
  titleOf: (row) => text(row.reason) || 'Blocked time',
  listColumns: [
    { key: 'startsAt', label: 'From', format: 'datetime' },
    { key: 'endsAt', label: 'To', format: 'datetime' },
    { key: 'reason', label: 'Reason' },
  ],
  searchColumns: ['reason'],
};

export const notificationEntity: EntityDef<typeof notifications> = {
  key: 'core.notification',
  label: 'notification',
  labelPlural: 'Notifications',
  table: notifications,
  readPermission: 'notifications.read',
  writePermission: 'notifications.write',
  titleOf: (row) => `${text(row.subject)} → ${text(row.recipient)}`,
  listColumns: [
    { key: 'createdAt', label: 'Sent', format: 'datetime' },
    { key: 'recipient', label: 'To' },
    { key: 'subject', label: 'Subject' },
    { key: 'status', label: 'Status' },
    { key: 'adapter', label: 'Sent by' },
  ],
  searchColumns: ['recipient', 'subject'],
};

export const fileEntity: EntityDef<typeof files> = {
  key: 'core.file',
  label: 'file',
  labelPlural: 'Files',
  table: files,
  readPermission: 'files.read',
  writePermission: 'files.write',
  titleOf: (row) => text(row.filename),
  immutableFields: ['storageKey'],
  // A permanently deleted file must not leave its bytes on disk. Only ever delete bytes
  // inside the row's own business/environment folder, whatever the row's key says.
  afterPurge: async (row) => {
    const key = text(row.storageKey);
    if (ownsStorageKey(text(row.businessId), row.environment as 'live' | 'sandbox', key))
      await fileStorage.delete(key);
  },
  listColumns: [
    { key: 'filename', label: 'File' },
    { key: 'contentType', label: 'Type' },
    { key: 'sizeBytes', label: 'Size (bytes)' },
    { key: 'createdAt', label: 'Uploaded', format: 'datetime' },
  ],
  searchColumns: ['filename'],
};

export const importJobEntity: EntityDef<typeof importJobs> = {
  key: 'core.import_job',
  label: 'import',
  labelPlural: 'Imports',
  table: importJobs,
  readPermission: 'imports.read',
  writePermission: 'imports.write',
  titleOf: (row) => `${text(row.filename)} → ${text(row.entityKey)}`,
  listColumns: [
    { key: 'createdAt', label: 'Started', format: 'datetime' },
    { key: 'filename', label: 'File' },
    { key: 'entityKey', label: 'Into' },
    { key: 'status', label: 'Status' },
    { key: 'rowCount', label: 'Rows' },
    { key: 'errorCount', label: 'Errors' },
  ],
  searchColumns: ['filename', 'entityKey', 'status'],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a list of entities over different tables
export const CORE_ENTITIES: EntityDef<any>[] = [
  customerEntity,
  paymentEntity,
  refundEntity,
  resourceEntity,
  appointmentEntity,
  unavailabilityEntity,
  notificationEntity,
  fileEntity,
  importJobEntity,
];
