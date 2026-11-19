/**
 * Local / Intrastate / Interstate from the move's addresses (managers' feedback round 1, Nov 2026).
 *
 *   Interstate   the move touches more than one state: the two addresses, any extra stop, or
 *                the driving route between them (New York → New York City through New Jersey
 *                is Interstate).
 *   Intrastate   one state, and the road distance is over the `localServiceMaxMiles` setting.
 *   Local        one state, up to that distance (or the distance is not known yet).
 *
 * The route is checked on Google Maps when GOOGLE_MAPS_API_KEY is set (services/maps.ts);
 * otherwise only the addresses' states are used and the work request says "route not checked".
 * Pure functions here; the database side is in jobs.ts (applyServiceType) and builder.ts.
 */
import { JOB_TYPES, isJobTypeFor } from '../rules';
import type { ServiceType } from '../schema';
import { stateOfAddress } from './us-states';

/** The job type a service type starts with (never blank: managers saw "-"). */
export const DEFAULT_JOB_TYPE: Record<ServiceType, string> = {
  local: 'Local Full Service Move',
  intrastate: 'Intrastate Move',
  interstate: 'Interstate Move',
};

/** Keeps the job type when it belongs to the service type; otherwise that type's default. */
export function jobTypeFor(serviceType: ServiceType, jobType: string | null | undefined): string {
  return jobType && isJobTypeFor(serviceType, jobType) ? jobType : (DEFAULT_JOB_TYPE[serviceType] ?? JOB_TYPES[serviceType][0]);
}

export type ServiceTypeDecision = {
  /** Null when the addresses do not say which state they are in. */
  serviceType: ServiceType | null;
  /** Every state the move touches (addresses, stops and, when checked, the route). */
  states: string[];
  /** True when the driving route was checked for the states it crosses. */
  routeChecked: boolean;
  /** One line for staff: why this service type. */
  reason: string;
};

export function decideServiceType(input: {
  stops: (string | null)[];
  /** States the driving route passes through, or null when the route was not checked. */
  routeStates: string[] | null;
  /** Road miles × 10, or null when unknown. */
  distanceTenths: number | null;
  localMaxMiles: number;
}): ServiceTypeDecision {
  const addressStates = input.stops.filter((a): a is string => Boolean(a?.trim())).map((a) => stateOfAddress(a));
  const known = addressStates.filter((s): s is string => s !== null);
  const routeChecked = input.routeStates !== null;
  const states = [...new Set([...known, ...(input.routeStates ?? [])])].sort();
  if (states.length > 1) {
    const via = (input.routeStates ?? []).filter((s) => !known.includes(s));
    return {
      serviceType: 'interstate',
      states,
      routeChecked,
      reason: via.length
        ? `The route passes through ${via.join(', ')}.`
        : `The addresses are in ${states.join(' and ')}.`,
    };
  }
  if (known.length === 0 || known.length < addressStates.length) {
    return { serviceType: null, states, routeChecked, reason: 'The state of an address is not clear: add the state or ZIP code.' };
  }
  const miles = input.distanceTenths === null ? null : input.distanceTenths / 10;
  if (miles !== null && miles > input.localMaxMiles) {
    return { serviceType: 'intrastate', states, routeChecked, reason: `In ${states[0]}, ${miles.toFixed(1)} mi (over ${input.localMaxMiles} mi).` };
  }
  return {
    serviceType: 'local',
    states,
    routeChecked,
    reason: miles === null ? `In ${states[0]}; distance not known yet.` : `In ${states[0]}, ${miles.toFixed(1)} mi (up to ${input.localMaxMiles} mi).`,
  };
}
