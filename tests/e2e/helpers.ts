import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';

/** Seed users by role (see src/seed/users.ts). */
export const SEED = {
  superAdmin: 'cto@sai.example',
  tech: 'tech@sai.example',
  executive: 'ceo@sai.example',
  brssAdmin: 'brss.admin@sai.example',
  brssStaff: 'brss.staff@sai.example',
  brssNewHire: 'brss.newhire@sai.example',
  hhmcAdmin: 'hhmc.admin@sai.example',
  multi: 'multi@sai.example',
} as const;

export const ALL_CODES = ['HHMC', 'SARE', 'BRSS', 'CORN', 'CFR', 'TUT', 'CBB', 'BRM', 'CP'];
export const ALL_SLUGS = ALL_CODES.map((c) => c.toLowerCase());

/** Signs in through the dev login page as the seed user with this email. */
export async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/\./g, '\\.')) }).click();
  // Generous: the very first page after the test server starts can take a while to build.
  await expect(page).toHaveURL(/\/console/, { timeout: 30_000 });
}

/** The tabs shown in a business's header, in order. */
export async function tabLabels(page: Page): Promise<string[]> {
  return page.locator('a[data-business-tab]').allInnerTexts();
}

/**
 * Runs SQL against the TEST database as its owner. Tests use this only to arrange things
 * the app deliberately cannot do (for example, making an archive look 40 days old).
 */
export async function asOwner<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.TEST_DATABASE_OWNER_URL as string, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

export async function businessId(slug: string): Promise<string> {
  return asOwner(async (sql) => (await sql`select id from businesses where slug = ${slug}`)[0].id as string);
}

/** The id of one live customer of a business. */
export async function someCustomerId(slug: string): Promise<string> {
  return asOwner(
    async (sql) =>
      (await sql`select c.id from customers c join businesses b on b.id = c.business_id where b.slug = ${slug} and c.environment = 'live' and c.archived_at is null limit 1`)[0].id as string,
  );
}

/** How many businesses are seeded. Tests count rows against this, so a new business needs no test change. */
export async function businessCount(): Promise<number> {
  const [row] = await asOwner((sql) => sql<{ n: number }[]>`select count(*)::int as n from businesses`);
  return row.n;
}
