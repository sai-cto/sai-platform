import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { findEntity } from '@/core/modules/registry';
import { EXPORT_LIMIT, exportCell, exportRecords } from '@/core/records/export';
import { buildBusinessContext } from '@/core/tenancy/context';
import { currentUserId } from '@/server/session';

/** CSV download of an entity's records. Needs business.data.export; every export is logged. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ business: string; mode: string; entity: string }> },
) {
  const { business, mode, entity: entityKey } = await params;
  const notFound = new NextResponse('Not found', { status: 404 });
  const userId = await currentUserId();
  if (!userId) return new NextResponse('Sign in first', { status: 401 });
  if (mode !== 'live' && mode !== 'sandbox') return notFound;
  try {
    const ctx = await buildBusinessContext(userId, business, mode);
    const entity = findEntity(ctx.business.moduleKey, entityKey);
    if (!entity) return notFound;
    const url = new URL(request.url);
    const show = url.searchParams.get('show');
    const { columns, rows, total } = await exportRecords(ctx, entity, {
      search: url.searchParams.get('q') ?? undefined,
      archived: show === 'archived' ? 'only' : show === 'all' ? 'include' : 'exclude',
    });
    const csv = Papa.unparse({
      fields: columns.map((c) => c.label),
      data: rows.map((row) => columns.map((c) => exportCell(row[c.key], c.format))),
    });
    const filename = `${ctx.business.slug}-${entity.key.replace(/\./g, '-')}-${ctx.environment}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        // Tells the caller when the export was cut off at the limit.
        'X-Export-Rows': `${rows.length} of ${total}${total > EXPORT_LIMIT ? ' (limit reached: narrow the search)' : ''}`,
      },
    });
  } catch (error) {
    // Another business, a mode you cannot use, or no export permission: all look the same.
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return notFound;
    throw error;
  }
}
