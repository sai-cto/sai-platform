/** Zip zones: which shipping zone a zip code is in, and what each zone costs by weight. */
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { buttonClass } from '@/ui/button';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatMoney } from '@/ui/format';
import { Card, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { createZipZoneAction, removeCatalogItemAction, setZoneRateAction } from '../actions';
import { zipZoneEntity, zoneRateEntity } from '../entities';
import { P } from '../permissions';
import { getZones, lookupShipping } from '../services/catalog';
import { Disclosure, Select } from './parts';

const three = (prefix: number) => String(prefix).padStart(3, '0');

export async function ZonesPage({ ctx, searchParams, basePath }: PortalPageProps) {
  const { zipZones, zoneRates } = await getZones(ctx);
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const canWrite = can(ctx, P.catalogWrite);
  const base = `${basePath}/zones`;
  const zones = [...new Set(zoneRates.map((rate) => rate.zone))].sort((a, b) => a - b);
  const shownZone = zones.find((zone) => String(zone) === searchParams.zone) ?? zones[0];
  const weight = Number.parseInt(searchParams.weight ?? '', 10);
  const looked =
    searchParams.zip && Number.isInteger(weight)
      ? await lookupShipping(ctx, searchParams.zip, weight)
      : null;

  return (
    <>
      <PageHeader
        title="Zip zones"
        description="Shipping is priced from the zone of the zip code and the box's billable weight. Only the first three digits of a zip are used."
      />
      <div className="space-y-5">
        <Card title="Look up a price">
          <form method="get" action={base} className="flex flex-wrap items-end gap-3">
            <Field label="Zip code" htmlFor="z-zip">
              <input id="z-zip" name="zip" inputMode="numeric" required defaultValue={searchParams.zip} className={`${inputClass} w-32`} />
            </Field>
            <Field label="Billable weight (lb)" htmlFor="z-weight">
              <input id="z-weight" name="weight" type="number" min="1" required defaultValue={searchParams.weight} className={`${inputClass} w-32`} />
            </Field>
            <button type="submit" className={buttonClass({ variant: 'primary' })}>
              Look up
            </button>
          </form>
          {looked ? (
            <p role="status" className="mt-3 text-sm text-zinc-800">
              {looked.prefix === null
                ? 'That is not a zip code we can read (digits only, at least three).'
                : looked.zone === null
                  ? `Zips starting ${three(looked.prefix)} are not in any zone, so shipping cannot be priced.`
                  : looked.rate
                    ? `Zone ${looked.zone}. Ship to home: ${formatMoney(looked.rate.shipHomeCents)}. Ship to Cornell: ${formatMoney(looked.rate.shipCornellCents)}.`
                    : `Zone ${looked.zone}, but there is no rate for ${weight} lb in that zone.`}
            </p>
          ) : null}
        </Card>

        <Card title="Zip ranges" description="Ranges cannot overlap." flush>
          <Table>
            <thead>
              <tr>
                <Th>Zips starting</Th>
                <Th className="w-full">Zone</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {zipZones.map((range) => (
                <tr key={range.id}>
                  <Td className="whitespace-nowrap tabular-nums">
                    {three(range.zipLow)} to {three(range.zipHigh)}
                  </Td>
                  <Td className="tabular-nums">Zone {range.zone}</Td>
                  <Td>
                    {canWrite ? (
                      <ConfirmButton
                        action={removeCatalogItemAction.bind(null, slug, mode, zipZoneEntity.key, range.id)}
                        confirmTitle="Remove this zip range?"
                        confirmBody="Boxes shipped to these zips cannot be priced until another range covers them."
                        confirmLabel="Remove"
                      >
                        Remove
                      </ConfirmButton>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {canWrite ? (
            <Disclosure summary="Add a zip range">
              <ActionForm action={createZipZoneAction.bind(null, slug, mode)} submitLabel="Add range" className="flex flex-wrap items-end gap-3 space-y-0">
                <Field label="From (first 3 digits)" htmlFor="zr-low">
                  <input id="zr-low" name="zipLow" type="number" min="0" max="999" required className={`${inputClass} w-28`} />
                </Field>
                <Field label="To (first 3 digits)" htmlFor="zr-high">
                  <input id="zr-high" name="zipHigh" type="number" min="0" max="999" required className={`${inputClass} w-28`} />
                </Field>
                <Field label="Zone" htmlFor="zr-zone">
                  <input id="zr-zone" name="zone" type="number" min="1" max="99" required className={`${inputClass} w-20`} />
                </Field>
              </ActionForm>
            </Disclosure>
          ) : null}
        </Card>

        <Card
          title="Shipping rates"
          description="One price per zone and whole pound. A weight with no row cannot be priced: nothing is rounded up to the next weight."
          flush
        >
          {zones.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">No rates yet.</p>
          ) : (
            <>
              <form method="get" action={base} className="flex flex-wrap items-end gap-3 border-b border-zinc-200 p-3">
                <Field label="Zone" htmlFor="rate-zone">
                  <Select id="rate-zone" name="zone" defaultValue={String(shownZone)} className="w-28">
                    {zones.map((zone) => (
                      <option key={zone} value={zone}>
                        Zone {zone}
                      </option>
                    ))}
                  </Select>
                </Field>
                <button type="submit" className={buttonClass()}>
                  Show
                </button>
              </form>
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>Weight</Th>
                      <Th className="text-right">Ship to home</Th>
                      <Th className="w-full text-right">Ship to Cornell</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {zoneRates
                      .filter((rate) => rate.zone === shownZone)
                      .map((rate) => (
                        <tr key={rate.id}>
                          <Td className="whitespace-nowrap tabular-nums">{rate.weightLb} lb</Td>
                          <Td className="text-right tabular-nums">{formatMoney(rate.shipHomeCents)}</Td>
                          <Td className="text-right tabular-nums">{formatMoney(rate.shipCornellCents)}</Td>
                          <Td>
                            {canWrite ? (
                              <ConfirmButton
                                action={removeCatalogItemAction.bind(null, slug, mode, zoneRateEntity.key, rate.id)}
                                confirmTitle={`Remove the ${rate.weightLb} lb rate for zone ${rate.zone}?`}
                                confirmBody="Boxes of this weight to this zone cannot be priced without it."
                                confirmLabel="Remove"
                              >
                                Remove
                              </ConfirmButton>
                            ) : null}
                          </Td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
          {canWrite ? (
            <Disclosure summary="Set a rate">
              <ActionForm action={setZoneRateAction.bind(null, slug, mode)} submitLabel="Save rate" className="flex flex-wrap items-end gap-3 space-y-0">
                <Field label="Zone" htmlFor="sr-zone">
                  <input id="sr-zone" name="zone" type="number" min="1" max="99" required className={`${inputClass} w-20`} />
                </Field>
                <Field label="Weight (lb)" htmlFor="sr-weight">
                  <input id="sr-weight" name="weightLb" type="number" min="1" max="1000" required className={`${inputClass} w-24`} />
                </Field>
                <Field label="Ship to home ($)" htmlFor="sr-home">
                  <input id="sr-home" name="shipHome" inputMode="decimal" required className={`${inputClass} w-28`} />
                </Field>
                <Field label="Ship to Cornell ($)" htmlFor="sr-cornell">
                  <input id="sr-cornell" name="shipCornell" inputMode="decimal" required className={`${inputClass} w-28`} />
                </Field>
              </ActionForm>
            </Disclosure>
          ) : null}
        </Card>
      </div>
    </>
  );
}
