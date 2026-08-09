"use client";

/**
 * Kreator nowego zamówienia — orkiestracja formularza po przebudowie R3.
 *
 * UKŁAD (pinezka 00aa35ca „termin pod klientem albo po prawej"): dwie kolumny.
 * Po LEWEJ decyzje o treści zamówienia — klient, pozycje, dostawa, notatka.
 * Po PRAWEJ, przyklejony przy przewijaniu, TERMIN jako kalendarz i wycena.
 * Termin i wycena zmieniają się przy każdym ruchu w lewej kolumnie, więc mają
 * być widoczne cały czas, a nie po doscrollowaniu.
 *
 * ============ MIARA OBEJMUJE KOLUMNĘ PÓL, NIE CAŁY EKRAN (R3-1c, uwaga 1) ============
 *
 * Do R3-1c `data-form-line-measure` siedziało na `<form>`, czyli na RAMIE OBU
 * KOLUMN. Skutek dało się zmierzyć: przy 1280 px i rozwiniętym menu kontener
 * treści panelu ma 1044 px, a formularz stał w 672 px — kolumna pól zjeżdżała
 * do 296 px, kalendarz obok miał 352 px (czyli WIĘCEJ niż wszystkie pola
 * razem), a 372 px kontenera zostawało puste. Stąd „nie trzyma się
 * w kontencie": ekran nie był za szeroki, tylko przycięty w połowie.
 *
 * Miara jest regułą DŁUGOŚCI WIERSZA formularza (42 rem, artefakt Fazy 2),
 * a nie szerokością ekranu — więc obejmuje kolumnę, w której stoją pola.
 * Rama dwukolumnowa rozpina się na kontener panelu, dokładnie tak jak na
 * szczególe zamówienia (`[id]/page.tsx`, ta sama siatka `1fr` + stała
 * kolumna boczna). Liczby po zmianie sprawdzone w przeglądarce na 1280
 * i 1440 px, przy menu zwiniętym i rozwiniętym.
 *
 * Ten plik trzyma STAN i SKŁADA sekcje; same sekcje mieszkają osobno
 * (`customer-picker`, `item-picker`, `term-calendar`, `delivery-fields`).
 * Podział jest funkcjonalny, nie kosmetyczny: każda sekcja odpowiada jednej
 * pinezce przeglądu i daje się czytać oraz testować w oderwaniu od reszty.
 *
 * Podgląd wyceny, dostępności i kosztu dostawy liczą TE SAME czyste funkcje
 * silnika, które policzą zamówienie po stronie serwera. Wynik podglądu jest
 * informacyjny — autorytatywna wycena, przypisanie egzemplarzy i koszt
 * dostawy dzieją się w akcji serwerowej na świeżo odczytanym cenniku.
 */
