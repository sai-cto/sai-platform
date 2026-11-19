import { NextResponse } from 'next/server';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { readFile } from '@/core/files/files';
import { withScope } from '@/core/db/scope';
import { buildBusinessContext } from '@/core/tenancy/context';
import { currentPrincipal } from '@/server/session';

/** Types shown in the browser; anything else is downloaded (never rendered on our origin). */
const INLINE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Opens a stored file of the business. Needs files.read; another business's file is "not found". */
export async function GET(_request: Request, { params }: { params: Promise<{ business: string; mode: string; id: string }> }) {
  const { business, mode, id } = await params;
  const notFound = new NextResponse('Not found', { status: 404 });
  const principal = await currentPrincipal();
  if (!principal) return new NextResponse('Sign in first', { status: 401 });
  if (mode !== 'live' && mode !== 'sandbox') return notFound;
  try {
    const ctx = await buildBusinessContext(principal, business, mode);
    const { file, bytes } = await withScope(ctx, 'files.read', (s) => readFile(s, id));
    const inline = INLINE.has(file.contentType);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': inline ? file.contentType : 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return notFound;
    throw error;
  }
}
