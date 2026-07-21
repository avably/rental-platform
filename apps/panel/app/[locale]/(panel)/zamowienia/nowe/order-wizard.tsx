"use client";

import { Button, Input, Label, Textarea } from "@avably/ui";
import {
  calculateDeliveryCost,
  formatMoney,
  type CurrencyCode,
  type DeliveryMethod,
  type DeliveryPricing,
} from "@avably/core";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";

import type { FormState } from "@/lib/form-state";
import { DateRangeField } from "@/lib/orders/date-fields";
import {
  availabilityForRange,
  priceOrderItems,
  type DayAvailability,
  type ProductPricingRow,
} from "../pricing";

const initialState: FormState = {};

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* Natywny <select> zostaje natywny (formularz idzie POST-em bez JS), ale
   wygląd i stany bierze z tego samego zestawu, co Input z P2. */
const FIELD_CLASS =
  "border-input bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring disabled:cursor-not-allowed disabled:border-dashed aria-invalid:border-destructive";


export interface WizardCustomer {
  id: string;
  email: string;
  full_name: string | null;
}

export interface WizardUnit {
  unitId: string;
  unavailableFrom: string | null;
  unavailableTo: string | null;
}

export interface WizardBooked {
  unitId: string;
  startDate: string;
  endDate: string;
}

export interface WizardProduct {
  pricing: ProductPricingRow;
  name: string;
  units: WizardUnit[];
  booked: WizardBooked[];
  /** Mapa dostępności policzona SERWEROWO silnikiem (buildDayMap). */
  dayMap: DayAvailability[];
}

export interface WizardLocation {
  id: string;
  name: string;
}

/**
 * Błąd POD polem, w kolorze destructive i z rolą alertu — wzorzec sekcji 06
 * artefaktu. Pole obok dostaje `aria-invalid`, więc obrys pola (stan error
 * z P2) i komunikat mówią to samo; sam kolor nigdy nie niesie informacji.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-[13px] leading-[18px] font-medium">
      {message}
    </p>
  );
}

/**
 * Pasek dostępności produktu: renderuje WYŁĄCZNIE gotową mapę dni z silnika
 * (buildDayMap) — zero arytmetyki dat w komponencie; nawet etykiety miesięcy
 * to operacje na stringach `YYYY-MM-DD`. Bufory są tu widoczne jako zajętość,
 * bo tak liczy silnik, nie dlatego, że komponent coś dokleja.
 */
function AvailabilityStrip({
  dayMap,
  rangeStart,
  rangeEnd,
  legendLabels,
}: {
  dayMap: DayAvailability[];
  rangeStart: string;
  rangeEnd: string;
  legendLabels: { available: string; blocked: string; selected: string };
}) {
  const hasRange =
    ISO_DAY_PATTERN.test(rangeStart) && ISO_DAY_PATTERN.test(rangeEnd) && rangeEnd >= rangeStart;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-px" role="img" aria-label={`${legendLabels.available} / ${legendLabels.blocked}`}>
        {dayMap.map((entry) => {
          const inRange = hasRange && entry.day >= rangeStart && entry.day <= rangeEnd;
          const showMonthEdge = entry.day.endsWith("-01");
          return (
            <span
              key={entry.day}
              title={`${entry.day}${entry.available ? "" : ` — ${legendLabels.blocked}`}`}
              className={[
                "h-5 w-2.5",
                entry.available ? "bg-status-positive-bg" : "bg-status-problem-bg",
                inRange ? "ring-signal-strong ring-2 ring-inset" : "",
                showMonthEdge ? "ml-1.5" : "",
              ].join(" ")}
            />
          );
        })}
      </div>
      <p className="text-muted-foreground flex gap-4 text-xs">
        <span className="flex items-center gap-1">
          <span aria-hidden className="bg-status-positive-bg inline-block h-3 w-3" /> {legendLabels.available}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="bg-status-problem-bg inline-block h-3 w-3" /> {legendLabels.blocked}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="ring-signal-strong inline-block h-3 w-3 ring-2 ring-inset" /> {legendLabels.selected}
        </span>
        <span>
          {dayMap[0]?.day} — {dayMap.at(-1)?.day}
        </span>
      </p>
    </div>
  );
}

