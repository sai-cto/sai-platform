/**
 * HHMC settings data: catalog and rates, discounts, templates, automation rules, trucks, and
 * the tech team's "Run due emails" (no scheduler yet). The numbers (deposit %, tax %, card fee
 * %, rounding, expiry, capacity) are in the console's Settings tab.
 */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatMoney } from '@/ui/format';
import { Card, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { addTruckAction, catalogItemAction, ruleAction, runDueEmailsAction, templateAction } from '../actions';
import { CORE, P } from '../permissions';
import { sectionLabel } from '../services/pricing';
import { settingsPage } from '../services/views';
import { loadSettings } from '../settings';
import { Disclosure } from './disclosure';
import { areaClass } from './jobs';
import { Check } from './parts';

const delayText = (minutes: number) =>
  minutes === 0 ? 'At once' : minutes % 1440 === 0 ? `${minutes / 1440} day${minutes === 1440 ? '' : 's'}` : minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;

export async function SettingsPage({ ctx }: PortalPageProps) {
  const [data, settings] = await Promise.all([settingsPage(ctx), loadSettings(ctx)]);
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const canWrite = can(ctx, P.catalogWrite);
  const isTech = ctx.role === 'tech' || ctx.role === 'super_admin';

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          <>
            Prices, discounts, templates and automatic emails. Deposit {settings.depositPercent}%, service tax {settings.serviceTaxPercent}%, card fee{' '}
            {settings.convenienceFeePercent}%, {settings.roundingMinutes}-minute billing and {settings.estimateExpiryDays}-day estimates are changed in the{' '}
            {can(ctx, 'business.settings.read') ? <Link className="underline" href={`/console/${slug}/settings`}>Settings tab</Link> : 'Settings tab (tech team)'}.
          </>
        }
      />
      <div className="space-y-5">
        {isTech && can(ctx, P.automationsRun) ? (
          <Card title="Run due emails" description="There is no scheduler yet: queued emails go out when this is pressed (or when `npm run hhmc:automations` runs). Each email is checked again before it is sent.">
            <ConfirmButton action={runDueEmailsAction.bind(null, slug, mode)} variant="primary" size="md">Run due emails</ConfirmButton>
          </Card>
        ) : null}

        <Card title="Catalog and rates" description="Line items for quotes (ref §4.1). One list for labor, trucks and packing materials." flush>
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Section</Th>
                <Th>Unit</Th>
                <Th className="text-right">Rate</Th>
                {canWrite ? <Th>Change</Th> : <Th>Active</Th>}
              </tr>
            </thead>
            <tbody>
              {data.catalog.map((c) => (
                <tr key={c.id}>
                  <Td>{c.name}{c.isDefaultForLocal ? <span className="block text-xs text-zinc-500">Added to every new local job</span> : null}</Td>
                  <Td className="text-xs">{sectionLabel(c.section)}</Td>
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

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Discounts" description="Pick one on the Job page; it applies to every line (ref §4.3).">
            <ul className="space-y-1 text-sm">
              {data.discounts.map((d) => <li key={d.id}>{`${d.name} · ${d.percentBp / 100}%${d.isActive ? '' : ' (off)'}`}</li>)}
            </ul>
          </Card>
          {can(ctx, CORE.schedulingRead) ? (
            <Card title="Trucks" description="Each booked job day takes one truck per truck needed.">
              <ul className="mb-3 space-y-1 text-sm">{data.trucks.map((t) => <li key={t.id}>{t.name}</li>)}</ul>
              {can(ctx, CORE.schedulingWrite) ? (
                <ActionForm action={addTruckAction.bind(null, slug, mode)} submitLabel="Add truck" submitVariant="secondary">
                  <Field label="Name" htmlFor="truck-name"><input id="truck-name" name="name" placeholder="Truck 4 · 22'" className={inputClass} /></Field>
                </ActionForm>
              ) : null}
            </Card>
          ) : null}
        </div>

        <Card title="Automatic emails" description="Rules are data (ref §9.2). Marketing emails respect the job's opt-in; receipts and notices always go." flush>
          <Table>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>When</Th>
                <Th>Delay</Th>
                <Th>Opt-in</Th>
                <Th>{canWrite ? 'Change' : 'On'}</Th>
              </tr>
            </thead>
            <tbody>
              {data.rules.map((r) => (
                <tr key={r.id}>
                  <Td>{r.name}</Td>
                  <Td className="text-xs">{r.trigger.replace(/_/g, ' ')}</Td>
                  <Td>{delayText(r.delayMinutes)}</Td>
                  <Td>{r.respectsOptIn ? 'Yes' : 'No'}</Td>
                  <Td>
                    {canWrite ? (
                      <ActionForm action={ruleAction.bind(null, slug, mode, r.id)} submitLabel="Save" submitVariant="ghost" resetOnSuccess={false} className="flex flex-wrap items-center gap-2 space-y-0">
                        <input aria-label={`Delay in minutes for ${r.name}`} name="delayMinutes" defaultValue={r.delayMinutes} inputMode="numeric" className={`${inputClass} w-20`} />
                        <Check name="isActive" label="On" defaultChecked={r.isActive} />
                      </ActionForm>
                    ) : r.isActive ? 'Yes' : 'No'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Templates" description="Terms & Conditions by service type, valuation, and email wording. {{firstName}}, {{link}} and similar are filled in when sent." flush>
          <ul className="divide-y divide-zinc-100">
            {data.templates.map((t) => (
              <li key={t.id}>
                {canWrite ? (
                  <Disclosure summary={`${t.name}${t.kind === 'terms' ? ' (terms)' : ''}`}>
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
      </div>
    </>
  );
}
