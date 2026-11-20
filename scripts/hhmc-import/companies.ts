/**
 * Movegistics' Companies export. Almost every row is a copy of a contact that an earlier system
 * migration created (same email, or the same legacy "External Reference"): those rows are kept on
 * that contact's customer as their own import link, never as a second customer. The rest are real
 * organizations and become customers of kind "organization".
 */
import { day, normEmail, normPhone, parseCsv, rawOf, type NContact, type Raw } from './movegistics';

export type NCompanyLink = { sid: string; contactSid: string; raw: Raw };
export type NOrganization = { sid: string; name: string; email: string | null; phone: string | null; notes: string | null; createdOn: string | null; raw: Raw };
export type NCompanies = { links: NCompanyLink[]; organizations: NOrganization[] };

const text = (v: string | undefined) => (v && v.trim() && v.trim() !== '-' ? v.trim() : null);
const refOf = (v: string | undefined) => text(v)?.toUpperCase() ?? null;

export function normalizeCompanies(csv: string, contacts: NContact[]): NCompanies {
  const byEmail = new Map<string, NContact>();
  const byRef = new Map<string, NContact>();
  for (const c of contacts) {
    if (c.email && !byEmail.has(c.email)) byEmail.set(c.email, c);
    // A merged duplicate's legacy reference points at the contact it was merged into.
    for (const raw of [c.raw, ...c.duplicates.map((d) => d.raw)]) {
      const ref = refOf(raw['External Reference']);
      if (ref && !byRef.has(ref)) byRef.set(ref, c);
      const email = normEmail(raw['Email Address']);
      if (email && !byEmail.has(email)) byEmail.set(email, c);
    }
  }
  const links: NCompanyLink[] = [];
  const organizations: NOrganization[] = [];
  for (const r of parseCsv(csv)) {
    const sid = text(r['Company ID']);
    if (!sid) continue;
    const email = normEmail(r['Company Email']) ?? normEmail(r['Billing Email Address']);
    const ref = refOf(r['External Reference']);
    // Email first: a legacy reference is older and sometimes points at another member of a household.
    const contact = (email && byEmail.get(email)) || (ref && byRef.get(ref)) || null;
    if (contact) {
      links.push({ sid, contactSid: contact.sid, raw: rawOf(r) });
      continue;
    }
    const notes = [text(r['About']), text(r['Internal Note'])].filter(Boolean).join('\n\n');
    organizations.push({
      sid,
      name: text(r['Company Name']) ?? sid,
      email,
      phone: normPhone(r['Company Phone Number']) ?? normPhone(r['Billing Contact Number']),
      notes: notes || null,
      createdOn: day(r['Company Created Date']),
      raw: rawOf(r),
    });
  }
  return { links, organizations };
}