export function OrderWizard({
  action,
  customers,
  products,
  locations,
  currency,
  locale,
  deliveryPricing,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  customers: WizardCustomer[];
  products: WizardProduct[];
  locations: WizardLocation[];
  currency: CurrencyCode;
  locale: string;
  // Cennik dostaw tenanta (tenant_settings.delivery_pricing, ADR-030) do
  // PODGLĄDU na żywo. null = brak konfiguracji; autorytatywny koszt liczy i
  // tak akcja serwerowa (silnik, ten sam calculateDeliveryCost).
  deliveryPricing: DeliveryPricing | null;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("orders.form");
  const tStatus = useTranslations("orders");

  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    customers.length > 0 ? "existing" : "new",
  );
  const [itemProductIds, setItemProductIds] = useState<string[]>(
    products.length > 0 ? [products[0]!.pricing.id] : [],
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("courier");

  const productById = useMemo(
    () => new Map(products.map((product) => [product.pricing.id, product])),
    [products],
  );
  const pricingById = useMemo(
    () => new Map(products.map((product) => [product.pricing.id, product.pricing])),
    [products],
  );

  const hasValidRange =
    ISO_DAY_PATTERN.test(startDate) && ISO_DAY_PATTERN.test(endDate) && endDate >= startDate;

  /**
   * Podgląd wyceny i dostępności NA ŻYWO — te same czyste funkcje silnika,
   * które policzą zamówienie po stronie serwera (pricing.ts). Wynik podglądu
   * jest informacyjny; autorytatywna wycena i przypisanie egzemplarzy dzieją
   * się w akcji serwerowej na świeżo odczytanym cenniku.
   */
  const preview = useMemo(() => {
    if (!hasValidRange || itemProductIds.length === 0) return null;
    try {
      const pricing = priceOrderItems(itemProductIds, pricingById, startDate, endDate);

      const neededByProduct = new Map<string, number>();
      for (const productId of itemProductIds) {
        neededByProduct.set(productId, (neededByProduct.get(productId) ?? 0) + 1);
      }
      const shortages: { productId: string; needed: number; free: number }[] = [];
      for (const [productId, needed] of neededByProduct) {
        const product = productById.get(productId);
        if (!product) continue;
        const result = availabilityForRange(product.units, product.booked, startDate, endDate, {
          bufferBeforeDays: product.pricing.buffer_before_days,
          bufferAfterDays: product.pricing.buffer_after_days,
        });
        if (result.availableUnitIds.length < needed) {
          shortages.push({ productId, needed, free: result.availableUnitIds.length });
        }
      }
      return { pricing, shortages };
    } catch {
      return null;
    }
  }, [hasValidRange, itemProductIds, pricingById, productById, startDate, endDate]);

  /**
   * Koszt dostawy NA ŻYWO — ta sama czysta funkcja silnika (calculateDeliveryCost),
   * która policzy autorytatywny koszt po stronie serwera. Metoda płatna bez
   * cennika rzuca (ADR-030: zero cichych zer) — łapiemy to jako `configMissing`
   * i pokazujemy podpowiedź zamiast wywracać podgląd. Sam koszt jest
   * informacyjny; do zamówienia trafia wartość policzona w akcji.
   */
  const deliveryPreview = useMemo(() => {
    if (!preview) return null;
    try {
      const grosze = calculateDeliveryCost({
        method: deliveryMethod as DeliveryMethod,
        pricing: deliveryPricing,
        rentalTotalGrosze: preview.pricing.totalRentalGrosze,
      });
      return { grosze, configMissing: false as const };
    } catch {
      return { grosze: null, configMissing: true as const };
    }
  }, [preview, deliveryMethod, deliveryPricing]);

  const errorId = (field: string) => (state.fieldErrors?.[field] ? `order-${field}-error` : undefined);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-6">
      {/* --- Klient --- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("customerSection")}</legend>
        <div className="flex gap-4" role="radiogroup" aria-label={t("customerSection")}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="customerMode"
              value="existing"
              checked={customerMode === "existing"}
              onChange={() => setCustomerMode("existing")}
              disabled={customers.length === 0}
            />
            {t("existingCustomer")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="customerMode"
              value="new"
              checked={customerMode === "new"}
              onChange={() => setCustomerMode("new")}
            />
            {t("newCustomer")}
          </label>
        </div>

        {customerMode === "existing" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-customer">{t("customer")}</Label>
            <select
              id="order-customer"
              name="customerId"
              defaultValue={customers[0]?.id ?? ""}
              className={FIELD_CLASS}
              aria-invalid={state.fieldErrors?.customerId ? true : undefined}
              aria-describedby={errorId("customerId")}
            >
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.full_name ? `${customer.full_name} (${customer.email})` : customer.email}
                </option>
              ))}
            </select>
            <FieldError id="order-customerId-error" message={state.fieldErrors?.customerId} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order-new-email">{t("newCustomerEmail")}</Label>
              <Input
                id="order-new-email"
                name="newCustomerEmail"
                type="email"
                required
                aria-invalid={state.fieldErrors?.newCustomerEmail ? true : undefined}
                aria-describedby={errorId("newCustomerEmail")}
              />
              <FieldError id="order-newCustomerEmail-error" message={state.fieldErrors?.newCustomerEmail} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order-new-name">{t("newCustomerName")}</Label>
              <Input id="order-new-name" name="newCustomerName" maxLength={200} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order-new-phone">{t("newCustomerPhone")}</Label>
              <Input id="order-new-phone" name="newCustomerPhone" maxLength={32} />
            </div>
          </div>
        )}
        {/* Pole customerId wysyłamy TYLKO w trybie „istniejący" — pusty string
            w trybie „nowy" załatwia hidden input. */}
        {customerMode === "new" ? <input type="hidden" name="customerId" value="" /> : null}
      </fieldset>

      {/* --- Pozycje --- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("itemsSection")}</legend>
        {itemProductIds.map((productId, index) => (
          // Indeks jako klucz jest tu poprawny: wiersze są reordering-free
          // (dodawanie na koniec, usuwanie po indeksie), a wartość żyje w stanie.
          <div key={`${index}-${productId}`} className="flex items-end gap-3">
            <div className="flex grow flex-col gap-1.5">
              <Label htmlFor={`order-item-${index}`}>{t("itemProduct", { index: index + 1 })}</Label>
              <select
                id={`order-item-${index}`}
                value={productId}
                onChange={(event) => {
                  const next = [...itemProductIds];
                  next[index] = event.target.value;
                  setItemProductIds(next);
                }}
                className={FIELD_CLASS}
              >
                {products.map((product) => (
                  <option key={product.pricing.id} value={product.pricing.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setItemProductIds(itemProductIds.filter((_, i) => i !== index))}
              disabled={itemProductIds.length === 1}
            >
              {t("removeItem")}
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              products.length > 0 && setItemProductIds([...itemProductIds, products[0]!.pricing.id])
            }
          >
            {t("addItem")}
          </Button>
        </div>
        <input
          type="hidden"
          name="items"
          value={JSON.stringify(itemProductIds.map((id) => ({ productId: id })))}
        />
        <FieldError id="order-items-error" message={state.fieldErrors?.items} />
      </fieldset>

      {/* --- Termin --- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("termSection")}</legend>
        {/* Termin to JEDEN zakres, ale do akcji jadą dwa pola o niezmienionych
            nazwach (`startDate`, `endDate`) i w niezmienionym formacie ISO —
            walidacja i wycena nie widzą różnicy. Sam początek bez końca jest
            dopuszczalny w trakcie wyboru; brak końca zatrzyma schemat akcji
            tak samo jak puste pole wcześniej. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="order-term">{t("termLabel")}</Label>
          <DateRangeField
            id="order-term"
            fromName="startDate"
            toName="endDate"
            from={startDate}
            to={endDate}
            onChange={(range) => {
              setStartDate(range.from);
              setEndDate(range.to);
            }}
            invalid={Boolean(state.fieldErrors?.startDate || state.fieldErrors?.endDate)}
            describedBy={errorId("startDate") ?? errorId("endDate")}
            className="sm:w-[320px]"
          />
          <FieldError id="order-startDate-error" message={state.fieldErrors?.startDate} />
          <FieldError id="order-endDate-error" message={state.fieldErrors?.endDate} />
        </div>

        {/* Kalendarz dostępności każdego produktu z pozycji. */}
        {[...new Set(itemProductIds)].map((productId) => {
          const product = productById.get(productId);
          if (!product) return null;
          return (
            <div key={productId} className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">{product.name}</p>
              <AvailabilityStrip
                dayMap={product.dayMap}
                rangeStart={startDate}
                rangeEnd={endDate}
                legendLabels={{
                  available: t("legendAvailable"),
                  blocked: t("legendBlocked"),
                  selected: t("legendSelected"),
                }}
              />
            </div>
          );
        })}
      </fieldset>

      {/* --- Dostawa --- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("deliverySection")}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-delivery">{t("deliveryMethod")}</Label>
            <select
              id="order-delivery"
              name="deliveryMethod"
              value={deliveryMethod}
              onChange={(event) => setDeliveryMethod(event.target.value)}
              className={FIELD_CLASS}
            >
              <option value="pickup">{tStatus("delivery.pickup")}</option>
              <option value="courier">{tStatus("delivery.courier")}</option>
              <option value="parcel_locker">{tStatus("delivery.parcel_locker")}</option>
              <option value="own_delivery">{tStatus("delivery.own_delivery")}</option>
            </select>
          </div>
          {deliveryMethod === "pickup" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order-location">{t("pickupLocation")}</Label>
              <select
                id="order-location"
                name="pickupLocationId"
                defaultValue={locations[0]?.id ?? ""}
                className={FIELD_CLASS}
                aria-invalid={state.fieldErrors?.pickupLocationId ? true : undefined}
                aria-describedby={errorId("pickupLocationId")}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <FieldError id="order-pickupLocationId-error" message={state.fieldErrors?.pickupLocationId} />
            </div>
          ) : (
            <input type="hidden" name="pickupLocationId" value="" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="order-notes">{t("notes")}</Label>
          <Textarea id="order-notes" name="notes" rows={3} maxLength={2000} />
        </div>
      </fieldset>

      {/* --- Podgląd wyceny (silnik, na żywo) --- */}
      {preview ? (
        <div className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4" role="status">
          <p className="text-sm font-semibold">
            {t("previewTitle", { days: preview.pricing.days })}
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {preview.pricing.items.map((item, index) => (
              <li key={index} className="flex justify-between gap-4">
                <span>{productById.get(item.productId)?.name ?? item.productId}</span>
                <span>
                  {formatMoney(item.rentalGrosze, currency, locale)}
                  {item.depositGrosze > 0
                    ? ` (+ ${t("deposit")}: ${formatMoney(item.depositGrosze, currency, locale)})`
                    : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-border flex justify-between gap-4 border-t pt-2 text-sm font-semibold">
            <span>{t("totalRental")}</span>
            <span>{formatMoney(preview.pricing.totalRentalGrosze, currency, locale)}</span>
          </p>
          {preview.pricing.totalDepositGrosze > 0 ? (
            <p className="flex justify-between gap-4 text-sm">
              <span>{t("totalDeposit")}</span>
              <span>{formatMoney(preview.pricing.totalDepositGrosze, currency, locale)}</span>
            </p>
          ) : null}
          {deliveryPreview?.configMissing ? (
            <p role="alert" className="text-destructive text-sm">
              {t("deliveryPricingMissing")}
            </p>
          ) : deliveryPreview && deliveryPreview.grosze !== null ? (
            <>
              <p className="flex justify-between gap-4 text-sm">
                <span>{t("deliveryCost")}</span>
                <span>{formatMoney(deliveryPreview.grosze, currency, locale)}</span>
              </p>
              <p className="border-border flex justify-between gap-4 border-t pt-2 text-sm font-semibold">
                <span>{t("totalWithDelivery")}</span>
                <span>
                  {formatMoney(
                    preview.pricing.totalRentalGrosze + deliveryPreview.grosze,
                    currency,
                    locale,
                  )}
                </span>
              </p>
            </>
          ) : null}
          {preview.shortages.map((shortage) => (
            <p key={shortage.productId} role="alert" className="text-destructive text-sm">
              {t("shortage", {
                product: productById.get(shortage.productId)?.name ?? shortage.productId,
                needed: shortage.needed,
                free: shortage.free,
              })}
            </p>
          ))}
        </div>
      ) : null}

      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}

      <div>
        <Button
          type="submit"
          loading={pending}
          disabled={pending || (preview !== null && preview.shortages.length > 0)}
        >
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
