/**
 * The data import framework:  CSV → map columns to fields → dry run → import into the
 * SANDBOX → (after checking it there) import the same file into live.
 *
 * Any entity can be made importable by giving it an `import` block in its EntityDef
 * (see src/core/modules/contract.ts); nothing here knows about a specific business.
 *
 * Safety rules:
 *  - a file always goes into the sandbox first;
 *  - a live import is only allowed for a file + mapping that already imported cleanly into
 *    the sandbox (matched by fingerprint), and needs platform.imports.run_live;
 *  - an import is all-or-nothing: if any row fails, nothing is written;
 *  - every imported row is created through createRecord, so it is logged like any other.
 */
import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import Papa from 'papaparse';
import { logActivity } from '../audit/log';
import { businesses, importJobs } from '../db/schema';
import { txOf, withPlatformScope, withScope, type Scope } from '../db/scope';
import { NotFoundError, ValidationError } from '../errors';
import { readFile, saveFile } from '../files/files';
import type { EntityDef } from '../modules/contract';
import { entitiesFor, findEntity } from '../modules/registry';
import { authorize } from '../rbac/permissions';
import { importJobEntity } from '../records/core-entities';
import { createRecord, getRecord, updateRecord } from '../records/records';
import type { Row } from '../records/types';
import type { BusinessContext, PlatformContext } from '../tenancy/context';

export const MAX_IMPORT_ROWS = 2000;

export type ImportJob = Row<typeof importJobs>;
export type ParsedCsv = { headers: string[]; rows: Record<string, string>[] };
export type RowError = { row: number; message: string };

export function importableEntities(moduleKey: string | null): EntityDef[] {
  return entitiesFor(moduleKey).filter((e) => e.import);
}

export function parseCsv(bytes: Uint8Array): ParsedCsv {
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  const headers = (result.meta.fields ?? []).filter((h) => h !== '');
  if (headers.length === 0) throw new ValidationError('The file has no header row. The first line must name the columns.');
  if (result.data.length === 0) throw new ValidationError('The file has a header row but no data rows.');
  if (result.data.length > MAX_IMPORT_ROWS) throw new ValidationError(`The file has ${result.data.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`);
  return { headers, rows: result.data };
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Guesses which CSV column feeds each field, by comparing names. People can change it. */
export function suggestMapping(entity: EntityDef, headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of entity.import?.fields ?? []) {
    const match = headers.find((h) => normalize(h) === normalize(field.key) || normalize(h) === normalize(field.label));
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

function fingerprintOf(bytes: Uint8Array, entityKey: string, mapping: Record<string, string>): string {
  const ordered = Object.fromEntries(Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b)));
  return crypto.createHash('sha256').update(bytes).update(entityKey).update(JSON.stringify(ordered)).digest('hex');
}

function requireImportable(ctx: BusinessContext, entityKey: string): EntityDef {
  const entity = findEntity(ctx.business.moduleKey, entityKey);
  if (!entity?.import) throw new ValidationError('These records cannot be imported.');
  return entity;
}

function requireSandbox(ctx: BusinessContext): void {
  if (ctx.environment !== 'sandbox') throw new ValidationError('A file is always imported into the sandbox first.');
}

/** Applies the mapping to every row and validates it. Nothing is written. */
function mapRows(entity: EntityDef, csv: ParsedCsv, mapping: Record<string, string>): { values: Record<string, unknown>[]; errors: RowError[] } {
  const fields = entity.import?.fields ?? [];
  const missing = fields.filter((f) => f.required && !mapping[f.key]);
  if (missing.length > 0) throw new ValidationError(`Choose a column for: ${missing.map((f) => f.label).join(', ')}.`);
  const values: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  csv.rows.forEach((raw, index) => {
    const mapped: Record<string, string> = {};
    for (const field of fields) mapped[field.key] = mapping[field.key] ? (raw[mapping[field.key]] ?? '').trim() : '';
    try {
      values.push(entity.import!.toValues(mapped));
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      errors.push({ row: index + 2, message: error.message }); // +2: header is line 1
    }
  });
  return { values, errors };
}

