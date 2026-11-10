/**
 * TEMPLATE — the module's permissions.
 *
 * Keys start with the module key. "read" permissions are held by super admin, tech,
 * executive and business admin; "write" by super admin, tech and business admin. Staff hold
 * a permission only if their business admin switches it on (defaultForStaff: true = on for
 * new staff). Run `npm run docs:permissions` after changing these.
 */
import type { PermissionDef } from '@/core/modules/contract';

export const P = {
  itemsRead: 'template.items.read',
  itemsWrite: 'template.items.write',
} as const;

export const permissions: PermissionDef[] = [
  { key: P.itemsRead, label: 'See items', kind: 'read', defaultForStaff: true },
  {
    key: P.itemsWrite,
    label: 'Add, edit, archive and restore items',
    kind: 'write',
    defaultForStaff: false,
  },
];
