'use server';

/**
 * BRSS server actions: what the portal's forms and buttons call.
 *
 * Every action builds the context from the signed-in session (never from what the browser
 * sent), calls one service, and returns { ok, message }. All checking is in the services.
 */
import { redirect } from 'next/navigation';
import type { BusinessContext } from '@/core/tenancy/context';
import { act, text } from '@/server/actions';
import { parseMode, requireBusinessContext } from '@/server/session';
import type { ActionResult } from '@/ui/action-form';
import {
  assignTruck,
  addCrewMember,
  bookAppointment,
  createBlock,
  createTruck,
  removeBlock,
  removeCrewMember,
  rescheduleAppointment,
  setAppointmentStatus,
  setTruckActive,
} from './services/appointments';
import {
  attachArticle,
  detachArticle,
  intakeArticle,
  setArticleLocation,
  setArticleStatus,
  setOrderArticlesStatus,
  updateArticleOnOrder,
} from './services/articles';
import {
  createBuilding,
  createProduct,
  createRegion,
  createWarehouse,
  createZipZone,
  removeCatalogItem,
  setBuildingCampusCategory,
  setStorageTermProduct,
  setWarehouseActive,
  setZoneRate,
  updateProduct,
} from './services/catalog';
import {
  addCharge,
  payOrder,
  recalculateOrder,
  refundOrderPayment,
  removeCharge,
} from './services/charges';
import { createOrder, setOrderStatus, updateOrder } from './services/orders';

type Form = ActionResult | null;

/** Runs `fn` with the signed-in person's context for this business and mode. */
function run(
  slug: string,
  mode: string,
  fn: (ctx: BusinessContext) => Promise<string | void>,
): Promise<ActionResult> {
  return act(async () => fn(await requireBusinessContext(slug, parseMode(mode))));
}

const ticked = (form: FormData, name: string) => form.get(name) === 'on';
const all = (form: FormData, name: string) =>
  form.getAll(name).filter((value): value is string => typeof value === 'string');
const unpriced = (problems: string[]) =>
  problems.length > 0 ? ` Some charges could not be worked out: ${problems.join(' ')}` : '';

/** Where the staff portal lives in the console. */
const portalPath = (ctx: BusinessContext) =>
  `/console/${ctx.business.slug}/${ctx.environment}/app`;

// ---------------------------------------------------------------- orders

function orderFields(form: FormData) {
  return {
    services: all(form, 'services'),
    storageTermMonths: text(form, 'storageTermMonths') || null,
    netId: text(form, 'netId'),
    counter: ticked(form, 'counter'),
    shipToName: text(form, 'shipToName'),
    shipToAddress1: text(form, 'shipToAddress1'),
    shipToAddress2: text(form, 'shipToAddress2'),
    shipToCity: text(form, 'shipToCity'),
    shipToState: text(form, 'shipToState'),
    shipToZip: text(form, 'shipToZip'),
    notes: text(form, 'notes'),
  };
}

export async function createOrderAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const order = await createOrder(ctx, {
      ...orderFields(form),
      customerId: text(form, 'customerId'),
      firstName: text(form, 'firstName'),
      lastName: text(form, 'lastName'),
      email: text(form, 'email'),
      phone: text(form, 'phone'),
    });
    redirect(`${portalPath(ctx)}/orders/${order.id}`);
  });
}

export async function updateOrderAction(
  slug: string,
  mode: string,
  orderId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    const { problems } = await updateOrder(ctx, orderId, orderFields(form));
    return `Saved.${unpriced(problems)}`;
  });
}

export async function setOrderStatusAction(
  slug: string,
  mode: string,
  orderId: string,
  status: string,
) {
  return run(slug, mode, async (ctx) => {
    await setOrderStatus(ctx, orderId, status);
  });
}

// ---------------------------------------------------------------- articles

function articleFields(form: FormData) {
  return {
    type: text(form, 'type'),
    description: text(form, 'description'),
    weightLb: text(form, 'weightLb') || 0,
    lengthIn: text(form, 'lengthIn') || 0,
    widthIn: text(form, 'widthIn') || 0,
    heightIn: text(form, 'heightIn') || 0,
    productId: text(form, 'productId'),
    quantity: text(form, 'quantity') || 1,
    insurance: text(form, 'insurance') || 0,
    otherStoragePrice: text(form, 'otherStoragePrice'),
    cornellShippingAccount: ticked(form, 'cornellShippingAccount'),
    receivedFromZip: text(form, 'receivedFromZip'),
  };
}

export async function intakeArticleAction(
  slug: string,
  mode: string,
  orderId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    const { articles, problems } = await intakeArticle(ctx, orderId, articleFields(form));
    const numbers = articles.map((a) => a.articleNumber).join(', ');
    return `Added ${numbers}.${unpriced(problems)}`;
  });
}

