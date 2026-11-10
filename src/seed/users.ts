/**
 * Fake test users covering every role. None of these are real people; every address uses
 * the reserved example domain. They exist so each role can be tried locally with dev login.
 */
import type { BusinessRole, PlatformRole } from '@/core/rbac/roles';

export type SeedUser = {
  email: string;
  name: string;
  platformRole?: PlatformRole;
  memberships?: { business: string; role: BusinessRole; grants?: 'default' | 'none' | string[] }[];
};

const admin = (slug: string, name: string): SeedUser => ({
  email: `${slug}.admin@sai.example`,
  name,
  memberships: [{ business: slug, role: 'business_admin' }],
});

export const SEED_USERS: SeedUser[] = [
  { email: 'cto@sai.example', name: 'Sam Super (CTO)', platformRole: 'super_admin' },
  { email: 'tech@sai.example', name: 'Tessa Tech', platformRole: 'tech' },
  { email: 'ceo@sai.example', name: 'Eli Executive (CEO)', platformRole: 'executive' },

  admin('hhmc', 'Hana HHMC-Admin'),
  admin('sare', 'Sol SARE-Admin'),
  admin('brss', 'Blake BRSS-Admin'),
  admin('corn', 'Cory CORN-Admin'),
  admin('cfr', 'Frankie CFR-Admin'),
  admin('tut', 'Toni TUT-Admin'),
  admin('cbb', 'Bea CBB-Admin'),
  admin('brm', 'Remy BRM-Admin'),
  admin('cp', 'Pat CP-Admin'),

  // Staff with the default grants a business admin would give a new hire.
  {
    email: 'brss.staff@sai.example',
    name: 'Shay BRSS-Staff',
    memberships: [{ business: 'brss', role: 'business_staff', grants: 'default' }],
  },
  {
    email: 'hhmc.staff@sai.example',
    name: 'Hollis HHMC-Staff',
    memberships: [{ business: 'hhmc', role: 'business_staff', grants: 'default' }],
  },
  // Staff with nothing granted: shows what "limited to what the admin grants" looks like.
  {
    email: 'brss.newhire@sai.example',
    name: 'Nico BRSS-NewHire',
    memberships: [{ business: 'brss', role: 'business_staff', grants: 'none' }],
  },
  // One person, two businesses, a different role in each.
  {
    email: 'multi@sai.example',
    name: 'Morgan Multi',
    memberships: [
      { business: 'tut', role: 'business_admin' },
      { business: 'cbb', role: 'business_staff', grants: 'default' },
    ],
  },
];
