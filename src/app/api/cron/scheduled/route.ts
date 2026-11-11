import { NextResponse } from 'next/server';
import { sameSecret } from '@/core/demo/demo';
import { runScheduledTasks } from '@/core/modules/scheduled';

/**
 * The hosting's scheduler calls this (vercel.json "crons"). Vercel sends
 * "Authorization: Bearer <CRON_SECRET>". Without CRON_SECRET configured, or with the wrong
 * secret, it is "not found". What runs is decided by each module (ModuleManifest.scheduledTasks).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? '';
  const given = request.headers.get('authorization') ?? '';
  if (secret.length < 16 || !sameSecret(given, `Bearer ${secret}`)) {
    return new NextResponse('Not found', { status: 404 });
  }
  const results = await runScheduledTasks(new Date());
  return NextResponse.json({ ok: true, results });
}
