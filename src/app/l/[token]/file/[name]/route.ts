import { NextResponse } from 'next/server';
import { ForbiddenError, NotFoundError, ValidationError } from '@/core/errors';
import { openLinkFile } from '@/core/links/links';

/**
 * A file a customer link may open (LinkPurposeDef.files in the module's manifest), e.g. the
 * full Terms & Conditions PDF of an estimate link. Shown in the browser, never cached; anything
 * wrong with the token or the name is a plain "not found".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; name: string }> }) {
  const { token, name } = await params;
  try {
    const file = await openLinkFile(token, name);
    const filename = file.filename.replace(/[^A-Za-z0-9._-]/g, '_');
    return new NextResponse(Buffer.from(file.bytes), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError || error instanceof ValidationError) {
      return new NextResponse('Not found', { status: 404 });
    }
    throw error;
  }
}