export async function updateArticleAction(
  slug: string,
  mode: string,
  orderId: string,
  articleId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    const { problems } = await updateArticleOnOrder(ctx, orderId, articleId, articleFields(form));
    return `Saved.${unpriced(problems)}`;
  });
}

export async function attachArticleAction(
  slug: string,
  mode: string,
  orderId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    const { problems } = await attachArticle(ctx, orderId, text(form, 'articleId'));
    return `Added to this order.${unpriced(problems)}`;
  });
}

export async function detachArticleAction(
  slug: string,
  mode: string,
  orderId: string,
  articleId: string,
) {
  return run(slug, mode, async (ctx) => {
    await detachArticle(ctx, orderId, articleId);
  });
}

export async function setArticleStatusAction(
  slug: string,
  mode: string,
  articleId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    await setArticleStatus(ctx, articleId, text(form, 'status'));
    return 'Status saved.';
  });
}

export async function setOrderArticlesStatusAction(
  slug: string,
  mode: string,
  orderId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    const count = await setOrderArticlesStatus(ctx, orderId, text(form, 'status'));
    return `Status set on ${count} article${count === 1 ? '' : 's'}.`;
  });
}

export async function setArticleLocationAction(
  slug: string,
  mode: string,
  articleId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    const article = await setArticleLocation(ctx, articleId, {
      warehouseId: text(form, 'warehouseId'),
      section: text(form, 'section'),
      row: text(form, 'row'),
      pallet: text(form, 'pallet'),
    });
    return article.status === 'stored' ? 'Location saved. Status: Stored.' : 'Location saved.';
  });
}

// ---------------------------------------------------------------- charges and payments

export async function addChargeAction(
  slug: string,
  mode: string,
  orderId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    await addCharge(ctx, orderId, {
      productId: text(form, 'productId'),
      description: text(form, 'description'),
      price: text(form, 'price'),
      quantity: text(form, 'quantity') || 1,
    });
    return 'Charge added.';
  });
}

export async function removeChargeAction(slug: string, mode: string, itemId: string) {
  return run(slug, mode, async (ctx) => {
    await removeCharge(ctx, itemId);
  });
}

export async function recalculateAction(slug: string, mode: string, orderId: string) {
  return run(slug, mode, async (ctx) => {
    await recalculateOrder(ctx, orderId);
  });
}

export async function payOrderAction(
  slug: string,
  mode: string,
  orderId: string,
  _p: Form,
  form: FormData,
): Promise<ActionResult> {
  // A declined card is not an error to roll back (the failed attempt stays on record), but
  // the form must still show it as a failure.
  let declined: string | null = null;
  const result = await run(slug, mode, async (ctx) => {
    const outcome = await payOrder(ctx, orderId, {
      discount: text(form, 'discount') || '0',
      tip: text(form, 'tip') || '0',
      method: text(form, 'method'),
      cardToken: text(form, 'cardToken') || undefined,
      idempotencyKey: text(form, 'idempotencyKey'),
      acceptUnpriced: ticked(form, 'acceptUnpriced'),
    });
    if (!outcome.paid) declined = outcome.message;
    return outcome.message;
  });
  return declined ? { ok: false, message: declined } : result;
}

export async function refundAction(
  slug: string,
  mode: string,
  orderId: string,
  paymentId: string,
  _p: Form,
  form: FormData,
): Promise<ActionResult> {
  let refused = false;
  const result = await run(slug, mode, async (ctx) => {
    const refund = await refundOrderPayment(ctx, orderId, paymentId, {
      amount: text(form, 'amount'),
      reason: text(form, 'reason'),
    });
    refused = refund.status !== 'succeeded';
    return 'Refund sent.';
  });
  return refused
    ? { ok: false, message: 'The payment provider refused the refund. Nothing was refunded.' }
    : result;
}

// ---------------------------------------------------------------- appointments

function whenFields(form: FormData) {
  return {
    date: text(form, 'date'),
    slot: text(form, 'slot'),
    override: ticked(form, 'override'),
    overrideReason: text(form, 'overrideReason'),
  };
}

export async function bookAppointmentAction(
  slug: string,
  mode: string,
  orderId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    await bookAppointment(ctx, {
      ...whenFields(form),
      orderId,
      type: text(form, 'type'),
      regionId: text(form, 'regionId'),
      buildingId: text(form, 'buildingId'),
      address1: text(form, 'address1'),
      address2: text(form, 'address2'),
      room: text(form, 'room'),
      city: text(form, 'city'),
      zip: text(form, 'zip'),
      hasElevator: ticked(form, 'hasElevator'),
      phone: text(form, 'phone'),
      estimatedBoxes: text(form, 'estimatedBoxes') || 0,
      estimatedOtherItems: text(form, 'estimatedOtherItems') || 0,
      packingHours: text(form, 'packingHours') || 0,
      truckId: text(form, 'truckId'),
      notes: text(form, 'notes'),
    });
    return 'Appointment booked.';
  });
}

