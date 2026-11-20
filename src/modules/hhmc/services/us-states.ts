/**
 * Which US state an address is in, from the address text alone (no outside service): a state
 * code ("Ithaca, NY 14850"), a state name ("Newark, New Jersey"), "NYC", or the ZIP code.
 * Used to decide Local / Intrastate / Interstate when the route cannot be checked on a map.
 */

export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};

const CODES = new Set(Object.keys(STATE_NAMES));

/** First three ZIP digits → state (USPS ranges). Checked last: a written state always wins. */
// prettier-ignore
const ZIP3: [number, number, string][] = [
  [5, 5, 'NY'], [6, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'],
  [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'], [100, 149, 'NY'], [150, 196, 'PA'],
  [197, 199, 'DE'], [200, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'],
  [270, 289, 'NC'], [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'],
  [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'], [430, 459, 'OH'],
  [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'],
  [569, 569, 'DC'], [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'],
  [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'], [700, 715, 'LA'], [716, 729, 'AR'],
  [730, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'],
  [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'],
  [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
];

function stateOfZip(zip: string): string | null {
  const prefix = Number(zip.slice(0, 3));
  return ZIP3.find(([from, to]) => prefix >= from && prefix <= to)?.[2] ?? null;
}

const NAME_TO_CODE = Object.entries(STATE_NAMES)
  .map(([code, name]) => ({ code, name: name.toLowerCase() }))
  // Longest first, so "West Virginia" is found before "Virginia".
  .sort((a, b) => b.name.length - a.name.length);

/** "NY", "New Jersey" or "new jersey" → "NY" / "NJ"; anything else → null. */
export function stateCode(value: string): string | null {
  const v = value.trim();
  if (CODES.has(v.toUpperCase()) && v.length === 2) return v.toUpperCase();
  return NAME_TO_CODE.find((s) => s.name === v.toLowerCase())?.code ?? null;
}

/**
 * The state of a US address, or null when the text does not say. Looks, in order, for a state
 * code after a comma ("…, NY 14850", "…, NY"), "NYC" / "New York City", a state name, and the
 * ZIP code.
 */
export function stateOfAddress(address: string | null | undefined): string | null {
  const text = (address ?? '').trim();
  if (!text) return null;
  // A two-letter code as its own part of the address, nearest the end ("Ithaca, NY 14850, USA").
  const parts = text.split(',').map((p) => p.trim()).reverse();
  for (const part of parts) {
    const m = /^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/.exec(part);
    if (m && CODES.has(m[1].toUpperCase()) && m[1] === m[1].toUpperCase()) return m[1].toUpperCase();
  }
  if (/\b(nyc|new york city)\b/i.test(text)) return 'NY';
  const zip = /\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/.exec(text)?.[1];
  const byZip = zip ? stateOfZip(zip) : null;
  if (byZip) return byZip;
  // A state name, but never in the street part ("12 Virginia Rd, Ithaca" is not in Virginia).
  const places = parts.length > 1 ? parts.slice(0, -1) : [text.replace(/^.*\d+\s+\S+\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|way|blvd|ct|pl)\b/i, '')];
  for (const place of places) {
    const lower = ` ${place.toLowerCase().replace(/[^a-z ]/g, ' ')} `;
    const named = NAME_TO_CODE.find((s) => lower.endsWith(` ${s.name} `) || lower.trim() === s.name);
    if (named) return named.code;
  }
  return null;
}
