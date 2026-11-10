import { expect, type Page } from '@playwright/test';

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

/** Signs in through the dev login page as the seed user with this email. */
export async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/\./g, '\\.')) }).click();
  await expect(page).toHaveURL(/\/console/);
}
