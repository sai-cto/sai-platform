import { NextResponse } from 'next/server';
import { pingDatabase } from '@/core/health/health';

/** Liveness check for local use: is the app up and can it reach the database? */
export async function GET() {
  const database = await pingDatabase();
  return NextResponse.json(
    { ok: database.ok, database: database.ok ? 'up' : 'down' },
    { status: database.ok ? 200 : 503 },
  );
}
