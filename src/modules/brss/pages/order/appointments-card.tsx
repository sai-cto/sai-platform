/** The order page's "Appointments" card: what is booked, and booking another. */
import { can } from '@/core/rbac/permissions';
import type { BusinessContext } from '@/core/tenancy/context';
import { Card, EmptyState } from '@/ui/layout';
import { bookAppointmentAction } from '../../actions';
import { CORE, P } from '../../permissions';
import { isOrderActive } from '../../rules';
import type { getPlaces } from '../../services/catalog';
import type { listTrucks } from '../../services/appointments';
import type { OrderDetail } from '../../services/orders';
import { AppointmentRow } from '../appointment-row';
import { AppointmentForm } from '../forms/appointment-form';
import { Disclosure } from '../parts';

export function AppointmentsCard({
  ctx,
  detail,
  places,
  trucks,
  earliest,
}: {
  ctx: BusinessContext;
  detail: OrderDetail;
  places: Awaited<ReturnType<typeof getPlaces>> | null;
  trucks: Awaited<ReturnType<typeof listTrucks>>;
  earliest: string;
}) {
  const { order, appointments, customer } = detail;
  // Booking stamps the order's campus category, so it needs the order permission too.
  const canBook =
    isOrderActive(order.status) &&
    can(ctx, CORE.schedulingWrite) &&
    can(ctx, P.ordersWrite) &&
    places !== null;

  if (appointments === null) {
    return (
      <Card title="Appointments">
        <p className="text-sm text-zinc-500">You do not have permission to see appointments.</p>
      </Card>
    );
  }
  const activeTrucks = trucks.filter((truck) => truck.isActive);

  return (
    <Card title="Appointments" description="Pickups, deliveries, packing and supplies drop-offs." flush>
      {appointments.length === 0 ? (
        <EmptyState title="Nothing booked yet" />
      ) : (
        <ul className="divide-y divide-zinc-200">
          {appointments.map((visit) => (
            <AppointmentRow
              key={visit.appointment.id}
              ctx={ctx}
              visit={visit}
              trucks={activeTrucks}
              earliest={earliest}
            />
          ))}
        </ul>
      )}
      {canBook ? (
        <Disclosure summary="Book an appointment" open={appointments.length === 0}>
          <AppointmentForm
            action={bookAppointmentAction.bind(null, ctx.business.slug, ctx.environment, order.id)}
            regions={places.regions.map((r) => ({ id: r.id, name: r.name }))}
            buildings={places.buildings.map((b) => ({ id: b.id, name: b.name, regionId: b.regionId }))}
            trucks={activeTrucks.map((t) => ({ id: t.id, name: t.name }))}
            earliest={earliest}
            canOverride={can(ctx, P.appointmentsOverride)}
            defaultPhone={customer?.phone ?? undefined}
          />
        </Disclosure>
      ) : null}
    </Card>
  );
}