/** Step 1: upload. Stores the file and creates the job with a suggested mapping. */
export async function createImportJob(ctx: BusinessContext, input: { entityKey: string; filename: string; bytes: Uint8Array }): Promise<ImportJob> {
  requireSandbox(ctx);
  const entity = requireImportable(ctx, input.entityKey);
  const csv = parseCsv(input.bytes);
  return withScope(ctx, 'imports.write', async (s) => {
    const file = await saveFile(s, { filename: input.filename, contentType: 'text/csv', bytes: input.bytes, subjectType: 'core.import_job' });
    return createRecord(s, importJobEntity, {
      entityKey: entity.key,
      filename: file.filename,
      fileId: file.id,
      mapping: suggestMapping(entity, csv.headers),
      status: 'uploaded',
      rowCount: csv.rows.length,
    });
  });
}

export type ImportJobView = {
  job: ImportJob;
  entity: EntityDef;
  headers: string[];
  /** The first rows after mapping, for the preview. Empty until a dry run has passed validation of the mapping. */
  preview: Record<string, unknown>[];
};

async function loadJob(s: Scope, id: string): Promise<{ job: ImportJob; entity: EntityDef; csv: ParsedCsv; bytes: Uint8Array }> {
  const job = await getRecord(s, importJobEntity, id);
  const entity = requireImportable(s.ctx, job.entityKey);
  if (!job.fileId) throw new NotFoundError();
  const { bytes } = await readFile(s, job.fileId);
  return { job, entity, csv: parseCsv(bytes), bytes };
}

export async function getImportJob(ctx: BusinessContext, id: string): Promise<ImportJobView> {
  return withScope(ctx, 'imports.read', async (s) => {
    const { job, entity, csv } = await loadJob(s, id);
    let preview: Record<string, unknown>[] = [];
    try {
      preview = mapRows(entity, { headers: csv.headers, rows: csv.rows.slice(0, 10) }, job.mapping).values;
    } catch {
      // Mapping incomplete: no preview yet.
    }
    return { job, entity, headers: csv.headers, preview };
  });
}

/** Steps 2 and 3: save the mapping and dry-run it. Nothing is imported. */
export async function dryRunImport(ctx: BusinessContext, id: string, mapping: Record<string, string>): Promise<ImportJob> {
  requireSandbox(ctx);
  return withScope(ctx, 'imports.write', async (s) => {
    const { job, entity, csv, bytes } = await loadJob(s, id);
    if (job.status === 'imported') throw new ValidationError('This file has already been imported.');
    const clean = Object.fromEntries(Object.entries(mapping).filter(([key, header]) => entity.import!.fields.some((f) => f.key === key) && csv.headers.includes(header)));
    const { errors } = mapRows(entity, csv, clean);
    return updateRecord(s, importJobEntity, id, {
      mapping: clean,
      status: errors.length === 0 ? 'dry_run_ok' : 'dry_run_failed',
      rowCount: csv.rows.length,
      errorCount: errors.length,
      errors: errors.slice(0, 100),
      fingerprint: fingerprintOf(bytes, entity.key, clean),
    });
  });
}

async function writeRows(s: Scope, entity: EntityDef, values: Record<string, unknown>[]): Promise<void> {
  for (const row of values) await createRecord(s, entity, row as never);
}

