"use client";

/**
 * Dostawa i płatność nowego zamówienia — cztery pinezki R3 w jednej sekcji,
 * bo wszystkie odpowiadają na to samo pytanie: CO i DOKĄD jedzie oraz ile za
 * to płaci klient.
 *
 *   • 3c944a2d — metoda wybierana KARTAMI, każda z ceną WPROST Z CENNIKA
 *     tenanta, plus jawne pole ceny własnej;
 *   • ff2dfefc — numer punktu przy dostawie do paczkomatu, jako struktura
 *     (dostawca + kod + adres opisowy), nie luźny string;
 *   • e2aef3f6 — adres dostarczenia przy kurierze i dostawie własnej:
 *     z kartoteki klienta albo jednorazowy inny;
 *   • 82a0c41a — forma płatności klienta.
 *
 * DLACZEGO ADRES ROZWIJA SIĘ W MIEJSCU, A NIE W MODALU. Pinezka zostawiła to
 * pytanie otwarte („pewnie najlepiej na modalu, dowiedz się uxowo jak").
 * Modal jest właściwy, gdy adres się WYBIERA z listy albo gdy formularz
 * adresu jest osobnym zadaniem. Tutaj alternatywa jest jedna, pól cztery,
 * a decyzja („czy to ten sam adres co w kartotece?") czyta się wyłącznie
 * w kontekście reszty zamówienia — modal ten kontekst zasłania, dokłada dwa
 * kliknięcia i rodzi pytanie, co znaczy „Anuluj" w oknie nad niezapisanym
 * formularzem. Rozwinięcie w miejscu pokazuje adres tam, gdzie jest o nim
 * mowa, i jedzie tym samym FormData co reszta pól.
 *
 * Ceny są tu WYŁĄCZNIE PODGLĄDEM — autorytatywną kwotę liczy akcja serwerowa
 * tą samą funkcją silnika (`resolveDeliveryCost`) na cenniku odczytanym na
 * świeżo. Podgląd ma pomóc wybrać, nie ustalić.
 */
