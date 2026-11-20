/**
 * HHMC's full Terms & Conditions as a PDF (managers' feedback round 1, Nov 2026): uploaded in
 * Settings › Documents and branding, linked from the customer's estimate page so it can be
 * read before signing, and named on the signed estimate (`signedTermsVersion`).
 *
 * Every upload is kept (core files, subject type below); the newest one is in force. A version
 * is the upload date and the start of the file's id, e.g. "2026-11-19 · 3f2a9c1e": short enough
 * to read out, unique, and it never changes.
 */
import { and, desc, eq } from 'drizzle-orm';
import { files } from '@/core/db/schema/tenant';
import { withScope, type Scope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { MAX_FILE_BYTES, readFile, saveFile } from '@/core/files/files';
import type { BusinessContext } from '@/core/tenancy/context';
import { CORE, P } from '../permissions';
import type { EstimateSnapshot } from '../schema';
import { openEstimateByLink } from './estimates';

export const TERMS_PDF_SUBJECT = 'hhmc.terms_pdf';
/** The name the customer link serves it under: /l/<token>/file/terms.pdf */
export const TERMS_PDF_LINK_NAME = 'terms.pdf';
/** What the signing record says when no PDF had been uploaded yet. */
export const NO_TERMS_PDF = 'No T&C PDF on file (terms text on the estimate only)';

export type TermsPdf = NonNullable<EstimateSnapshot['termsPdf']> & { uploadedAt: Date };

function versionOf(row: { id: string; createdAt: Date }): string {
  return `${row.createdAt.toISOString().slice(0, 10)} · ${row.id.slice(0, 8)}`;
}

/** The T&C PDF in force (the newest upload), or null when none was uploaded. */
export async function currentTermsPdf(s: Scope): Promise<TermsPdf | null> {
  const [row] = await s.db
    .select({ id: files.id, filename: files.filename, createdAt: files.createdAt })
    .from(files)
    .where(and(s.where(files), eq(files.subjectType, TERMS_PDF_SUBJECT)))
    .orderBy(desc(files.createdAt))
    .limit(1);
  return row ? { fileId: row.id, filename: row.filename, version: versionOf(row), uploadedAt: row.createdAt } : null;
}

export async function termsPdfInfo(ctx: BusinessContext): Promise<TermsPdf | null> {
  return withScope(ctx, CORE.filesRead, (s) => currentTermsPdf(s));
}

/** A real PDF starts with "%PDF-". The browser's content type alone is not trusted. */
function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength > 5 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
}

/** Uploads a new version. Older versions are kept: estimates already sent still name theirs. */
export async function uploadTermsPdf(ctx: BusinessContext, input: { filename: string; bytes: Uint8Array }): Promise<TermsPdf> {
  if (input.bytes.byteLength === 0) throw new ValidationError('Choose the Terms & Conditions PDF.');
  if (input.bytes.byteLength > MAX_FILE_BYTES) throw new ValidationError('The PDF can be at most 10 MB.');
  if (!isPdf(input.bytes)) throw new ValidationError('That file is not a PDF.');
  return withScope(ctx, P.catalogWrite, async (s) => {
    const file = await saveFile(s, {
      filename: input.filename.toLowerCase().endsWith('.pdf') ? input.filename : `${input.filename}.pdf`,
      contentType: 'application/pdf',
      bytes: input.bytes,
      subjectType: TERMS_PDF_SUBJECT,
    });
    return { fileId: file.id, filename: file.filename, version: versionOf(file), uploadedAt: file.createdAt };
  });
}

/** The PDF a customer sees for an estimate: the one frozen when it was sent, else the current one. */
export async function termsPdfForEstimate(s: Scope, snapshot: EstimateSnapshot): Promise<NonNullable<EstimateSnapshot['termsPdf']> | null> {
  if (snapshot.termsPdf) return snapshot.termsPdf;
  const current = await currentTermsPdf(s);
  return current ? { fileId: current.fileId, filename: current.filename, version: current.version } : null;
}

/** The estimate link's PDF (/l/<token>/file/terms.pdf); null for any other name or no PDF. */
export async function termsPdfByLink(ctx: BusinessContext, name: string) {
  if (name !== TERMS_PDF_LINK_NAME) return null;
  const view = await openEstimateByLink(ctx);
  if (!view.termsPdf) return null;
  return withScope(ctx, P.customerEstimate, (s) => termsPdfBytes(s, view.termsPdf!.fileId));
}

/** The PDF's bytes, for a scope that may read it (the estimate link, or staff). */
export async function termsPdfBytes(s: Scope, fileId: string) {
  const { file, bytes } = await readFile(s, fileId);
  if (file.subjectType !== TERMS_PDF_SUBJECT) throw new ValidationError('Not the Terms & Conditions PDF.');
  return { filename: file.filename, contentType: 'application/pdf', bytes };
}