export async function rescheduleAction(
  slug: string,
  mode: string,
  appointmentId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    await rescheduleAppointment(ctx, appointmentId, whenFields(form));
    return 'Appointment moved.';
  });
}

export async function setAppointmentStatusAction(
  slug: string,
  mode: string,
  appointmentId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    const { emailed } = await setAppointmentStatus(ctx, appointmentId, text(form, 'status'));
    return emailed ? `Saved. Confirmation emailed to ${emailed}.` : 'Saved.';
  });
}

export async function assignTruckAction(
  slug: string,
  mode: string,
  appointmentId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    await assignTruck(ctx, appointmentId, text(form, 'truckId'));
    return 'Saved.';
  });
}

export async function createBlockAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await createBlock(ctx, {
      startDate: text(form, 'startDate'),
      endDate: text(form, 'endDate') || text(form, 'startDate'),
      allDay: ticked(form, 'allDay'),
      slots: all(form, 'slots'),
      buildingIds: all(form, 'buildingIds'),
      reason: text(form, 'reason'),
    });
    return 'Unavailability added.';
  });
}

export async function removeBlockAction(slug: string, mode: string, id: string) {
  return run(slug, mode, async (ctx) => {
    await removeBlock(ctx, id);
  });
}

// ---------------------------------------------------------------- trucks and crews

export async function createTruckAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await createTruck(ctx, { name: text(form, 'name') });
    return 'Truck added.';
  });
}

export async function setTruckActiveAction(
  slug: string,
  mode: string,
  truckId: string,
  isActive: boolean,
) {
  return run(slug, mode, async (ctx) => {
    await setTruckActive(ctx, truckId, isActive === true);
  });
}

export async function addCrewAction(
  slug: string,
  mode: string,
  truckId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    await addCrewMember(ctx, truckId, { name: text(form, 'name') });
    return 'Added.';
  });
}

export async function removeCrewAction(slug: string, mode: string, crewId: string) {
  return run(slug, mode, async (ctx) => {
    await removeCrewMember(ctx, crewId);
  });
}

// ---------------------------------------------------------------- reference data

export async function createRegionAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await createRegion(ctx, { name: text(form, 'name'), sortOrder: text(form, 'sortOrder') || 0 });
    return 'Region added.';
  });
}

export async function createBuildingAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await createBuilding(ctx, {
      regionId: text(form, 'regionId'),
      name: text(form, 'name'),
      campusCategory: text(form, 'campusCategory'),
    });
    return 'Building added.';
  });
}

export async function setBuildingCampusAction(
  slug: string,
  mode: string,
  buildingId: string,
  campusCategory: string,
) {
  return run(slug, mode, async (ctx) => {
    await setBuildingCampusCategory(ctx, buildingId, campusCategory);
  });
}

export async function createWarehouseAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await createWarehouse(ctx, { name: text(form, 'name') });
    return 'Warehouse added.';
  });
}

export async function setWarehouseActiveAction(
  slug: string,
  mode: string,
  warehouseId: string,
  isActive: boolean,
) {
  return run(slug, mode, async (ctx) => {
    await setWarehouseActive(ctx, warehouseId, isActive === true);
  });
}

export async function createProductAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await createProduct(ctx, {
      name: text(form, 'name'),
      code: text(form, 'code'),
      kind: text(form, 'kind'),
      role: text(form, 'role'),
      price: text(form, 'price'),
      description: text(form, 'description'),
    });
    return 'Product added.';
  });
}

export async function updateProductAction(
  slug: string,
  mode: string,
  productId: string,
  _p: Form,
  form: FormData,
) {
  return run(slug, mode, async (ctx) => {
    await updateProduct(ctx, productId, {
      price: text(form, 'price'),
      isActive: ticked(form, 'isActive'),
    });
    return 'Saved.';
  });
}

export async function setStorageTermAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await setStorageTermProduct(ctx, {
      termMonths: text(form, 'termMonths'),
      isOverweight: ticked(form, 'isOverweight'),
      productId: text(form, 'productId'),
    });
    return 'Saved.';
  });
}

export async function createZipZoneAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await createZipZone(ctx, {
      zipLow: text(form, 'zipLow'),
      zipHigh: text(form, 'zipHigh'),
      zone: text(form, 'zone'),
    });
    return 'Zone range added.';
  });
}

export async function setZoneRateAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await setZoneRate(ctx, {
      zone: text(form, 'zone'),
      weightLb: text(form, 'weightLb'),
      shipHome: text(form, 'shipHome'),
      shipCornell: text(form, 'shipCornell'),
    });
    return 'Rate saved.';
  });
}

export async function removeCatalogItemAction(
  slug: string,
  mode: string,
  entityKey: string,
  id: string,
) {
  return run(slug, mode, async (ctx) => {
    await removeCatalogItem(ctx, entityKey, id);
  });
}
