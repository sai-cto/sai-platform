/**
 * The S3 file storage used on AWS (docs/aws.md). Amazon is never called: the client's send()
 * is replaced by an in-memory bucket.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { s3Storage } from '@/core/files/storage';

function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  const buckets: string[] = [];
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
    const input = (command as { input: Record<string, unknown> }).input;
    buckets.push(String(input.Bucket));
    if (command instanceof PutObjectCommand) objects.set(String(input.Key), input.Body as Uint8Array);
    else if (command instanceof GetObjectCommand) {
      const bytes = objects.get(String(input.Key));
      if (!bytes) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      return { Body: { transformToByteArray: async () => bytes } };
    } else if (command instanceof DeleteObjectCommand) objects.delete(String(input.Key));
    else if (command instanceof ListObjectsV2Command) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(String(input.Prefix)));
      return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
    } else if (command instanceof DeleteObjectsCommand) {
      for (const o of (input.Delete as { Objects: { Key: string }[] }).Objects) objects.delete(o.Key);
    }
    return {};
  });
  return { objects, buckets };
}

afterEach(() => vi.restoreAllMocks());

describe('S3 file storage', () => {
  it('writes, reads and deletes a file in the configured bucket', async () => {
    const { objects, buckets } = fakeBucket();
    const store = s3Storage('sai-files-test');
    await store.put('biz/live/a.pdf', new Uint8Array([1, 2, 3]));
    expect(await store.get('biz/live/a.pdf')).toEqual(new Uint8Array([1, 2, 3]));
    await store.delete('biz/live/a.pdf');
    expect(objects.size).toBe(0);
    expect(new Set(buckets)).toEqual(new Set(['sai-files-test']));
  });

  it('deletes one business-environment folder and nothing else', async () => {
    const { objects } = fakeBucket();
    const store = s3Storage('sai-files-test');
    await store.put('biz/sandbox/a.pdf', new Uint8Array([1]));
    await store.put('biz/sandbox/b.pdf', new Uint8Array([2]));
    await store.put('biz/sandbox-old/c.pdf', new Uint8Array([3]));
    await store.put('biz/live/d.pdf', new Uint8Array([4]));
    await store.deletePrefix('biz/sandbox');
    expect([...objects.keys()].sort()).toEqual(['biz/live/d.pdf', 'biz/sandbox-old/c.pdf']);
  });

  it('refuses keys that climb out of their folder', async () => {
    fakeBucket();
    const store = s3Storage('sai-files-test');
    await expect(store.put('biz/live/../../other/x', new Uint8Array([1]))).rejects.toThrow('Invalid storage key.');
    await expect(store.get('/biz/live/x')).rejects.toThrow('Invalid storage key.');
    await expect(store.deletePrefix('biz/./live')).rejects.toThrow('Invalid storage key.');
  });
});
