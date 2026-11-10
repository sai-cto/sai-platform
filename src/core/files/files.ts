/**
 * The file storage interface. Metadata lives in the files table (tenant-scoped like
 * everything else); bytes live in a FileStorage adapter. The only adapter today writes to
 * a local folder (FILE_STORAGE_DIR, git-ignored).
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { files } from '../db/schema';
import type { Scope } from '../db/scope';
import { ValidationError } from '../errors';
import { fileEntity } from '../records/core-entities';
import { createRecord, getRecord } from '../records/records';
import type { Row } from '../records/types';

export interface FileStorage {
  name: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

function storageRoot(): string {
  return path.resolve(process.env.FILE_STORAGE_DIR || './storage');
}

function resolveKey(key: string): string {
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key.');
  return full;
}

export const localDiskStorage: FileStorage = {
  name: 'local-disk',
  async put(key, bytes) {
    const full = resolveKey(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
  },
  get: async (key) => new Uint8Array(await fs.readFile(resolveKey(key))),
  delete: async (key) => fs.rm(resolveKey(key), { force: true }),
};

const storage: FileStorage = localDiskStorage;
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
  if (input.bytes.byteLength === 0) throw new ValidationError('The file is empty.');
  if (input.bytes.byteLength > MAX_FILE_BYTES)
    throw new ValidationError('Files can be at most 10 MB.');
  const safeName =
    path
      .basename(input.filename)
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .slice(0, 120) || 'file';
  // The business and environment are part of the path, so files are separated on disk too.
  const storageKey = `${s.ctx.business.id}/${s.ctx.environment}/${crypto.randomUUID()}-${safeName}`;
  await storage.put(storageKey, input.bytes);
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
  return { file, bytes: await storage.get(file.storageKey) };
}
