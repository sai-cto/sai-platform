/**
 * The nine Student Agencies businesses, as DATA. Nothing else in the codebase names a
 * business: the sidebar, registry and dashboards all read the businesses table.
 * Final accent colours and why they differ from the brand colours: docs/DECISIONS.md.
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
    accentColor: '#5A5A5A',
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
    accentColor: '#C8102E',
  },
  {
    slug: 'tut',
    code: 'TUT',
    name: 'Student Agencies Tutoring',
    description: 'Tutoring service',
    accentColor: '#8B1E2D',
  },
  {
    slug: 'cbb',
    code: 'CBB',
    name: 'Cornell Bigger Beds',
    description: 'Dorm bed extension service',
    accentColor: '#9B1C1C',
  },
  {
    slug: 'brm',
    code: 'BRM',
    name: 'Big Red Mailroom',
    description: 'Mailroom service',
    accentColor: '#B3322A',
  },
  {
    slug: 'cp',
    code: 'CP',
    name: 'Campus Promotions',
    description:
      'Marketing campaigns for local and national businesses targeting Cornell and Ithaca College students',
    accentColor: '#111111',
  },
];
