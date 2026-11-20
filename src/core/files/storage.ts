/**
 * Where file bytes live. Metadata is in the `files` table; this is only the bytes.
 * Local development and tests write to a local folder (FILE_STORAGE_DIR, git-ignored); the
 * hosted site on AWS writes to a private S3 bucket (FILE_STORAGE_BUCKET).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface FileStorage {
  name: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** Removes everything whose key starts with this folder-like prefix. */
  deletePrefix(prefix: string): Promise<void>;
}

function storageRoot(): string {
  // Serverless hosting (Vercel) can only write to /tmp: files there do not last (demo only).
  return path.resolve(process.env.FILE_STORAGE_DIR || (process.env.VERCEL ? '/tmp/sai-files' : './storage'));
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

/**
 * Amazon S3 (hosted on AWS, docs/aws.md). The bucket is private and encrypted; the app reaches
 * it with its task role, so no key is configured here. Keys are the same as on local disk.
 */
export function s3Storage(bucket: string): FileStorage {
  let client: S3Client | undefined;
  const s3 = () => (client ??= new S3Client({}));
  const checked = (key: string) => {
    if (key.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error('Invalid storage key.');
    return key;
  };
  return {
    name: 's3',
    async put(key, bytes) {
      await s3().send(new PutObjectCommand({ Bucket: bucket, Key: checked(key), Body: bytes }));
    },
    async get(key) {
      const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: checked(key) }));
      if (!out.Body) throw new Error('File not found in storage.');
      return out.Body.transformToByteArray();
    },
    async delete(key) {
      await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: checked(key) }));
    },
    async deletePrefix(prefix) {
      const folder = `${checked(prefix)}/`;
      let token: string | undefined;
      do {
        const page = await s3().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: folder, ContinuationToken: token }));
        const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (keys.length > 0) await s3().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
  };
}

/** FILE_STORAGE_BUCKET set (hosted on AWS): S3. Otherwise the local folder. */
export const fileStorage: FileStorage = process.env.FILE_STORAGE_BUCKET
  ? s3Storage(process.env.FILE_STORAGE_BUCKET)
  : localDiskStorage;

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
  if (!key.startsWith(prefix)) return false;
  // What follows the folder must be ONE plain file name: not empty, no further folders,
  // and not the special names "." or "..". (Dots inside a name, like "a..b.txt", are fine.)
  const name = key.slice(prefix.length);
  return (
    name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
  );
}
