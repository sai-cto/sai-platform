/**
 * The file storage interface. Metadata lives in the files table (tenant-scoped like
 * everything else); bytes live in a FileStorage adapter (see storage.ts).
 */
import crypto from 'node:crypto';
import path from 'node:path';
import type { files } from '../db/schema';
import { onRollback, type Scope } from '../db/scope';
import { NotFoundError, ValidationError } from '../errors';
import { authorize } from '../rbac/permissions';
import { fileEntity } from '../records/core-entities';
import { createRecord, getRecord } from '../records/records';
import type { Row } from '../records/types';
import { fileStorage, ownsStorageKey, storagePrefix } from './storage';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function saveFile(
  s: Scope,
  input: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
    subjectType?: string;
    subjectId?: string;
  },
): Promise<Row<typeof files>> {
  // Permission and input are checked BEFORE anything is written to disk.
  authorize(s.ctx, 'files.write');
  if (input.bytes.byteLength === 0) throw new ValidationError('The file is empty.');
  if (input.bytes.byteLength > MAX_FILE_BYTES)
    throw new ValidationError('Files can be at most 10 MB.');
  const safeName =
    path
      .basename(input.filename)
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .slice(0, 120) || 'file';
  // The business and environment are part of the path, so files are separated on disk too.
  const storageKey = `${storagePrefix(s.ctx.business.id, s.ctx.environment)}/${crypto.randomUUID()}-${safeName}`;
  await fileStorage.put(storageKey, input.bytes);
  // If the transaction this is part of fails, the row is never saved: remove the bytes too.
  onRollback(s, () => fileStorage.delete(storageKey));
  return createRecord(s, fileEntity, {
    storageKey,
    filename: safeName,
    contentType: input.contentType || 'application/octet-stream',
    sizeBytes: input.bytes.byteLength,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
  });
}

/** Reads a file. The row is looked up inside the scope first, so another business's file is "not found". */
export async function readFile(
  s: Scope,
  id: string,
): Promise<{ file: Row<typeof files>; bytes: Uint8Array }> {
  const file = await getRecord(s, fileEntity, id);
  // The row is ours, but its key must also point inside OUR folder (never trust the key alone).
  if (!ownsStorageKey(s.ctx.business.id, s.ctx.environment, file.storageKey))
    throw new NotFoundError();
  return { file, bytes: await fileStorage.get(file.storageKey) };
}
