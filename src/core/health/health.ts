/** System health checks, shown in Platform → System health and at /api/health. */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';

export async function pingDatabase(): Promise<{ ok: boolean; detail: string }> {
  try {
    const started = Date.now();
    await getDb().execute(sql`select 1`);
    return { ok: true, detail: `Responded in ${Date.now() - started} ms` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Unreachable' };
  }
}
