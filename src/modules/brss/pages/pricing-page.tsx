/** The price list, and which storage product applies to which term. */
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatMoney } from '@/ui/format';
import { Card, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import {
  createProductAction,
  removeCatalogItemAction,
  setStorageTermAction,
  updateProductAction,
} from '../actions';
import { productEntity, storageTermEntity } from '../entities';
import { P } from '../permissions';
import { PRODUCT_KINDS, PRODUCT_ROLES, STORAGE_TERMS, labelOf } from '../rules';
import { loadSettings } from '../settings';
import { getPriceList } from '../services/catalog';
import { Check, Disclosure, Select } from './parts';

export async function PricingPage({ ctx }: PortalPageProps) {
  const [{ products, storageTerms }, settings] = await Promise.all([
    getPriceList(ctx),
    loadSettings(ctx),
  ]);
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const canWrite = can(ctx, P.catalogWrite);
  const boxProducts = products.filter((p) => p.kind === 'storage_box' && p.isActive);

  return (
    <>
      <PageHeader
        title="Pricing"
        description={`A price change applies to new charges only; charges already on an order keep their price. Tax is ${settings.taxPercent}% and extra insurance costs ${settings.insurancePercent}% of the declared value (both are in the business's Settings tab).`}
      />
      <div className="space-y-5">
        {PRODUCT_KINDS.map((kind) => {
          const rows = products.filter((p) => p.kind === kind.key);
          if (rows.length === 0) return null;
          return (
            <Card key={kind.key} title={kind.label} description={`Price is ${kind.priceUnit}.`} flush>
              <Table>
                <thead>
                  <tr>
                    <Th className="w-full">Product</Th>
                    <Th>Code</Th>
                    <Th className="text-right">Price</Th>
                    <Th>{canWrite ? 'Change' : 'State'}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((product) => (
                    <tr key={product.id} className={product.isActive ? '' : 'text-zinc-500'}>
                      <Td>
                        {product.name}
                        {product.role ? (
                          <span className="block text-xs text-zinc-500">
                            Used for: {labelOf(PRODUCT_ROLES, product.role)}
                          </span>
                        ) : null}
                        {product.description ? (
                          <span className="block text-xs text-zinc-500">{product.description}</span>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap">{product.code}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(product.unitPriceCents)}</Td>
                      <Td>
                        {canWrite ? (
                          <span className="flex items-end gap-3">
                            <ActionForm
                              action={updateProductAction.bind(null, slug, mode, product.id)}
                              submitLabel="Save"
                              className="flex items-end gap-2 space-y-0"
                              resetOnSuccess={false}
                            >
                              <label className="sr-only" htmlFor={`price-${product.id}`}>
                                Price of {product.name} in dollars
                              </label>
                              <input
                                id={`price-${product.id}`}
                                name="price"
                                inputMode="decimal"
                                defaultValue={(product.unitPriceCents / 100).toFixed(2)}
                                className={`${inputClass} w-24 text-right`}
                              />
                              <Check name="isActive" label="Active" defaultChecked={product.isActive} />
                            </ActionForm>
                            <ConfirmButton
                              action={removeCatalogItemAction.bind(null, slug, mode, productEntity.key, product.id)}
                              confirmTitle={`Remove ${product.name}?`}
                              confirmBody="It leaves the price list. Charges already made with it are kept."
                              confirmLabel="Remove"
                            >
                              Remove
                            </ConfirmButton>
                          </span>
                        ) : product.isActive ? (
                          <Badge tone="green">Active</Badge>
                        ) : (
                          <Badge>Not active</Badge>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          );
        })}

        {canWrite ? (
          <Card title="Add a product" flush>
            <Disclosure summary="New product" open={products.length === 0}>
              <ActionForm action={createProductAction.bind(null, slug, mode)} submitLabel="Add product">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Name" htmlFor="p-name">
                    <input id="p-name" name="name" required maxLength={120} className={inputClass} />
                  </Field>
                  <Field label="Code" htmlFor="p-code">
                    <input id="p-code" name="code" required maxLength={40} className={inputClass} />
                  </Field>
                  <Field label="Price (dollars)" htmlFor="p-price">
                    <input id="p-price" name="price" required inputMode="decimal" className={inputClass} />
                  </Field>
                  <Field label="Kind" htmlFor="p-kind">
                    <Select id="p-kind" name="kind">
                      {PRODUCT_KINDS.map((kind) => (
                        <option key={kind.key} value={kind.key}>
                          {kind.label} ({kind.priceUnit})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Used by a pricing rule" htmlFor="p-role" help="Most products: leave as “No”.">
                    <Select id="p-role" name="role" defaultValue="">
                      <option value="">No</option>
                      {PRODUCT_ROLES.map((role) => (
                        <option key={role.key} value={role.key}>
                          {role.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Description" htmlFor="p-description">
                    <input id="p-description" name="description" maxLength={500} className={inputClass} />
                  </Field>
                </div>
              </ActionForm>
            </Disclosure>
          </Card>
        ) : null}

        <Card
          title="Storage terms"
          description={`Which product prices a standard box for each storage term. A box is overweight from ${settings.overweightThresholdLb} lb billable weight. If a term has no row, the nearest shorter term is used; a longer one never is.`}
          flush
        >
          {storageTerms.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">No storage terms are set up, so standard boxes cannot be priced.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Term</Th>
                  <Th>Box</Th>
                  <Th className="w-full">Product</Th>
                  <Th className="text-right">Per pound</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {storageTerms.map((term) => {
                  const product = products.find((p) => p.id === term.productId);
                  return (
                    <tr key={term.id}>
                      <Td className="whitespace-nowrap">{term.termMonths} months</Td>
                      <Td className="whitespace-nowrap">{term.isOverweight ? 'Overweight' : 'Standard'}</Td>
                      <Td>
                        {product?.name ?? 'Removed product'}
                        {product && !product.isActive ? ' (not active: boxes cannot be priced)' : ''}
                      </Td>
                      <Td className="text-right tabular-nums">{product ? formatMoney(product.unitPriceCents) : '—'}</Td>
                      <Td>
                        {canWrite ? (
                          <ConfirmButton
                            action={removeCatalogItemAction.bind(null, slug, mode, storageTermEntity.key, term.id)}
                            confirmTitle="Remove this storage term?"
                            confirmBody="Boxes stored for this term will be priced with the nearest shorter term, if there is one."
                            confirmLabel="Remove"
                          >
                            Remove
                          </ConfirmButton>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {canWrite && boxProducts.length > 0 ? (
            <Disclosure summary="Set the product for a term">
              <ActionForm action={setStorageTermAction.bind(null, slug, mode)} submitLabel="Save">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Term (months)" htmlFor="st-term">
                    <input id="st-term" name="termMonths" type="number" min="1" max="99" required list="st-terms" className={inputClass} />
                    <datalist id="st-terms">
                      {STORAGE_TERMS.map((term) => (
                        <option key={term.months} value={term.months} />
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Product" htmlFor="st-product">
                    <Select id="st-product" name="productId">
                      {boxProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} · {formatMoney(product.unitPriceCents)} per lb
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex items-end pb-1.5">
                    <Check name="isOverweight" label="For overweight boxes" />
                  </div>
                </div>
              </ActionForm>
            </Disclosure>
          ) : null}
        </Card>
      </div>
    </>
  );
}
