/**
 * The nine Student Agencies businesses, as DATA. Nothing else in the codebase names a
 * business: the sidebar, registry and dashboards all read the businesses table.
 * Accent colours were adjusted from the brand colours so the nine are distinguishable in the
 * sidebar (five of the originals were near-identical reds, two were black). The table of
 * brand colour → final colour, and the reasoning, is in docs/DECISIONS.md (P2-1).
 */
export type SeedBusiness = {
  slug: string;
  code: string;
  name: string;
  description: string;
  accentColor: string;
  secondaryColor?: string;
};

export const SEED_BUSINESSES: SeedBusiness[] = [
  {
    slug: 'hhmc',
    code: 'HHMC',
    name: 'Hired Hands Moving Company',
    description: 'Student moving company',
    accentColor: '#1F4E9C',
    secondaryColor: '#F28C28',
  },
  {
    slug: 'sare',
    code: 'SARE',
    name: 'Student Agencies Real Estate',
    description:
      "Leasing and management of SAI's owned and affiliated properties: apartments, commercial spaces, eHub",
    accentColor: '#6B6B6B',
  },
  {
    slug: 'brss',
    code: 'BRSS',
    name: 'Big Red Shipping & Storage',
    description: "Shipping and storage for the Cornell community; Cornell's preferred vendor",
    accentColor: '#E2231A',
    secondaryColor: '#000000',
  },
  {
    slug: 'corn',
    code: 'CORN',
    name: 'The Cornellian',
    description: "Cornell University's official yearbook",
    accentColor: '#1A1A1A',
  },
  {
    slug: 'cfr',
    code: 'CFR',
    name: 'Cornell Freshman Register',
    description: 'First-year guide produced by The Cornellian',
    accentColor: '#C2185B',
  },
  {
    slug: 'tut',
    code: 'TUT',
    name: 'Student Agencies Tutoring',
    description: 'Tutoring service',
    accentColor: '#6B1238',
  },
  {
    slug: 'cbb',
    code: 'CBB',
    name: 'Cornell Bigger Beds',
    description: 'Dorm bed extension service',
    accentColor: '#D9580D',
  },
  {
    slug: 'brm',
    code: 'BRM',
    name: 'Big Red Mailroom',
    description: 'Mailroom service',
    accentColor: '#7A5230',
  },
  {
    slug: 'cp',
    code: 'CP',
    name: 'Campus Promotions',
    description:
      'Marketing campaigns for local and national businesses targeting Cornell and Ithaca College students',
    accentColor: '#3A3F6B',
  },
];