import {
  formatMoney,
  resolveDeliveryCost,
  type CurrencyCode,
  type CustomFieldDefinition,
  type DeliveryMethod,
  type DeliveryPricing,
} from "@avably/core";
import { Button, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";

import { CustomFieldsFieldset } from "@/components/fields/custom-fields-fieldset";
import type { FormState } from "@/lib/form-state";
import { parseMajorToGrosze } from "@/lib/money-input";

import {
  availabilityForRange,
  priceOrderItems,
  type ProductPricingRow,
} from "../pricing";
import { blockedDays, mergeDayMaps } from "./basket-availability";
import { sumLineAmounts } from "./basket-lines";
import { CustomerPicker, type CustomerPickerState } from "./customer-picker";
import { DeliveryFields, EMPTY_DELIVERY_STATE, type DeliveryState } from "./delivery-fields";
import { FIELD_CLASS } from "./field-class";
import { ItemPicker } from "./item-picker";
import { TermCalendar } from "./term-calendar";
import type { WizardCustomer, WizardLocation, WizardProduct } from "./wizard-data";

const initialState: FormState = {};

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type {
  WizardBooked,
  WizardCustomer,
  WizardLocation,
  WizardProduct,
  WizardUnit,
} from "./wizard-data";

export { FIELD_CLASS };

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

export function OrderWizard({
  action,
  customers,
  customersTruncated,
  products,
  locations,
  currency,
  locale,
  deliveryPricing,
  paymentAccountConnected,
  customFields = [],
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  customers: WizardCustomer[];
  customersTruncated: boolean;
  products: WizardProduct[];
  locations: WizardLocation[];
  currency: CurrencyCode;
  locale: string;
  // Cennik dostaw tenanta (tenant_settings.delivery_pricing, ADR-030) do
  // PODGLĄDU na żywo. null = brak konfiguracji; autorytatywny koszt liczy i
  // tak akcja serwerowa (silnik, ten sam resolveDeliveryCost).
  deliveryPricing: DeliveryPricing | null;
  /** Czy tenant ma konto rozliczeniowe — bramka wyboru płatności online. */
  paymentAccountConnected: boolean;
  /** Pola własne zamówienia z flagą „panel", w kolejności z definicji (serwer). */
  customFields?: readonly CustomFieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("orders.form");

  const [customer, setCustomer] = useState<CustomerPickerState>({ selected: null, creating: false });
  const [itemProductIds, setItemProductIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [delivery, setDelivery] = useState<DeliveryState>({
    ...EMPTY_DELIVERY_STATE,
    pickupLocationId: locations[0]?.id ?? "",
  });

  const productById = useMemo(
    () => new Map(products.map((product) => [product.pricing.id, product])),
    [products],
  );
  const pricingById = useMemo(
    () => new Map<string, ProductPricingRow>(products.map((product) => [product.pricing.id, product.pricing])),
    [products],
  );

  const hasValidRange =
    ISO_DAY_PATTERN.test(startDate) && ISO_DAY_PATTERN.test(endDate) && endDate >= startDate;

  /**
   * Mapa dostępności KOSZYKA — koniunkcja map produktów (patrz
   * `basket-availability.ts`). Pusty koszyk daje pustą mapę, więc kalendarz
   * nie maluje wtedy zajętości, której nikt nie policzył.
   */
  const basketDayMap = useMemo(() => {
    const unique = [...new Set(itemProductIds)];
    const maps = unique
      .map((productId) => productById.get(productId)?.dayMap)
      .filter((dayMap): dayMap is NonNullable<typeof dayMap> => dayMap !== undefined);
    return mergeDayMaps(maps);
  }, [itemProductIds, productById]);

  const occupiedDays = useMemo(() => blockedDays(basketDayMap), [basketDayMap]);

  /** Wolne egzemplarze per produkt w WYBRANYM terminie (do wierszy pozycji). */
  const freeUnitsByProduct = useMemo(() => {
    if (!hasValidRange) return null;
    const free = new Map<string, number>();
    for (const productId of new Set(itemProductIds)) {
      const product = productById.get(productId);
      if (!product) continue;
      const result = availabilityForRange(product.units, product.booked, startDate, endDate, {
        bufferBeforeDays: product.pricing.buffer_before_days,
        bufferAfterDays: product.pricing.buffer_after_days,
      });
      free.set(productId, result.availableUnitIds.length);
    }
    return free;
  }, [hasValidRange, itemProductIds, productById, startDate, endDate]);

  /**
   * Podgląd wyceny i braków NA ŻYWO — te same czyste funkcje silnika, które
   * policzą zamówienie po stronie serwera (pricing.ts).
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
        const free = freeUnitsByProduct?.get(productId) ?? 0;
        if (free < needed) shortages.push({ productId, needed, free });
      }
      return { pricing, shortages };
    } catch {
      return null;
    }
  }, [hasValidRange, itemProductIds, pricingById, startDate, endDate, freeUnitsByProduct]);

  /**
   * Kwoty WIERSZY koszyka (uwaga 3) — wyłącznie przegrupowanie wyniku silnika
   * po produkcie. Zero drugiej ścieżki liczenia: gdyby koszyk mnożył cenę
   * dobową przez liczbę dni, pokazałby inną kwotę niż wycena obok i inną niż
   * zamówienie, które za chwilę policzy serwer (progi cenowe, mnożnik).
   * `null` bez terminu — nie ma czego liczyć, więc wiersz mówi to wprost.
   */
  const lineAmounts = useMemo(
    () => (preview ? sumLineAmounts(preview.pricing.items) : null),
    [preview],
  );

  /**
   * Koszt dostawy NA ŻYWO — ta sama funkcja silnika (`resolveDeliveryCost`),
   * która policzy autorytatywny koszt po stronie serwera: cennik albo cena
   * ustalona ręcznie. Metoda płatna bez cennika i bez ceny własnej rzuca
   * (ADR-030: zero cichych zer) — łapiemy to jako `problem` i pokazujemy
   * podpowiedź zamiast wywracać podgląd.
   */
  const deliveryPreview = useMemo(() => {
    if (!preview) return null;
    // Niedokończona kwota („19,") daje `null` — dla PODGLĄDU znaczy to
    // „jeszcze nie ma czego pokazać", nie błąd. Regułę parsowania niesie ta
    // sama funkcja co schemat, żeby podgląd i walidacja nie rozjechały się.
    const overrideGrosze =
      delivery.priceSource === "manual" ? parseMajorToGrosze(delivery.price) : null;
    // Deklaracja ceny własnej bez wpisanej kwoty to jeszcze nie błąd —
    // operator jest w trakcie wpisywania. Podgląd milczy, a odmowę (jeśli
    // trzeba) wystawi schemat przy wysyłce.
    if (delivery.priceSource === "manual" && overrideGrosze === null) return null;
    try {
      const resolved = resolveDeliveryCost({
        method: delivery.method as DeliveryMethod,
        pricing: deliveryPricing,
        rentalTotalGrosze: preview.pricing.totalRentalGrosze,
        overrideGrosze,
      });
      return { ...resolved, problem: false as const };
    } catch {
      return { grosze: null, source: null, problem: true as const };
    }
  }, [preview, delivery.method, delivery.priceSource, delivery.price, deliveryPricing]);

  const errorSlot = (field: string) => (
    <FieldError id={`order-${field}-error`} message={state.fieldErrors?.[field]} />
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ================= KOLUMNA LEWA — treść zamówienia ================= */}
        <div data-form-line-measure className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-xl leading-[26px] font-semibold tracking-[-0.01em]">
              {t("customerSection")}
            </legend>
            <CustomerPicker
              customers={customers}
              truncated={customersTruncated}
              state={customer}
              onChange={setCustomer}
              fieldErrors={state.fieldErrors}
              errorSlot={errorSlot}
            />
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-xl leading-[26px] font-semibold tracking-[-0.01em]">
              {t("itemsSection")}
            </legend>
            <ItemPicker
              products={products}
              itemProductIds={itemProductIds}
              onChange={setItemProductIds}
              freeUnitsByProduct={freeUnitsByProduct}
              amountsByProduct={lineAmounts}
              currency={currency}
              locale={locale}
              errorSlot={errorSlot}
            />
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-xl leading-[26px] font-semibold tracking-[-0.01em]">
              {t("deliverySection")}
            </legend>
            <DeliveryFields
              state={delivery}
              onChange={(patch) => setDelivery((current) => ({ ...current, ...patch }))}
              locations={locations}
              pricing={deliveryPricing}
              rentalTotalGrosze={preview?.pricing.totalRentalGrosze ?? 0}
              currency={currency}
              locale={locale}
              customer={customer.selected}
              paymentAccountConnected={paymentAccountConnected}
              errorSlot={errorSlot}
              fieldErrors={state.fieldErrors}
            />
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-notes">{t("notes")}</Label>
            <Textarea id="order-notes" name="notes" rows={3} maxLength={2000} />
          </div>

          <CustomFieldsFieldset
            fields={customFields}
            values={{}}
            errors={state.fieldErrors}
            idPrefix="order-cf"
          />
        </div>

        {/* ================= KOLUMNA PRAWA — termin i wycena ================= */}
        <aside className="flex flex-col gap-6 lg:sticky lg:top-6">
          <section className="border-border flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-base font-semibold">{t("termSection")}</h2>
            <TermCalendar
              from={startDate}
              to={endDate}
              onChange={(range) => {
                setStartDate(range.from);
                setEndDate(range.to);
              }}
              occupiedDays={occupiedDays}
              hasBasket={itemProductIds.length > 0}
              invalid={Boolean(state.fieldErrors?.startDate || state.fieldErrors?.endDate)}
              errorSlot={errorSlot}
            />
          </section>

          {preview ? (
            <section
              className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4"
              role="status"
              data-order-preview
            >
              <p className="text-sm font-semibold">{t("previewTitle", { days: preview.pricing.days })}</p>
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
              {deliveryPreview?.problem ? (
                <p role="alert" className="text-destructive text-sm">
                  {t("deliveryPricingMissing")}
                </p>
              ) : deliveryPreview && deliveryPreview.grosze !== null ? (
                <>
                  <p className="flex justify-between gap-4 text-sm">
                    <span>
                      {t("deliveryCost")}
                      {deliveryPreview.source === "manual" ? ` · ${t("deliveryPriceManualTag")}` : null}
                    </span>
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
            </section>
          ) : null}
        </aside>
      </div>

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
