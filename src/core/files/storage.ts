/**
 * Where file bytes live. Metadata is in the `files` table; this is only the bytes.
 * The one adapter today writes to a local folder (FILE_STORAGE_DIR, git-ignored).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export interface FileStorage {
  name: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** Removes everything whose key starts with this folder-like prefix. */
  deletePrefix(prefix: string): Promise<void>;
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
  deletePrefix: async (prefix) => fs.rm(resolveKey(prefix), { recursive: true, force: true }),
};

export const fileStorage: FileStorage = localDiskStorage;

/** Every file key starts with this, so one business's files in one environment share a folder. */
export function storagePrefix(businessId: string, environment: 'live' | 'sandbox'): string {
  return `${businessId}/${environment}`;
}

/**
 * Is this storage key inside the folder of this business and environment? Checked before
 * bytes are read or deleted, so a file row can never be used to reach another business's
 * (or the other environment's) bytes, whatever its storage key says.
 */
export function ownsStorageKey(
  businessId: string,
  environment: 'live' | 'sandbox',
  key: string,
): boolean {
  const prefix = `${storagePrefix(businessId, environment)}/`;
  return key.startsWith(prefix) && !key.slice(prefix.length).includes('/') && !key.includes('..');
}
