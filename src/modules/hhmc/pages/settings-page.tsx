/**
 * HHMC Settings: one simple page per area (managers: "The organization of the settings … is so
 * mixed up it's almost impossible to remember where everything is"; "Automations and tags are
 * all separate"). Areas: Line items (by cost category), Discounts, Automatic emails ("When X →
 * send Y", with the email text right there; no tags), Documents and branding, Trucks.
 * The numbers (deposit %, tax %, card fee %, long-distance miles, Cornellian $/hr, branding)
 * are module settings in the console's Settings tab (tech team).
 */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatMoney } from '@/ui/format';
import { Card, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { addTruckAction, catalogItemAction, newCatalogItemAction, ruleAction, runDueEmailsAction, templateAction } from '../actions';
import { CORE, P } from '../permissions';
import type { AutomationTrigger } from '../schema';
import { CATEGORIES, UNITS } from '../services/settings';
import { settingsPage } from '../services/views';
import { brandOf, loadSettings } from '../settings';
import { Disclosure } from './disclosure';
import { areaClass } from './jobs';
import { Check, Select } from './parts';

const AREAS = [
  { key: 'items', label: 'Line items' },
  { key: 'discounts', label: 'Discounts' },
  { key: 'emails', label: 'Automatic emails' },
  { key: 'documents', label: 'Documents and branding' },
  { key: 'trucks', label: 'Trucks' },
] as const;
type Area = (typeof AREAS)[number]['key'];

export const TRIGGER_TEXT: Record<AutomationTrigger, string> = {
  estimate_sent: 'an estimate is sent',
  lead_no_contact: 'a lead can’t be reached ("Couldn’t reach" on the lead)',
  payment_received: 'a payment comes in',
  job_booked: 'a move is booked',
  invoice_sent: 'an invoice is sent',
  invoice_paid: 'an invoice is paid in full',
};

function delayParts(minutes: number): { amount: number; unit: 'days' | 'hours' | 'minutes' } {
  if (minutes % 1440 === 0) return { amount: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' };
  return { amount: minutes, unit: 'minutes' };
}
const delayText = (minutes: number) => {
  if (minutes === 0) return 'straight away';
  const { amount, unit } = delayParts(minutes);
  return `after ${amount} ${amount === 1 ? unit.slice(0, -1) : unit}`;
};

export async function SettingsPage({ ctx, searchParams, basePath }: PortalPageProps) {
  const [data, settings] = await Promise.all([settingsPage(ctx), loadSettings(ctx)]);
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const canWrite = can(ctx, P.catalogWrite);
  const isTech = ctx.role === 'tech' || ctx.role === 'super_admin';
  const area: Area = AREAS.find((a) => a.key === searchParams.area)?.key ?? 'items';
  const consoleSettings = can(ctx, 'business.settings.read') ? <Link className="underline" href={`/console/${slug}/settings`}>Settings tab</Link> : 'Settings tab (tech team)';
  const templateFor = (key: string) => data.templates.find((t) => t.key === key);
  const brand = brandOf(settings, ctx.business.name);

  return (
    <>
      <PageHeader title="Settings" description="One page per area. Pick one below." />
      <nav aria-label="Settings areas" className="mb-5 flex flex-wrap gap-1 border-b border-zinc-200">
        {AREAS.map((a) => (
          <Link
            key={a.key}
            href={`${basePath}/settings?area=${a.key}`}
            aria-current={a.key === area ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${a.key === area ? 'border-zinc-900 font-medium text-zinc-900' : 'border-transparent text-zinc-600 hover:text-zinc-900'}`}
          >
            {a.label}
          </Link>
        ))}
      </nav>

      {area === 'items' ? (
        <div className="space-y-5">
          <p className="text-sm text-zinc-600">
            The ready-made lines you pick on an estimate, grouped by cost category. The estimate builder uses the &quot;N Men&quot;, truck (&quot;16&apos; Truck Local&quot;, &quot;… Long Distance - Day&quot; / &quot;- Mileage&quot;) and &quot;Packing Labor&quot; items by name. Long distance starts at {settings.longDistanceMiles} miles; the Cornellian discount is ${settings.cornellianDiscountPerHour}/hr ({consoleSettings}).
          </p>
          {canWrite ? (
            <Card title="Add a line item">
              <ActionForm action={newCatalogItemAction.bind(null, slug, mode)} submitLabel="Add line item">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Name" htmlFor="ni-name"><input id="ni-name" name="name" required className={inputClass} placeholder="e.g. Moving Blankets" /></Field>
                  <Field label="Cost category" htmlFor="ni-cat">
                    <Select id="ni-cat" name="category" defaultValue="Packing Materials">
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </Field>
                  <Field label="Per" htmlFor="ni-unit">
                    <Select id="ni-unit" name="unit" defaultValue="each">
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </Select>
                  </Field>
                  <Field label="Rate ($)" htmlFor="ni-rate"><input id="ni-rate" name="rate" required inputMode="decimal" className={inputClass} placeholder="e.g. 12.50" /></Field>
                </div>
              </ActionForm>
            </Card>
          ) : null}
          {CATEGORIES.filter((c) => data.catalog.some((i) => i.category === c)).map((category) => (
            <Card key={category} title={category} flush>
              <Table>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Per</Th>
                    <Th className="text-right">Rate</Th>
                    <Th>{canWrite ? 'Change' : 'Active'}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.catalog.filter((i) => i.category === category).map((c) => (
                    <tr key={c.id}>
                      <Td>{c.name}{c.isDefaultForLocal ? <span className="block text-xs text-zinc-500">Added to every new local work request</span> : null}</Td>
                      <Td>{c.unit}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(c.rateCents)}</Td>
                      <Td>
                        {canWrite ? (
                          <ActionForm action={catalogItemAction.bind(null, slug, mode, c.id)} submitLabel="Save" submitVariant="ghost" resetOnSuccess={false} className="flex flex-wrap items-center gap-2 space-y-0">
                            <input aria-label={`Rate for ${c.name}`} name="rate" defaultValue={(c.rateCents / 100).toFixed(2)} inputMode="decimal" className={`${inputClass} w-24`} />
                            <Check name="isActive" label="Active" defaultChecked={c.isActive} />
                          </ActionForm>
                        ) : c.isActive ? 'Yes' : 'No'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      ) : null}

      {area === 'discounts' ? (
        <Card title="Discounts" description="Pick one on a work request's quote; it applies to every line. The Cornellian discount is per labor hour instead: tick “Cornellian” in the estimate builder.">
          <ul className="space-y-1 text-sm">
            {data.discounts.map((d) => <li key={d.id}>{`${d.name} · ${d.percentBp / 100}%${d.isActive ? '' : ' (off)'}`}</li>)}
            <li>{`Cornellian · $${settings.cornellianDiscountPerHour} per labor hour`}</li>
          </ul>
        </Card>
      ) : null}

      {area === 'emails' ? (
        <div className="space-y-5">
          <p className="text-sm text-zinc-600">Every automatic email in one place: when something happens, wait, then send. No tags. Marketing emails respect a work request&apos;s &quot;follow-up emails&quot; switch; receipts and notices always go.</p>
          {isTech && can(ctx, P.automationsRun) ? (
            <Card title="Send due emails now" description="There is no scheduler yet: queued emails go out when this is pressed (or when `npm run hhmc:automations` runs). Each is checked again before it is sent.">
              <ConfirmButton action={runDueEmailsAction.bind(null, slug, mode)} variant="primary" size="md">Run due emails</ConfirmButton>
            </Card>
          ) : null}
          <Card flush>
            <ul className="divide-y divide-zinc-100">
              {data.rules.map((r) => {
                const t = templateFor(r.templateKey);
                const { amount, unit } = delayParts(r.delayMinutes);
                return (
                  <li key={r.id} className="space-y-2 p-4">
                    <p className="text-sm">
                      <span className="text-zinc-500">When </span>
                      <span className="font-medium">{TRIGGER_TEXT[r.trigger]}</span>
                      <span className="text-zinc-500">{` → ${delayText(r.delayMinutes)} → send `}</span>
                      <span className="font-medium">{t ? `“${t.subject || t.name}”` : r.templateKey}</span>
                      {r.isActive ? null : <span className="ml-2 text-xs text-amber-700">(off)</span>}
                    </p>
                    {canWrite ? (
                      <ActionForm action={ruleAction.bind(null, slug, mode, r.id)} submitLabel="Save" submitVariant="ghost" resetOnSuccess={false} className="flex flex-wrap items-center gap-2 space-y-0">
                        <span className="text-xs text-zinc-500">Wait</span>
                        <input aria-label={`Wait for ${r.name}`} name="delay" defaultValue={amount} inputMode="numeric" className={`${inputClass} w-16`} />
                        <Select aria-label={`Wait unit for ${r.name}`} name="delayUnit" defaultValue={unit}>
                          <option value="minutes">minutes</option>
                          <option value="hours">hours</option>
                          <option value="days">days</option>
                        </Select>
                        <Check name="isActive" label="On" defaultChecked={r.isActive} />
                      </ActionForm>
                    ) : null}
                    {t && canWrite ? (
                      <Disclosure summary="Edit the email">
                        <ActionForm action={templateAction.bind(null, slug, mode, t.id)} submitLabel="Save email" resetOnSuccess={false}>
                          <Field label="Subject" htmlFor={`tpl-s-${r.id}`}><input id={`tpl-s-${r.id}`} name="subject" defaultValue={t.subject} className={inputClass} /></Field>
                          <Field label="Text" htmlFor={`tpl-b-${r.id}`} help="{{firstName}}, {{link}}, {{estimateTotal}} and similar are filled in when sent."><textarea id={`tpl-b-${r.id}`} name="body" rows={6} defaultValue={t.body} className={areaClass} /></Field>
                        </ActionForm>
                      </Disclosure>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ) : null}

      {area === 'documents' ? (
        <div className="space-y-5">
          <Card title="Branding on estimates and invoices" description={<>Changed in the console&apos;s {consoleSettings}.</>}>
            <div className="overflow-hidden rounded-md border border-zinc-200 text-sm">
              <div className="px-4 py-3 text-white" style={{ backgroundColor: brand.color }}>{brand.header}</div>
              <div className="space-y-1 px-4 py-3 text-zinc-600">
                <p>{brand.contact || 'No company details yet.'}</p>
                <p className="text-xs">{brand.footer}</p>
              </div>
            </div>
          </Card>
          <Card title="Terms, valuation and other email wording" flush>
            <ul className="divide-y divide-zinc-100">
              {data.templates
                .filter((t) => t.kind === 'terms' || !data.rules.some((r) => r.templateKey === t.key))
                .map((t) => (
                  <li key={t.id}>
                    {canWrite ? (
                      <Disclosure summary={t.name}>
                        <ActionForm action={templateAction.bind(null, slug, mode, t.id)} submitLabel="Save" resetOnSuccess={false}>
                          {t.kind === 'email' ? <Field label="Subject" htmlFor={`tpl-s-${t.id}`}><input id={`tpl-s-${t.id}`} name="subject" defaultValue={t.subject} className={inputClass} /></Field> : <input type="hidden" name="subject" value="" />}
                          <Field label="Text" htmlFor={`tpl-b-${t.id}`}><textarea id={`tpl-b-${t.id}`} name="body" rows={6} defaultValue={t.body} className={areaClass} /></Field>
                        </ActionForm>
                      </Disclosure>
                    ) : (
                      <p className="px-4 py-2.5 text-sm">{t.name}</p>
                    )}
                  </li>
                ))}
            </ul>
          </Card>
          <p className="text-sm text-zinc-600">{`Deposit ${settings.depositPercent}% · service tax ${settings.serviceTaxPercent}% · card fee ${settings.convenienceFeePercent}% · ${settings.roundingMinutes}-minute billing · estimates expire after ${settings.estimateExpiryDays} days.`} Changed in the {consoleSettings}.</p>
        </div>
      ) : null}

      {area === 'trucks' ? (
        can(ctx, CORE.schedulingRead) ? (
          <Card title="Trucks" description="Each booked move day takes one truck per truck needed.">
            <ul className="mb-3 space-y-1 text-sm">{data.trucks.map((t) => <li key={t.id}>{t.name}</li>)}</ul>
            {can(ctx, CORE.schedulingWrite) ? (
              <ActionForm action={addTruckAction.bind(null, slug, mode)} submitLabel="Add truck" submitVariant="secondary">
                <Field label="Name" htmlFor="truck-name"><input id="truck-name" name="name" placeholder="Truck 4 · 22'" className={inputClass} /></Field>
              </ActionForm>
            ) : null}
          </Card>
        ) : (
          <p className="text-sm text-zinc-600">You do not have access to trucks.</p>
        )
      ) : null}
    </>
  );
}