/** Step 4: import into the sandbox. Requires a clean dry run. */
export async function runSandboxImport(ctx: BusinessContext, id: string): Promise<ImportJob> {
  requireSandbox(ctx);
  return withScope(ctx, 'imports.write', async (s) => {
    const { job, entity, csv, bytes } = await loadJob(s, id);
    if (job.status === 'imported') throw new ValidationError('This file has already been imported into the sandbox.');
    if (job.status !== 'dry_run_ok') throw new ValidationError('Run the check first and fix every error before importing.');
    if (job.fingerprint !== fingerprintOf(bytes, entity.key, job.mapping)) throw new ValidationError('The mapping changed since the check. Run the check again.');
    const { values, errors } = mapRows(entity, csv, job.mapping);
    if (errors.length > 0) throw new ValidationError('The file no longer passes the check. Run the check again.');
    await writeRows(s, entity, values);
    const done = await updateRecord(s, importJobEntity, id, { status: 'imported', importedCount: values.length, completedOn: new Date().toISOString().slice(0, 10) });
    await logActivity(txOf(s), ctx, {
      action: 'import',
      entityType: entity.key,
      entityId: id,
      summary: `Imported ${values.length} ${entity.labelPlural.toLowerCase()} from ${job.filename} into the sandbox`,
      after: { rows: values.length, file: job.filename },
    });
    return done;
  });
}

/**
 * Step 5: import the SAME file and mapping into live. Only possible after it imported
 * cleanly into the sandbox, and only once.
 */
export async function runLiveImport(platform: PlatformContext, liveCtx: BusinessContext, sandboxJobId: string): Promise<ImportJob> {
  authorize(platform, 'platform.imports.run_live');
  if (liveCtx.environment !== 'live') throw new ValidationError('The live import must run in live mode.');
  const sandboxCtx: BusinessContext = { ...liveCtx, environment: 'sandbox' };
  const source = await withScope(sandboxCtx, 'imports.read', (s) => loadJob(s, sandboxJobId));
  if (source.job.status !== 'imported') throw new ValidationError('Import this file into the sandbox and check it there first.');
  if (source.job.fingerprint !== fingerprintOf(source.bytes, source.entity.key, source.job.mapping)) {
    throw new ValidationError('The file or mapping changed since the sandbox import. Start a new import.');
  }
  const { values, errors } = mapRows(source.entity, source.csv, source.job.mapping);
  if (errors.length > 0) throw new ValidationError('The file no longer passes the check.');

  return withScope(liveCtx, 'imports.write', async (s) => {
    const [already] = await s.db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(and(s.where(importJobs, 'include'), eq(importJobs.fingerprint, source.job.fingerprint), eq(importJobs.status, 'imported')))
      .limit(1);
    if (already) throw new ValidationError('This exact file and mapping has already been imported into live.');
    await writeRows(s, source.entity, values);
    const job = await createRecord(s, importJobEntity, {
      entityKey: source.entity.key,
      filename: source.job.filename,
      mapping: source.job.mapping,
      status: 'imported',
      rowCount: values.length,
      importedCount: values.length,
      fingerprint: source.job.fingerprint,
      completedOn: new Date().toISOString().slice(0, 10),
    });
    await logActivity(txOf(s), liveCtx, {
      action: 'import',
      entityType: source.entity.key,
      entityId: job.id,
      summary: `Imported ${values.length} ${source.entity.labelPlural.toLowerCase()} from ${source.job.filename} into LIVE`,
      after: { rows: values.length, file: source.job.filename, sandboxJobId },
    });
    return job;
  });
}

export type ImportJobListItem = ImportJob & { businessSlug: string; businessCode: string };

/** Every import run on the platform, newest first (Platform → Data imports). */
export async function listImportJobs(ctx: PlatformContext): Promise<ImportJobListItem[]> {
  return withPlatformScope(ctx, 'platform.imports.read', async (s) => {
    const rows = await s.db
      .select({ job: importJobs, businessSlug: businesses.slug, businessCode: businesses.code })
      .from(importJobs)
      .innerJoin(businesses, eq(businesses.id, importJobs.businessId))
      .orderBy(desc(importJobs.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r.job, businessSlug: r.businessSlug, businessCode: r.businessCode }));
  });
}
