/**
 * CUSTOMER LINKS: signed, expiring, single-purpose links for people without an account
 * (a customer reviewing an estimate, paying an invoice). Approved by the CTO for Phase 5
 * (docs/DECISIONS.md, P5-1).
 *
 *   token = base64url(payload) + "." + base64url(HMAC-SHA256(payload, LINK_SIGNING_SECRET))
 *   payload = { b: business id, e: live|sandbox, p: purpose, s: subject id, x: expiry (unix s) }
 *
 * - Nothing is stored: a link proves itself. Its business and environment are inside the
 *   signed payload, so a sandbox link can never reach live data, nor one business another's.
 * - A module declares each purpose in its manifest (`linkPurposes`) with the exact permissions
 *   the link may use. buildLinkContext() gives the visitor those and nothing else.
 * - Revocation: the module's services refuse a link whose subject is no longer in the right
 *   state (a void estimate, a paid invoice). Changing the secret revokes every link.
 */
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { businessModules, businesses } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { isUuid } from '../ids';
import type { LinkFile } from '../modules/contract';
import { getModule } from '../modules/registry';
import type { BusinessContext, Environment } from '../tenancy/context';

/** What a link context carries on top of a normal one. */
export type LinkGrant = { purpose: string; subjectId: string; expiresAt: Date };

type Payload = { b: string; e: Environment; p: string; s: string; x: number };

export { LINK_ALLOWED_CORE_PERMISSIONS } from './allowed';

function secret(): Buffer {
  const value = process.env.LINK_SIGNING_SECRET ?? '';
  // A short or missing secret would make links guessable: refuse rather than sign weakly.
  if (value.length < 32)
    throw new ValidationError('Customer links are not set up: LINK_SIGNING_SECRET is missing or too short. Run "npm run setup".');
  return Buffer.from(value, 'utf8');
}

function mac(body: string): Buffer {
  return crypto.createHmac('sha256', secret()).update(body).digest();
}

/** Creates a link token. Call it from a service that has already checked the caller may share this subject. */
export function signLink(
  ctx: BusinessContext,
  input: { purpose: string; subjectId: string; expiresAt: Date },
): string {
  const purpose = findPurpose(ctx.business.moduleKey, input.purpose);
  if (!purpose) throw new Error(`Unknown link purpose "${input.purpose}".`);
  if (!isUuid(input.subjectId)) throw new Error('A link needs a record id.');
  const payload: Payload = {
    b: ctx.business.id,
    e: ctx.environment,
    p: input.purpose,
    s: input.subjectId,
    x: Math.floor(input.expiresAt.getTime() / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(body).toString('base64url')}`;
}

/** Checks a token. Anything wrong (tampered, expired, other purpose) is a plain "not found". */
export function verifyLink(token: string, now: Date = new Date()): Payload {
  if (typeof token !== 'string' || token.length > 1000) throw new NotFoundError();
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) throw new NotFoundError();
  const given = Buffer.from(signature, 'base64url');
  let expected: Buffer;
  try {
    expected = mac(body);
  } catch (error) {
    console.error(error); // not configured: no link can be checked, so none is valid
    throw new NotFoundError();
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected))
    throw new NotFoundError();
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
  } catch {
    throw new NotFoundError();
  }
  if (
    !isUuid(payload.b) ||
    !isUuid(payload.s) ||
    (payload.e !== 'live' && payload.e !== 'sandbox') ||
    typeof payload.p !== 'string' ||
    typeof payload.x !== 'number'
  )
    throw new NotFoundError();
  if (payload.x * 1000 <= now.getTime()) throw new NotFoundError();
  return payload;
}

function findPurpose(moduleKey: string | null, key: string) {
  const mod = moduleKey ? getModule(moduleKey) : undefined;
  return mod?.linkPurposes?.find((p) => p.key === key);
}

/**
 * The context for someone holding a valid link. The actor is "Customer (link)" with no user
 * id; its permissions are exactly the purpose's; `link` names the one record it is about.
 * The business must still exist, have this module enabled and its customer portal switched on.
 */
export async function buildLinkContext(
  token: string,
  now: Date = new Date(),
): Promise<BusinessContext & { link: LinkGrant }> {
  const payload = verifyLink(token, now);
  const [row] = await getDb()
    .select({
      id: businesses.id,
      slug: businesses.slug,
      code: businesses.code,
      name: businesses.name,
      timeZone: businesses.timeZone,
      accentColor: businesses.accentColor,
      description: businesses.description,
      moduleKey: businessModules.moduleKey,
      enabled: businessModules.enabled,
      customerPortal: businessModules.customerPortalEnabled,
    })
    .from(businesses)
    .innerJoin(businessModules, eq(businessModules.businessId, businesses.id))
    .where(eq(businesses.id, payload.b))
    .limit(1);
  if (!row || !row.enabled || !row.customerPortal) throw new NotFoundError();
  const purpose = findPurpose(row.moduleKey, payload.p);
  if (!purpose) throw new NotFoundError();
  return {
    kind: 'business',
    actor: { id: null, name: 'Customer (link)', email: '', platformRole: null },
    role: 'customer_link',
    business: {
      id: row.id,
      slug: row.slug,
      code: row.code,
      name: row.name,
      timeZone: row.timeZone,
      accentColor: row.accentColor,
      description: row.description,
      moduleKey: row.moduleKey,
    },
    environment: payload.e,
    permissions: new Set(purpose.permissions),
    link: { purpose: payload.p, subjectId: payload.s, expiresAt: new Date(payload.x * 1000) },
  };
}

/** For module services: is this context a link for exactly this purpose and record? */
export function linkFor(ctx: BusinessContext, purpose: string, subjectId: string): boolean {
  return ctx.link?.purpose === purpose && ctx.link.subjectId === subjectId;
}

/**
 * A file a link's purpose serves by name (LinkPurposeDef.files), e.g. the terms PDF of an
 * estimate link. Anything wrong (bad token, a purpose without files, an unknown name) is
 * "not found".
 */
export async function openLinkFile(token: string, name: string): Promise<LinkFile> {
  const ctx = await buildLinkContext(token);
  const purpose = findPurpose(ctx.business.moduleKey, ctx.link?.purpose ?? '');
  const file = purpose?.files ? await purpose.files(ctx, name) : null;
  if (!file) throw new NotFoundError();
  return file;
}
