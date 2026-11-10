/** The fields of an order, shared by "New order" and "Change details". */
import { Field, inputClass } from '@/ui/layout';
import { ORDER_SERVICES, STORAGE_TERMS } from '../rules';
import type { brssOrders } from '../schema';
import { Check, Select } from './parts';

type Order = typeof brssOrders.$inferSelect;

export function CustomerFields({
  customers,
  canCreate,
}: {
  customers: { id: string; name: string; email: string | null }[];
  canCreate: boolean;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-zinc-900">Customer</legend>
      <Field
        label="Existing customer"
        htmlFor="o-customer"
        help={canCreate ? 'Or leave this empty and fill in a new customer below.' : undefined}
        className="sm:max-w-md"
      >
        <Select id="o-customer" name="customerId" defaultValue="" required={!canCreate}>
          <option value="">{canCreate ? 'New customer (fill in below)' : 'Choose…'}</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
              {customer.email ? ` · ${customer.email}` : ''}
            </option>
          ))}
        </Select>
      </Field>
      {canCreate ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="First name" htmlFor="o-first">
            <input id="o-first" name="firstName" maxLength={80} className={inputClass} />
          </Field>
          <Field label="Last name" htmlFor="o-last">
            <input id="o-last" name="lastName" maxLength={80} className={inputClass} />
          </Field>
          <Field label="Email" htmlFor="o-email">
            <input id="o-email" name="email" type="email" className={inputClass} />
          </Field>
          <Field label="Phone" htmlFor="o-phone">
            <input id="o-phone" name="phone" type="tel" maxLength={40} className={inputClass} />
          </Field>
        </div>
      ) : null}
    </fieldset>
  );
}

export function OrderFields({ order }: { order?: Order }) {
  return (
    <>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-zinc-900">Services</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ORDER_SERVICES.map((service) => (
            <Check
              key={service.key}
              name="services"
              value={service.key}
              label={service.label}
              defaultChecked={order?.services.includes(service.key)}
            />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Storage term" htmlFor="o-term" help="Needed for a storage order.">
          <Select id="o-term" name="storageTermMonths" defaultValue={order?.storageTermMonths ?? ''}>
            <option value="">Not a storage order</option>
            {STORAGE_TERMS.map((term) => (
              <option key={term.months} value={term.months}>
                {term.label}
              </option>
            ))}
            {order?.storageTermMonths &&
            !STORAGE_TERMS.some((term) => term.months === order.storageTermMonths) ? (
              <option value={order.storageTermMonths}>{order.storageTermMonths} months</option>
            ) : null}
          </Select>
        </Field>
        <Field label="NetID" htmlFor="o-netid">
          <input id="o-netid" name="netId" maxLength={100} defaultValue={order?.netId ?? ''} className={inputClass} />
        </Field>
        <div className="flex items-end pb-1.5">
          <Check
            name="counter"
            label="Walk-in order at the counter"
            defaultChecked={order?.campusCategory === 'counter'}
          />
        </div>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-zinc-900">
          Shipping destination{' '}
          <span className="font-normal text-zinc-500">(needed for ship to home)</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Addressed to" htmlFor="o-ship-name">
            <input id="o-ship-name" name="shipToName" maxLength={120} defaultValue={order?.shipToName ?? ''} className={inputClass} />
          </Field>
          <Field label="Street address" htmlFor="o-ship-a1">
            <input id="o-ship-a1" name="shipToAddress1" maxLength={200} defaultValue={order?.shipToAddress1 ?? ''} className={inputClass} />
          </Field>
          <Field label="Apartment, suite (optional)" htmlFor="o-ship-a2">
            <input id="o-ship-a2" name="shipToAddress2" maxLength={200} defaultValue={order?.shipToAddress2 ?? ''} className={inputClass} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City" htmlFor="o-ship-city">
              <input id="o-ship-city" name="shipToCity" maxLength={80} defaultValue={order?.shipToCity ?? ''} className={inputClass} />
            </Field>
            <Field label="State" htmlFor="o-ship-state">
              <input id="o-ship-state" name="shipToState" maxLength={40} defaultValue={order?.shipToState ?? ''} className={inputClass} />
            </Field>
            <Field label="Zip" htmlFor="o-ship-zip">
              <input id="o-ship-zip" name="shipToZip" maxLength={10} inputMode="numeric" defaultValue={order?.shipToZip ?? ''} className={inputClass} />
            </Field>
          </div>
        </div>
      </fieldset>
      <Field label="Notes" htmlFor="o-notes">
        <textarea
          id="o-notes"
          name="notes"
          rows={2}
          maxLength={2000}
          defaultValue={order?.notes ?? ''}
          className={`${inputClass} h-auto py-1.5`}
        />
      </Field>
    </>
  );
}
