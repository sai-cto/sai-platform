/**
 * The estimate builder form on the Job page (managers' requirements, Nov 2026): crew and hours
 * (1 or 3 labor lines), Cornellian, materials and notes on each location. Since the managers'
 * feedback round 1 it no longer asks for the truck, distance, packing help or coverage: the
 * picked trucks (or one 16' truck), the stored mileage and Basic Coverage are priced as before,
 * and any line can still be changed in the quote editor. Saving adds the priced lines.
 */
import { ActionForm } from '@/ui/action-form';
import { Field, inputClass } from '@/ui/layout';
import { buildQuoteAction } from '../actions';
import { ACCESS_FLAGS, type AccessFlag, type hhmcJobs } from '../schema';
import { formatQty, type SectionKey } from '../services/pricing';
import { Check, Select } from './parts';

export const ACCESS_LABELS: Record<AccessFlag, string> = {
  stairs: 'Stairs',
  elevator: 'Elevator',
  long_carry: 'Long carry',
  split_load: 'Split loading / unloading',
  fragile: 'Fragile or precious items',
  unusual_items: 'Unusual items',
};

type Job = typeof hhmcJobs.$inferSelect;
type Item = { id: string; name: string; section: SectionKey; unit: string; rateCents: number; category: string };

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/** The truck priced when no truck is picked on the work request (the builder no longer asks). */
const DEFAULT_TRUCK_SIZE = '16';

export function EstimateBuilder({
  slug,
  mode,
  job,
  catalog,
  hasLines,
  pickedTrucks = [],
  cornellianPerHour,
}: {
  slug: string;
  mode: string;
  job: Job;
  catalog: Item[];
  hasLines: boolean;
  /** Names of the trucks picked on the work request. */
  pickedTrucks?: string[];
  cornellianPerHour: number;
}) {
  const materials = catalog.filter((c) => c.section === 'packing_materials' || (c.category === 'Equipment' && !/truck/i.test(c.name)));
  const crews = [...new Set(catalog.map((c) => /^(\d+) Men$/.exec(c.name)?.[1]).filter(Boolean))].map(Number).sort((a, b) => a - b);
  const miles = job.distanceTenths !== null ? (job.distanceTenths / 10).toFixed(1) : '';
  return (
    <div className="space-y-4">
      <ActionForm action={buildQuoteAction.bind(null, slug, mode, job.id)} submitLabel={hasLines ? 'Add to quote' : 'Build quote'} resetOnSuccess={false}>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-1 text-sm font-medium">Crew and time</legend>
          <Field label="Movers" htmlFor="b-crew">
            <Select id="b-crew" name="crewSize" defaultValue={String(crews.includes(job.crewSize) ? job.crewSize : (crews[0] ?? 2))}>
              {crews.map((n) => <option key={n} value={n}>{`${n} movers`}</option>)}
            </Select>
          </Field>
          <Field label="Hours as" htmlFor="b-mode">
            <Select id="b-mode" name="hoursMode" defaultValue="split">
              <option value="split">Load, drive, unload (3 lines)</option>
              <option value="total">One total (1 line)</option>
            </Select>
          </Field>
          <Field label="Load (h)" htmlFor="b-load"><input id="b-load" name="loadHours" inputMode="decimal" className={inputClass} placeholder="e.g. 2" /></Field>
          <Field label="Drive (h)" htmlFor="b-drive"><input id="b-drive" name="driveHours" inputMode="decimal" className={inputClass} defaultValue={job.driveMinutes ? formatQty(Math.round((job.driveMinutes * 100) / 60)) : ''} placeholder="e.g. 0.5" /></Field>
          <Field label="Unload (h)" htmlFor="b-unload"><input id="b-unload" name="unloadHours" inputMode="decimal" className={inputClass} placeholder="e.g. 1.5" /></Field>
          <Field label="Or total (h)" htmlFor="b-total" help="Used when 'One total' is chosen."><input id="b-total" name="totalHours" inputMode="decimal" className={inputClass} /></Field>
          <div className="flex items-end pb-2 sm:col-span-2">
            <Check name="cornellian" defaultChecked={job.cornellian} label={`Cornellian: movers' rate $${cornellianPerHour}/hr lower`} />
          </div>
        </fieldset>

        {/* Truck, distance, packing and coverage are not asked here any more (managers' feedback
            round 1): the stored values and the usual choices are sent as they are. */}
        {job.ownTruck ? <input type="hidden" name="ownTruck" value="on" /> : null}
        {pickedTrucks.length ? <input type="hidden" name="usePickedTrucks" value="on" /> : null}
        <input type="hidden" name="truckSize" value={DEFAULT_TRUCK_SIZE} />
        <input type="hidden" name="truckCount" value={Math.max(job.trucks, 1)} />
        <input type="hidden" name="truckDays" value="1" />
        <input type="hidden" name="miles" value={miles} />
        <input type="hidden" name="driveMinutes" value={job.driveMinutes ?? ''} />
        <input type="hidden" name="valuation" value="on" />

        {materials.length ? (
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Materials (quantity)</legend>
            <div className="grid gap-x-3 gap-y-2 sm:grid-cols-3">
              {materials.map((m) => (
                <label key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0">{m.name}<span className="block text-xs text-zinc-500">{`${usd(m.rateCents)} / ${m.unit}`}</span></span>
                  <input name={`m:${m.id}`} inputMode="decimal" aria-label={`${m.name} quantity`} className={`${inputClass} w-20`} placeholder="0" />
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium">The locations</legend>
          {(['origin', 'destination'] as const).map((end) => (
            <div key={end} className="space-y-2">
              <p className="text-sm font-medium">{end === 'origin' ? `Pick-up: ${job.originAddress ?? 'no address yet'}` : `Drop-off: ${job.destinationAddress ?? 'no address yet'}`}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {ACCESS_FLAGS.map((flag) => (
                  <label key={flag} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name={`${end}Access`} value={flag} defaultChecked={(end === 'origin' ? job.originAccess : job.destinationAccess).includes(flag)} />
                    {ACCESS_LABELS[flag]}
                  </label>
                ))}
              </div>
              <textarea name={`${end}Notes`} aria-label={`${end === 'origin' ? 'Pick-up' : 'Drop-off'} notes`} rows={2} defaultValue={(end === 'origin' ? job.originNotes : job.destinationNotes) ?? ''} placeholder="Floor, stairs, parking, items that need care…" className={inputClass} />
            </div>
          ))}
        </fieldset>
        {hasLines ? <Check name="replace" label="Replace all lines already on the quote (a truck line already there is always replaced)" /> : null}
      </ActionForm>
    </div>
  );
}
