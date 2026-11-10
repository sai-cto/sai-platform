/** Operations: warehouses, trucks and their crews, and the regions and buildings BRSS serves. */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatNumber } from '@/ui/format';
import { Card, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import {
  addCrewAction,
  createBuildingAction,
  createRegionAction,
  createTruckAction,
  createWarehouseAction,
  removeCatalogItemAction,
  removeCrewAction,
  setBuildingCampusAction,
  setTruckActiveAction,
  setWarehouseActiveAction,
} from '../actions';
import { buildingEntity } from '../entities';
import { CORE, P } from '../permissions';
import { crewCandidates, listTrucks } from '../services/appointments';
import { warehouseCounts } from '../services/articles';
import { getPlaces } from '../services/catalog';
import { CAMPUS_LABELS, Disclosure, Select } from './parts';

export async function OperationsPage({ ctx, basePath }: PortalPageProps) {
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const seesTrucks = can(ctx, CORE.schedulingRead);
  const [places, counts, trucks, candidates] = await Promise.all([
    getPlaces(ctx),
    can(ctx, P.articlesRead) ? warehouseCounts(ctx) : [],
    seesTrucks ? listTrucks(ctx) : [],
    crewCandidates(ctx),
  ]);
  const canCatalog = can(ctx, P.catalogWrite);
  const canSchedule = can(ctx, CORE.schedulingWrite);
  const countFor = (warehouseId: string | null) =>
    counts.find((row) => row.warehouseId === warehouseId)?.n ?? 0;

  return (
    <>
      <PageHeader title="Operations" description="Where things are kept, who moves them, and where BRSS picks up and delivers." />
      <div className="space-y-5">
        <Card title="Warehouses" description="Articles still in BRSS's hands, by warehouse." flush>
          <Table>
            <thead>
              <tr>
                <Th className="w-full">Warehouse</Th>
                <Th className="text-right">Articles there now</Th>
                <Th>In use</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {places.warehouses.map((warehouse) => (
                <tr key={warehouse.id}>
                  <Td className="font-medium">
                    <Link href={`${basePath}/articles?warehouse=${warehouse.id}`} className="underline-offset-2 hover:underline">
                      {warehouse.name}
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(countFor(warehouse.id))}</Td>
                  <Td>{warehouse.isActive ? <Badge tone="green">In use</Badge> : <Badge>Not in use</Badge>}</Td>
                  <Td>
                    {canCatalog ? (
                      <ConfirmButton action={setWarehouseActiveAction.bind(null, slug, mode, warehouse.id, !warehouse.isActive)}>
                        {warehouse.isActive ? 'Stop using' : 'Use again'}
                      </ConfirmButton>
                    ) : null}
                  </Td>
                </tr>
              ))}
              <tr>
                <Td className="text-zinc-500">No location yet</Td>
                <Td className="text-right tabular-nums">{formatNumber(countFor(null))}</Td>
                <Td />
                <Td />
              </tr>
            </tbody>
          </Table>
          {canCatalog ? (
            <Disclosure summary="Add a warehouse">
              <ActionForm action={createWarehouseAction.bind(null, slug, mode)} submitLabel="Add warehouse" className="flex flex-wrap items-end gap-3 space-y-0">
                <Field label="Name" htmlFor="w-name">
                  <input id="w-name" name="name" required maxLength={80} className={`${inputClass} sm:w-64`} />
                </Field>
              </ActionForm>
            </Disclosure>
          ) : null}
        </Card>

        {seesTrucks ? (
          <Card title="Trucks and crews" description="A truck's crew is copied onto an appointment when the truck is assigned to it." flush>
            {trucks.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">No trucks yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-200">
                {trucks.map((truck) => (
                  <li key={truck.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-medium text-zinc-900">{truck.name}</span>
                      {truck.isActive ? <Badge tone="green">In use</Badge> : <Badge>Not in use</Badge>}
                      {canSchedule ? (
                        <ConfirmButton action={setTruckActiveAction.bind(null, slug, mode, truck.id, !truck.isActive)}>
                          {truck.isActive ? 'Stop using' : 'Use again'}
                        </ConfirmButton>
                      ) : null}
                    </div>
                    <ul className="flex flex-wrap gap-2">
                      {truck.crew.length === 0 ? <li className="text-sm text-zinc-500">No crew yet</li> : null}
                      {truck.crew.map((member) => (
                        <li key={member.id} className="flex items-center gap-1.5 rounded-md border border-zinc-200 py-0.5 pr-0.5 pl-2 text-sm">
                          {member.name}
                          {canSchedule ? (
                            <ConfirmButton action={removeCrewAction.bind(null, slug, mode, member.id)} variant="ghost">
                              Remove
                            </ConfirmButton>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {canSchedule && truck.isActive ? (
                      <ActionForm action={addCrewAction.bind(null, slug, mode, truck.id)} submitLabel="Add to crew" className="flex flex-wrap items-end gap-3 space-y-0">
                        {candidates.length > 0 ? (
                          <Field label="Team member" htmlFor={`crew-user-${truck.id}`}>
                            <Select id={`crew-user-${truck.id}`} name="userId" className="w-52" defaultValue="">
                              <option value="">Someone without a login</option>
                              {candidates.map((candidate) => (
                                <option key={candidate.userId} value={candidate.userId}>
                                  {candidate.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        ) : null}
                        <Field label={candidates.length > 0 ? 'or a name' : 'Name'} htmlFor={`crew-name-${truck.id}`}>
                          <input id={`crew-name-${truck.id}`} name="name" maxLength={120} className={`${inputClass} w-52`} />
                        </Field>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canSchedule ? (
              <Disclosure summary="Add a truck">
                <ActionForm action={createTruckAction.bind(null, slug, mode)} submitLabel="Add truck" className="flex flex-wrap items-end gap-3 space-y-0">
                  <Field label="Name" htmlFor="t-name">
                    <input id="t-name" name="name" required maxLength={80} className={`${inputClass} sm:w-64`} />
                  </Field>
                </ActionForm>
              </Disclosure>
            ) : null}
          </Card>
        ) : null}

        <Card
          title="Regions and buildings"
          description="An order's campus category (for financial reports) comes from the building of its first appointment. A region with no buildings asks for a street address instead."
          flush
        >
          {places.regions.map((region) => {
            const buildings = places.buildings.filter((b) => b.regionId === region.id);
            return (
              <details key={region.id} className="group border-b border-zinc-200">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm select-none [&::-webkit-details-marker]:hidden">
                  <span className="font-medium text-zinc-900">
                    <span className="mr-1.5 inline-block text-zinc-400 transition-transform group-open:rotate-90">›</span>
                    {region.name}
                  </span>
                  <span className="text-zinc-500">
                    {buildings.length === 0 ? 'Street address' : `${buildings.length} buildings`}
                  </span>
                </summary>
                {buildings.length > 0 ? (
                  <Table>
                    <thead>
                      <tr>
                        <Th className="w-full">Building</Th>
                        <Th>Campus category</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {buildings.map((building) => {
                        const other = building.campusCategory === 'on_campus' ? 'off_campus' : 'on_campus';
                        return (
                          <tr key={building.id}>
                            <Td>{building.name}</Td>
                            <Td className="whitespace-nowrap">{CAMPUS_LABELS[building.campusCategory]}</Td>
                            <Td>
                              {canCatalog ? (
                                <span className="flex justify-end gap-2">
                                  <ConfirmButton action={setBuildingCampusAction.bind(null, slug, mode, building.id, other)}>
                                    Make {CAMPUS_LABELS[other].toLowerCase()}
                                  </ConfirmButton>
                                  <ConfirmButton
                                    action={removeCatalogItemAction.bind(null, slug, mode, buildingEntity.key, building.id)}
                                    confirmTitle={`Remove ${building.name}?`}
                                    confirmBody="It can no longer be chosen for new appointments. Existing appointments keep it."
                                    confirmLabel="Remove"
                                  >
                                    Remove
                                  </ConfirmButton>
                                </span>
                              ) : null}
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                ) : null}
              </details>
            );
          })}
          {canCatalog ? (
            <>
              <Disclosure summary="Add a building">
                <ActionForm action={createBuildingAction.bind(null, slug, mode)} submitLabel="Add building">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Region" htmlFor="bd-region">
                      <Select id="bd-region" name="regionId">
                        {places.regions.map((region) => (
                          <option key={region.id} value={region.id}>
                            {region.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Name" htmlFor="bd-name">
                      <input id="bd-name" name="name" required maxLength={120} className={inputClass} />
                    </Field>
                    <Field label="Campus category" htmlFor="bd-campus">
                      <Select id="bd-campus" name="campusCategory">
                        <option value="on_campus">On campus</option>
                        <option value="off_campus">Off campus</option>
                      </Select>
                    </Field>
                  </div>
                </ActionForm>
              </Disclosure>
              <Disclosure summary="Add a region">
                <ActionForm action={createRegionAction.bind(null, slug, mode)} submitLabel="Add region" className="flex flex-wrap items-end gap-3 space-y-0">
                  <Field label="Name" htmlFor="rg-name">
                    <input id="rg-name" name="name" required maxLength={80} className={`${inputClass} sm:w-64`} />
                  </Field>
                  <Field label="Position in lists" htmlFor="rg-order">
                    <input id="rg-order" name="sortOrder" type="number" min="0" max="999" defaultValue="50" className={`${inputClass} w-24`} />
                  </Field>
                </ActionForm>
              </Disclosure>
            </>
          ) : null}
        </Card>
      </div>
    </>
  );
}
