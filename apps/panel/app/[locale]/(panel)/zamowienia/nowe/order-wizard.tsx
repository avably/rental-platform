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
 *
 * ============ CO DOKŁADA U7 (audyt 2.6) ============
 *
 * 1. PODSUMOWANIE STOI ZAWSZE (`order-summary.tsx`). Do U7 karta wyceny
 *    pojawiała się dopiero z kompletem „pozycje + termin"; wcześniej prawa
 *    kolumna milczała, więc ekran nie odróżniał „jeszcze nie policzyliśmy" od
 *    „ten ekran kwot nie pokazuje".
 * 2. KROKI SĄ PONUMEROWANE w układzie (1. Klient → 2. Pozycje → 3. Dostawa),
 *    a nie wyprowadzane z rozproszonych podpowiedzi. Kalendarz i kwota stoją
 *    w przyklejonej kolumnie obok jako PANEL, do którego wraca się w każdym
 *    kroku — numeru nie dostają świadomie: operator przy telefonie zmienia
 *    termin w dowolnej chwili, a numer sugerowałby moment.
 * 3. ZAPIS JEST WYGASZONY, GDY BRAKUJE DANYCH — z listą braków WIDOCZNĄ
 *    ZANIM operator kliknie (`readiness.ts`, wzorzec ekranu płatności:
 *    kontrolka nieczynna zawsze mówi, dlaczego).
 */