import {
  DELIVERY_PRICE_OVERRIDE_MAX_GROSZE,
  ORDER_PAYMENT_METHODS,
  calculateDeliveryCost,
  formatMoney,
  methodUsesDeliveryAddress,
  methodUsesDeliveryPoint,
  type CurrencyCode,
  type DeliveryMethod,
  type DeliveryPricing,
} from "@avably/core";
import { Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";

import { PanelSelect } from "@/components/fields/panel-select";

import { customerAddressLine } from "./customer-picker";
import { FIELD_CLASS } from "./field-class";
import type { WizardCustomer, WizardLocation } from "./wizard-data";

export const DELIVERY_METHOD_ORDER = [
  "pickup",
  "courier",
  "parcel_locker",
  "own_delivery",
] as const satisfies readonly DeliveryMethod[];

/** Dostawca punktu odbioru — dziś jeden, więc pole jest ukryte i stałe. */
const DEFAULT_POINT_PROVIDER = "inpost";

export interface DeliveryState {
  method: DeliveryMethod;
  pickupLocationId: string;
  priceSource: "pricing" | "manual";
  price: string;
  pointCode: string;
  pointAddress: string;
  addressSource: "" | "customer" | "custom";
  addressName: string;
  addressStreet: string;
  addressZip: string;
  addressCity: string;
  addressPhone: string;
  paymentMethod: "" | "cod" | "transfer" | "online";
}

export const EMPTY_DELIVERY_STATE: DeliveryState = {
  method: "courier",
  pickupLocationId: "",
  priceSource: "pricing",
  price: "",
  pointCode: "",
  pointAddress: "",
  addressSource: "customer",
  addressName: "",
  addressStreet: "",
  addressZip: "",
  addressCity: "",
  addressPhone: "",
  paymentMethod: "",
};

/**
 * Cena metody do PODGLĄDU na karcie. Metoda bez cennika nie dostaje zera —
 * dostaje `null`, a karta mówi „brak cennika". Ciche zero rozdawałoby dostawę
 * za darmo dokładnie tym najemcom, którzy nie skończyli konfiguracji (ADR-030).
 */
function previewPrice(
  method: DeliveryMethod,
  pricing: DeliveryPricing | null,
  rentalTotalGrosze: number,
): number | null {
  try {
    return calculateDeliveryCost({ method, pricing, rentalTotalGrosze });
  } catch {
    return null;
  }
}

export function DeliveryFields({
  state,
  onChange,
  locations,
  pricing,
  rentalTotalGrosze,
  currency,
  locale,
  customer,
  paymentAccountConnected,
  errorSlot,
  fieldErrors,
}: {
  state: DeliveryState;
  onChange: (patch: Partial<DeliveryState>) => void;
  locations: WizardLocation[];
  pricing: DeliveryPricing | null;
  /** Suma najmu z podglądu — próg darmowej dostawy liczy się od niej. */
  rentalTotalGrosze: number;
  currency: CurrencyCode;
  locale: string;
  /** Wybrany klient — źródło adresu przy wariancie „z danych klienta". */
  customer: WizardCustomer | null;
  /** Czy tenant ma podłączone konto rozliczeniowe (bramka płatności online). */
  paymentAccountConnected: boolean;
  errorSlot: (field: string) => React.ReactNode;
  fieldErrors: Record<string, string> | undefined;
}) {
  const t = useTranslations("orders.form");
  const tDelivery = useTranslations("orders.delivery");

  const usesPoint = methodUsesDeliveryPoint(state.method);
  const usesAddress = methodUsesDeliveryAddress(state.method);
  const customerAddress = customer ? customerAddressLine(customer) : null;

  return (
    <div className="flex flex-col gap-5">
      {/* --- Metoda dostawy: karty z ceną z cennika --- */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t("deliveryMethod")}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-delivery-methods>
          {DELIVERY_METHOD_ORDER.map((method) => {
            const grosze = previewPrice(method, pricing, rentalTotalGrosze);
            const selected = state.method === method;
            return (
              <label
                key={method}
                data-delivery-method={method}
                data-selected={selected || undefined}
                className="border-input has-[:checked]:border-foreground has-[:checked]:bg-secondary has-[:focus-visible]:outline-accent dark:has-[:focus-visible]:outline-ring flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2"
              >
                <input
                  type="radio"
                  name="deliveryMethod"
                  value={method}
                  checked={selected}
                  onChange={() =>
                    onChange({
                      method,
                      // Zmiana metody CZYŚCI dane celu poprzedniej — inaczej
                      // numer paczkomatu jechałby z zamówieniem kurierskim
                      // (bramki 0044 odmówiłyby, ale operator zobaczyłby
                      //  odmowę zamiast czystego formularza).
                      pointCode: "",
                      pointAddress: "",
                      addressSource: methodUsesDeliveryAddress(method) ? "customer" : "",
                      addressName: "",
                      addressStreet: "",
                      addressZip: "",
                      addressCity: "",
                      addressPhone: "",
                      // Odbiór osobisty jest bezpłatny z definicji (ADR-030) —
                      // cena własna przestaje mieć sens razem z wyborem.
                      ...(method === "pickup" ? { priceSource: "pricing" as const, price: "" } : {}),
                    })
                  }
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{tDelivery(method)}</span>
                  <span className="text-muted-foreground text-xs" data-delivery-price>
                    {method === "pickup"
                      ? t("deliveryFree")
                      : grosze === null
                        ? t("deliveryNoPricing")
                        : grosze === 0
                          ? t("deliveryFreeThreshold")
                          : formatMoney(grosze, currency, locale)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* --- Punkt odbioru najemcy (odbiór osobisty) --- */}
      {state.method === "pickup" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="order-location">{t("pickupLocation")}</Label>
          <PanelSelect
            id="order-location"
            name="pickupLocationId"
            value={state.pickupLocationId}
            onValueChange={(value) => onChange({ pickupLocationId: value })}
            className={FIELD_CLASS}
            invalid={Boolean(fieldErrors?.pickupLocationId)}
            describedBy={fieldErrors?.pickupLocationId ? "order-pickupLocationId-error" : undefined}
            options={locations.map((location) => ({ value: location.id, label: location.name }))}
          />
          {errorSlot("pickupLocationId")}
        </div>
      ) : (
        <input type="hidden" name="pickupLocationId" value="" />
      )}

      {/* --- Punkt przewoźnika (paczkomat) --- */}
      {usesPoint ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-point-code">{t("deliveryPointCode")}</Label>
            <Input
              id="order-point-code"
              name="deliveryPointCode"
              value={state.pointCode}
              // Kody punktów są wersalikami u każdego dostawcy — normalizujemy
              // przy wpisywaniu, żeby „poz08m" i „POZ08M" nie były dwiema
              // różnymi danymi w bazie.
              onChange={(event) => onChange({ pointCode: event.target.value.toUpperCase() })}
              placeholder={t("deliveryPointCodePlaceholder")}
              maxLength={32}
              className="uppercase"
              aria-invalid={fieldErrors?.deliveryPointCode ? true : undefined}
              aria-describedby={fieldErrors?.deliveryPointCode ? "order-deliveryPointCode-error" : undefined}
              data-delivery-point-code
            />
            {errorSlot("deliveryPointCode")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-point-address">{t("deliveryPointAddress")}</Label>
            <Input
              id="order-point-address"
              name="deliveryPointAddress"
              value={state.pointAddress}
              onChange={(event) => onChange({ pointAddress: event.target.value })}
              placeholder={t("deliveryPointAddressPlaceholder")}
              maxLength={300}
            />
            <p className="text-muted-foreground text-xs">{t("deliveryPointAddressHint")}</p>
          </div>
          <input type="hidden" name="deliveryPointProvider" value={DEFAULT_POINT_PROVIDER} />
        </div>
      ) : (
        <>
          <input type="hidden" name="deliveryPointProvider" value="" />
          <input type="hidden" name="deliveryPointCode" value="" />
          <input type="hidden" name="deliveryPointAddress" value="" />
        </>
      )}

      {/* --- Adres dostarczenia (kurier, dostawa własna) --- */}
      {usesAddress ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">{t("deliveryAddressSection")}</legend>
          <div className="flex flex-col gap-2" data-delivery-address-source>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="deliveryAddressSource"
                value="customer"
                checked={state.addressSource === "customer"}
                onChange={() =>
                  onChange({
                    addressSource: "customer",
                    // Wariant „z kartoteki" jest WSKAŹNIKIEM — pola muszą
                    // zostać puste, inaczej powstaje druga prawda o adresie
                    // (bramka orders_delivery_address_shape, 0044).
                    addressName: "",
                    addressStreet: "",
                    addressZip: "",
                    addressCity: "",
                    addressPhone: "",
                  })
                }
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span>{t("deliveryAddressFromCustomer")}</span>
                <span className="text-muted-foreground text-xs" data-customer-address>
                  {customer === null
                    ? t("deliveryAddressNoCustomer")
                    : (customerAddress ?? t("deliveryAddressCustomerEmpty"))}
                </span>
              </span>
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="radio"
                name="deliveryAddressSource"
                value="custom"
                checked={state.addressSource === "custom"}
                onChange={() => onChange({ addressSource: "custom" })}
              />
              {t("deliveryAddressOther")}
            </label>
          </div>

          {state.addressSource === "custom" ? (
            <div className="border-border grid grid-cols-1 gap-4 rounded-lg border p-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="order-address-name">{t("deliveryAddressName")}</Label>
                <Input
                  id="order-address-name"
                  name="deliveryAddressName"
                  value={state.addressName}
                  onChange={(event) => onChange({ addressName: event.target.value })}
                  maxLength={200}
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="order-address-street">{t("deliveryAddressStreet")}</Label>
                <Input
                  id="order-address-street"
                  name="deliveryAddressStreet"
                  value={state.addressStreet}
                  onChange={(event) => onChange({ addressStreet: event.target.value })}
                  maxLength={200}
                  aria-invalid={fieldErrors?.deliveryAddressStreet ? true : undefined}
                  aria-describedby={
                    fieldErrors?.deliveryAddressStreet ? "order-deliveryAddressStreet-error" : undefined
                  }
                  data-delivery-address-street
                />
                {errorSlot("deliveryAddressStreet")}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-address-zip">{t("deliveryAddressZip")}</Label>
                <Input
                  id="order-address-zip"
                  name="deliveryAddressZip"
                  value={state.addressZip}
                  onChange={(event) => onChange({ addressZip: event.target.value })}
                  maxLength={20}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-address-city">{t("deliveryAddressCity")}</Label>
                <Input
                  id="order-address-city"
                  name="deliveryAddressCity"
                  value={state.addressCity}
                  onChange={(event) => onChange({ addressCity: event.target.value })}
                  maxLength={100}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-address-phone">{t("deliveryAddressPhone")}</Label>
                <Input
                  id="order-address-phone"
                  name="deliveryAddressPhone"
                  value={state.addressPhone}
                  onChange={(event) => onChange({ addressPhone: event.target.value })}
                  maxLength={32}
                />
              </div>
            </div>
          ) : (
            <>
              <input type="hidden" name="deliveryAddressName" value="" />
              <input type="hidden" name="deliveryAddressStreet" value="" />
              <input type="hidden" name="deliveryAddressZip" value="" />
              <input type="hidden" name="deliveryAddressCity" value="" />
              <input type="hidden" name="deliveryAddressPhone" value="" />
            </>
          )}
          {errorSlot("deliveryAddressSource")}
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="deliveryAddressSource" value="" />
          <input type="hidden" name="deliveryAddressName" value="" />
          <input type="hidden" name="deliveryAddressStreet" value="" />
          <input type="hidden" name="deliveryAddressZip" value="" />
          <input type="hidden" name="deliveryAddressCity" value="" />
          <input type="hidden" name="deliveryAddressPhone" value="" />
        </>
      )}

      {/* --- Cena dostawy: cennik albo własna --- */}
      {state.method === "pickup" ? (
        <>
          <input type="hidden" name="deliveryPriceSource" value="pricing" />
          <input type="hidden" name="deliveryPrice" value="" />
        </>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">{t("deliveryPriceSection")}</legend>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="radio"
                name="deliveryPriceSource"
                value="pricing"
                checked={state.priceSource === "pricing"}
                onChange={() => onChange({ priceSource: "pricing", price: "" })}
              />
              {t("deliveryPriceFromPricing")}
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="radio"
                name="deliveryPriceSource"
                value="manual"
                checked={state.priceSource === "manual"}
                onChange={() => onChange({ priceSource: "manual" })}
                data-delivery-price-manual
              />
              {t("deliveryPriceManual")}
            </label>
          </div>
          {state.priceSource === "manual" ? (
            <div className="flex flex-col gap-1.5 sm:w-56">
              <Label htmlFor="order-delivery-price">{t("deliveryPriceLabel")}</Label>
              <Input
                id="order-delivery-price"
                name="deliveryPrice"
                inputMode="decimal"
                value={state.price}
                onChange={(event) => onChange({ price: event.target.value })}
                placeholder={t("deliveryPricePlaceholder")}
                aria-invalid={fieldErrors?.deliveryPrice ? true : undefined}
                aria-describedby={fieldErrors?.deliveryPrice ? "order-deliveryPrice-error" : undefined}
                data-delivery-price-input
              />
              <p className="text-muted-foreground text-xs">
                {t("deliveryPriceHint", { max: DELIVERY_PRICE_OVERRIDE_MAX_GROSZE / 100 })}
              </p>
              {errorSlot("deliveryPrice")}
            </div>
          ) : (
            <input type="hidden" name="deliveryPrice" value="" />
          )}
        </fieldset>
      )}

      {/* --- Forma płatności --- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">{t("paymentMethodSection")}</legend>
        <div className="flex flex-col gap-2" data-payment-methods>
          {ORDER_PAYMENT_METHODS.map((method) => {
            const blocked = method === "online" && !paymentAccountConnected;
            return (
              <label
                key={method}
                className="flex items-start gap-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={method}
                  checked={state.paymentMethod === method}
                  disabled={blocked}
                  onChange={() => onChange({ paymentMethod: method })}
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <span>{t(`paymentMethod_${method}`)}</span>
                  {blocked ? (
                    <span className="text-muted-foreground text-xs">{t("paymentMethodOnlineBlocked")}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
          <label className="flex items-center gap-3 text-sm">
            <input
              type="radio"
              name="paymentMethod"
              value=""
              checked={state.paymentMethod === ""}
              onChange={() => onChange({ paymentMethod: "" })}
            />
            {t("paymentMethodUndecided")}
          </label>
        </div>
        {errorSlot("paymentMethod")}
      </fieldset>
    </div>
  );
}
