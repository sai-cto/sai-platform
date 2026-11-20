/**
 * Pricing and automatic emails, Movegistics vs SAI: every line item's rate, every discount, and
 * every email automation's trigger, delay and template, read back from the database after the
 * import. A difference is listed with its reason when SAI keeps its own value on purpose.
 */
import type { Scope } from '../../src/core/db/scope';
import { hhmcAutomationRules, hhmcCatalogItems, hhmcDiscounts, hhmcTemplates } from '../../src/modules/hhmc/schema';
import type { NPricing } from './settings-pricing';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export async function pricingReport(s: Scope, p: NPricing): Promise<{ markdown: string; differences: number; summary: string }> {
  const [catalog, discounts, rules, templates] = await Promise.all([
    s.db.select().from(hhmcCatalogItems).where(s.where(hhmcCatalogItems)),
    s.db.select().from(hhmcDiscounts).where(s.where(hhmcDiscounts)),
    s.db.select().from(hhmcAutomationRules).where(s.where(hhmcAutomationRules)),
    s.db.select().from(hhmcTemplates).where(s.where(hhmcTemplates)),
  ]);
  const gaps: string[] = [];
  const rows: string[] = [];
  for (const want of p.catalog) {
    const have = catalog.find((c) => c.name === want.name && c.isActive);
    const ok = have && have.rateCents === want.rateCents && have.unit === want.unit && have.section === want.section;
    rows.push(`| ${want.name} | ${money(want.rateCents)} / ${want.unit} | ${have ? `${money(have.rateCents)} / ${have.unit}` : 'missing'} | ${ok ? 'match' : '**differs**'} |`);
    if (!ok) gaps.push(`Line item "${want.name}": Movegistics ${money(want.rateCents)}/${want.unit}, SAI ${have ? `${money(have.rateCents)}/${have.unit}` : 'missing'}.`);
  }
  for (const want of p.discounts) {
    const have = discounts.find((d) => d.name === want.name);
    if (!have || have.percentBp !== want.percentBp || have.isActive !== want.isActive)
      gaps.push(`Discount "${want.name}": Movegistics ${want.percentBp / 100}%, SAI ${have ? `${have.percentBp / 100}%` : 'missing'}.`);
  }
  for (const want of p.rules) {
    const have = rules.find((r) => r.key === want.key);
    const ok = have && have.trigger === want.trigger && have.delayMinutes === want.delayMinutes && have.templateKey === want.templateKey && have.isActive === want.isActive;
    if (!ok) gaps.push(`Email automation "${want.name}": not set up as in Movegistics (trigger ${want.trigger}, ${want.delayMinutes} min, template ${want.templateKey}).`);
    if (!templates.some((t) => t.key === want.templateKey)) gaps.push(`Email automation "${want.name}": its template "${want.templateKey}" is missing.`);
  }
  const extra = catalog.filter((c) => c.isActive && !p.catalog.some((w) => w.name === c.name)).map((c) => c.name);
  if (extra.length) gaps.push(`Active catalog items not in Movegistics: ${extra.join(', ')}.`);

  const headline = gaps.length === 0
    ? `**Pricing and emails match Movegistics:** ${p.catalog.length} catalog items, ${p.discounts.length} discounts, ${p.rules.length} email automations.`
    : `**Pricing and emails: ${gaps.length} difference(s).**`;
  const markdown = [
    '## Pricing and automatic emails',
    '',
    headline,
    '',
    ...gaps.map((g) => `- ${g}`),
    ...(p.skipped.length ? ['', 'Left out on purpose:', '', ...p.skipped.map((x) => `- ${x.what}: ${x.why}.`)] : []),
    '',
    '| Line item | Movegistics | SAI | |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  const summary = [headline.replace(/\*\*/g, ''), ...gaps.map((g) => `  ${g}`), ...p.skipped.map((x) => `  left out: ${x.what} (${x.why})`)].join('\n');
  return { markdown, differences: gaps.length, summary };
}