import {
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
import {
  CustomerPicker,
  EMPTY_CUSTOMER_STATE,
  type CustomerPickerState,
} from "./customer-picker";
import { DeliveryFields, EMPTY_DELIVERY_STATE, type DeliveryState } from "./delivery-fields";
import { FIELD_CLASS } from "./field-class";
import { ItemPicker } from "./item-picker";
import { OrderSummary, READINESS_LIST_ID } from "./order-summary";
import { hasValidTerm, orderBlockers } from "./readiness";
import { TermCalendar } from "./term-calendar";
import type { WizardCustomer, WizardLocation, WizardProduct } from "./wizard-data";

const initialState: FormState = {};

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

  const [customer, setCustomer] = useState<CustomerPickerState>(EMPTY_CUSTOMER_STATE);
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

  // Ta sama reguła terminu, którą stosuje schemat akcji serwerowej —
  // `readiness.ts` woła `assertIsoDate` silnika, więc podgląd i lista braków
  // nie mogą różnić się zdaniem o tym, czy termin jest już wybrany.
  const hasValidRange = hasValidTerm(startDate, endDate);

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
   * powód zamiast wywracać podgląd.
   *
   * OD U7 liczy się TAKŻE BEZ WYCENY NAJMU (przed pozycjami i terminem), bo
   * tak samo liczą się ceny na kartach metod — dopiero wtedy „kurier bez
   * cennika" jest widoczny w chwili wyboru metody, a nie po skompletowaniu
   * całego zamówienia. Suma najmu wchodzi wyłącznie do progu darmowej dostawy,
   * więc przed wyceną jest zerem: próg jeszcze nie jest osiągnięty i karta
   * pokazuje pełną cenę — dokładnie to, co zobaczy klient w tym stanie.
   */
  const deliveryPreview = useMemo(() => {
    // Niedokończona kwota („19,") daje `null` — dla PODGLĄDU znaczy to
    // „jeszcze nie ma czego pokazać", nie błąd. Regułę parsowania niesie ta
    // sama funkcja co schemat, żeby podgląd i walidacja nie rozjechały się.
    const overrideGrosze =
      delivery.priceSource === "manual" ? parseMajorToGrosze(delivery.price) : null;
    // Deklaracja ceny własnej bez wpisanej kwoty to jeszcze nie błąd —
    // operator jest w trakcie wpisywania. Podgląd milczy, a powód („podaj
    // kwotę dostawy") niesie lista braków.
    if (delivery.priceSource === "manual" && overrideGrosze === null) return null;
    try {
      const resolved = resolveDeliveryCost({
        method: delivery.method as DeliveryMethod,
        pricing: deliveryPricing,
        rentalTotalGrosze: preview?.pricing.totalRentalGrosze ?? 0,
        overrideGrosze,
      });
      return { ...resolved, problem: false as const };
    } catch {
      return { grosze: null, source: null, problem: true as const };
    }
  }, [preview, delivery.method, delivery.priceSource, delivery.price, deliveryPricing]);

  /**
   * CZEGO JESZCZE BRAKUJE — jedna lista, z której korzysta i podsumowanie,
   * i przycisk zapisu. Reguły siedzą w `readiness.ts` i są przypięte testem
   * do `orderFormSchema`, więc wygaszony przycisk zawsze znaczy „schemat i tak
   * by odmówił", a czynny — „schemat przyjmie".
   */
  const blockers = useMemo(
    () =>
      orderBlockers({
        hasCustomer: customer.selected !== null || customer.newEmail.trim() !== "",
        itemCount: itemProductIds.length,
        startDate,
        endDate,
        method: delivery.method,
        pickupLocationId: delivery.pickupLocationId,
        pointCode: delivery.pointCode,
        addressSource: delivery.addressSource,
        addressStreet: delivery.addressStreet,
        addressZip: delivery.addressZip,
        addressCity: delivery.addressCity,
        priceSource: delivery.priceSource,
        price: delivery.price,
        deliveryPricingProblem: deliveryPreview?.problem ?? false,
        shortageCount: preview?.shortages.length ?? 0,
      }),
    [customer, itemProductIds.length, startDate, endDate, delivery, deliveryPreview, preview],
  );

  const errorSlot = (field: string) => (
    <FieldError id={`order-${field}-error`} message={state.fieldErrors?.[field]} />
  );

  /** Nagłówek kroku: numer stoi w TREŚCI, więc czyta go też czytnik ekranu. */
  const stepTitle = (step: number, title: string) => t("stepTitle", { step, title });

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ================= KOLUMNA LEWA — treść zamówienia ================= */}
        <div data-form-line-measure className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-3">
            <legend
              className="mb-3 text-xl leading-[26px] font-semibold tracking-[-0.01em]"
              data-step="1"
            >
              {stepTitle(1, t("customerSection"))}
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
            <legend
              className="mb-3 text-xl leading-[26px] font-semibold tracking-[-0.01em]"
              data-step="2"
            >
              {stepTitle(2, t("itemsSection"))}
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
            <legend
              className="mb-3 text-xl leading-[26px] font-semibold tracking-[-0.01em]"
              data-step="3"
            >
              {stepTitle(3, t("deliverySection"))}
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

          {/* NOTATKA JEST WEWNĘTRZNA — i to jest sprawdzone w kodzie, nie
              założone (U7, audyt 2.6 §5). Treść z tego pola jedzie jako
              `p_notes` do `app.create_order`, a ta od migracji 0041 zakłada
              WPIS W `order_notes` — listę czytaną wyłącznie przez szczegół
              zamówienia w panelu. Szablony e-maili (`packages/emails`) i umowa
              PDF (`packages/pdf`) nie mają do notatek ani jednego odwołania,
              więc zdanie „klient tego nie zobaczy" jest prawdą o systemie,
              a nie obietnicą. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-notes">{t("notes")}</Label>
            <Textarea
              id="order-notes"
              name="notes"
              rows={3}
              maxLength={2000}
              aria-describedby="order-notes-hint"
            />
            <p id="order-notes-hint" className="text-muted-foreground text-xs" data-notes-hint>
              {t("notesHint")}
            </p>
          </div>

          {/* Rodzeństwem są fieldsety „Klient", „Pozycje" i „Termin
              i dostawa" z dużymi nagłówkami — pola własne są czwartą taką
              grupą, więc biorą tę samą konwencję (nie kapitaliki karty). */}
          <CustomFieldsFieldset
            fields={customFields}
            values={{}}
            errors={state.fieldErrors}
            idPrefix="order-cf"
            legendVariant="section"
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

          <OrderSummary
            pricing={preview?.pricing ?? null}
            delivery={deliveryPreview}
            blockers={blockers}
            shortages={preview?.shortages ?? []}
            productName={(productId) => productById.get(productId)?.name ?? productId}
            currency={currency}
            locale={locale}
          />
        </aside>
      </div>

      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}

      {/* Przycisk wygaszony ZAWSZE mówi, dlaczego — wzorzec ekranu płatności
          (`ustawienia-platnosci/payments-panel.tsx`). Powód wskazuje listę
          braków w podsumowaniu (`aria-describedby`), a zdanie obok kieruje do
          niej wzrok: przycisk nieczynny bez wyjaśnienia jest gorszy niż
          czynny, bo operator nie wie, co ma zrobić. */}
      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          loading={pending}
          disabled={pending || blockers.length > 0}
          aria-describedby={blockers.length > 0 ? READINESS_LIST_ID : undefined}
        >
          {t("save")}
        </Button>
        {blockers.length > 0 ? (
          <p role="status" className="text-status-attention-fg text-sm" data-save-blocked>
            {t("saveBlocked")}
          </p>
        ) : null}
      </div>
    </form>
  );
}
