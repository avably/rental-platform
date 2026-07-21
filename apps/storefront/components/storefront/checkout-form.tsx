"use client";

/**
 * Formularz checkoutu storefrontu (Zadanie 2.4b). Zbiera dane klienta, metodę
 * dostawy (+ punkt odbioru przy 'pickup'), akceptację regulaminu, honeypot i
 * token Turnstile, a pozycje/termin bierze z koszyka (localStorage). Woła
 * submitCheckout (rdzeń 2.4a — NIE edytowany) i mapuje KAŻDY status wyniku na
 * komunikat (lib/checkout-form-ui.ts).
 *
 * KWOTY: podsumowanie na żywo to PODGLĄD (previewTotals). Po sukcesie ekran
 * potwierdzenia pokazuje kwoty WYŁĄCZNIE z order serwera (orderSummaryTotals) —
 * podgląd lokalny nie ma na nie wpływu (ADR-042).
 */
import { formatMoney, type CurrencyCode } from "@avably/core";
import { Button, Checkbox, Input, Label, Textarea } from "@avably/ui";
import { useEffect, useState, type FormEvent } from "react";

import Link from "next/link";

import { submitCheckout } from "@/lib/actions/checkout";
import { isCheckoutReady, toCheckoutItems } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import { previewTotals } from "@/lib/catalog/preview";
import type {
  CheckoutDeliveryMethod,
  CheckoutField,
  CheckoutInput,
  PublicCatalogProduct,
  PublicDeliveryMethod,
  PublicPickupLocation,
} from "@/lib/checkout/contract";
import {
  getCheckoutMessageKey,
  mapCheckoutResult,
  orderSummaryTotals,
  shouldResetCaptcha,
  type CheckoutViewState,
} from "@/lib/checkout-form-ui";
import type { StorefrontCopy } from "@/lib/storefront/copy";
import type { StorefrontLocale } from "@/lib/storefront/locale";
import { STOREFRONT_TERMS_VERSION } from "@/lib/storefront/constants";
import { TurnstileWidget } from "@/components/turnstile-widget";

interface CheckoutFormProps {
  products: PublicCatalogProduct[];
  deliveryMethods: PublicDeliveryMethod[];
  pickupLocations: PublicPickupLocation[];
  currency: CurrencyCode;
  locale: StorefrontLocale;
  copy: StorefrontCopy;
  turnstileSiteKey?: string | undefined;
}

function deliveryLabel(copy: StorefrontCopy, method: CheckoutDeliveryMethod): string {
  switch (method) {
    case "pickup":
      return copy.checkout.methodPickup;
    case "courier":
      return copy.checkout.methodCourier;
    case "parcel_locker":
      return copy.checkout.methodParcelLocker;
    case "own_delivery":
      return copy.checkout.methodOwnDelivery;
  }
}

interface Values {
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  nip: string;
  addressStreet: string;
  addressZip: string;
  addressCity: string;
  notes: string;
  deliveryMethod: CheckoutDeliveryMethod;
  pickupLocationId: string;
  terms: boolean;
  honeypot: string;
}

const EMPTY_VALUES: Values = {
  fullName: "",
  email: "",
  phone: "",
  companyName: "",
  nip: "",
  addressStreet: "",
  addressZip: "",
  addressCity: "",
  notes: "",
  deliveryMethod: "pickup",
  pickupLocationId: "",
  terms: false,
  honeypot: "",
};

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return (
    <p className="min-h-5 text-sm text-destructive" id={id}>
      {message}
    </p>
  );
}

export function CheckoutForm({
  products,
  deliveryMethods,
  pickupLocations,
  currency,
  locale,
  copy,
  turnstileSiteKey,
}: CheckoutFormProps) {
  const { cart, hydrated, clear } = useCart();
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [view, setView] = useState<CheckoutViewState>({ kind: "idle" });
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaEpoch, setCaptchaEpoch] = useState(0);

  // Po sukcesie czyścimy koszyk raz (zamówienie utrwalone po stronie serwera) —
  // efekt synchronizuje zewnętrzny store (localStorage), nie stan Reacta.
  useEffect(() => {
    if (view.kind === "success") clear();
  }, [view.kind, clear]);

  const fields = view.kind === "validation" ? view.fields : {};
  const messageKey = getCheckoutMessageKey(view);
  const submitting = view.kind === "submitting";

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (view.kind === "validation") setView({ kind: "idle" });
  }

  function fieldMessage(field: CheckoutField): string | undefined {
    if (!fields[field]) return undefined;
    const errors = copy.checkout.errors;
    switch (field) {
      case "fullName":
        return errors.fullName;
      case "email":
        return errors.email;
      case "phone":
        return errors.phone;
      case "startDate":
        return errors.startDate;
      case "endDate":
        return errors.endDate;
      case "deliveryMethod":
        return errors.deliveryMethod;
      case "pickupLocationId":
        return errors.pickupLocationId;
      case "items":
        return errors.items;
      default:
        return errors.generic;
    }
  }

  /**
   * `aria-describedby` WYŁĄCZNIE gdy pole faktycznie ma komunikat (WCAG 3.3.1).
   * Kontener błędu istnieje zawsze (rezerwuje wysokość, żeby układ nie skakał),
   * więc stałe wiązanie kazałoby czytnikowi ogłaszać pusty węzeł przy każdym
   * wejściu w pole.
   */
  function describedBy(field: CheckoutField, errorId: string): string | undefined {
    return fields[field] ? errorId : undefined;
  }

  // --- Ekran potwierdzenia (sukces) -------------------------------------
  if (view.kind === "success") {
    const order = view.order;
    const totals = orderSummaryTotals(order);
    const methodLabel = deliveryLabel(copy, order.deliveryMethod);
    return (
      // h2, nie h1: strona checkoutu ma już własny h1, a ekran potwierdzenia
      // renderuje się W NIEJ. Dwa h1 na jednej stronie łamią hierarchię
      // nagłówków (WCAG 1.3.1) i psują nawigację czytnika po nagłówkach.
      <div className="rounded-lg border border-border bg-card p-6" role="status">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.confirmation.title}</h2>
        <p className="mt-2 text-lg">
          {copy.confirmation.orderNumber}:{" "}
          <strong className="tabular-nums">{order.orderNumber}</strong>
        </p>
        <p className="mt-3 leading-7 text-muted-foreground">{copy.confirmation.paymentNote}</p>

        <dl className="mt-6 grid gap-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{copy.confirmation.rentalPeriod}</dt>
            <dd>
              {order.startDate} → {order.endDate}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{copy.confirmation.deliveryMethod}</dt>
            <dd>{methodLabel}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{copy.confirmation.summaryRental}</dt>
            <dd>{formatMoney(totals.rentalGrosze, currency, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{copy.confirmation.summaryDeposit}</dt>
            <dd>{formatMoney(totals.depositGrosze, currency, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{copy.confirmation.summaryDelivery}</dt>
            <dd>{formatMoney(totals.deliveryGrosze, currency, locale)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>{copy.confirmation.summaryTotal}</dt>
            <dd>{formatMoney(totals.totalGrosze, currency, locale)}</dd>
          </div>
        </dl>

        <p className="mt-4 text-sm text-muted-foreground">
          {view.emailIssues.length > 0 ? copy.confirmation.emailIssue : copy.confirmation.emailSent}
        </p>
        <Link href="/store" className="mt-6 inline-block font-medium underline underline-offset-4">
          {copy.confirmation.backToStore}
        </Link>
      </div>
    );
  }

  // --- Koszyk pusty / bez terminu → nie ma czego zamawiać ----------------
  if (hydrated && !isCheckoutReady(cart)) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground">{copy.checkout.cartEmpty}</p>
        <Link href="/store" className="font-medium underline underline-offset-4">
          {copy.cart.emptyCta}
        </Link>
      </div>
    );
  }

  // Podgląd kwot (szacunek) — zależny od metody dostawy i terminu z koszyka.
  const totals = previewTotals({
    items: cart.items,
    products,
    startDate: cart.startDate ?? "",
    endDate: cart.endDate ?? "",
    deliveryMethod: values.deliveryMethod,
    deliveryMethods,
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isCheckoutReady(cart)) return;

    const input: CheckoutInput = {
      email: values.email,
      fullName: values.fullName,
      startDate: cart.startDate!,
      endDate: cart.endDate!,
      deliveryMethod: values.deliveryMethod,
      pickupLocationId:
        values.deliveryMethod === "pickup" ? values.pickupLocationId || undefined : undefined,
      items: toCheckoutItems(cart),
      termsAccepted: values.terms,
      termsVersion: STOREFRONT_TERMS_VERSION,
      phone: values.phone || undefined,
      companyName: values.companyName || undefined,
      nip: values.nip || undefined,
      addressStreet: values.addressStreet || undefined,
      addressZip: values.addressZip || undefined,
      addressCity: values.addressCity || undefined,
      locale,
      notes: values.notes || undefined,
      captchaToken: captchaToken ?? undefined,
      honeypot: values.honeypot,
    };

    setView({ kind: "submitting" });
    try {
      const mapped = mapCheckoutResult(await submitCheckout(input));
      setView(mapped);
      if (turnstileSiteKey && shouldResetCaptcha(mapped)) {
        setCaptchaToken(null);
        setCaptchaEpoch((epoch) => epoch + 1);
      }
    } catch {
      setView({ kind: "connection_error" });
      if (turnstileSiteKey) {
        setCaptchaToken(null);
        setCaptchaEpoch((epoch) => epoch + 1);
      }
    }
  }

  const showPickup = values.deliveryMethod === "pickup";

  return (
    <form className="grid gap-8 lg:grid-cols-[1fr_20rem]" noValidate onSubmit={handleSubmit}>
      <div className="grid gap-8">
        {/* Alert błędu (nie-walidacyjny) */}
        {messageKey ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm" role="alert">
            {messageKey === "unavailable" ? copy.checkout.errors.unavailable : null}
            {messageKey === "rejected" ? copy.checkout.errors.rejected : null}
            {messageKey === "rate_limited" ? copy.checkout.errors.rateLimited : null}
            {messageKey === "captcha" ? copy.checkout.errors.captcha : null}
            {messageKey === "connection" ? copy.checkout.errors.connection : null}
            {messageKey === "server" ? copy.checkout.errors.server : null}
          </div>
        ) : null}

        {/* Dane kontaktowe */}
        <fieldset className="grid gap-4" disabled={submitting}>
          <legend className="text-lg font-semibold">{copy.checkout.contactHeading}</legend>
          <div className="grid gap-1">
            <Label htmlFor="co-fullname">
              {copy.checkout.fullName} <span className="text-muted-foreground">({copy.common.required})</span>
            </Label>
            <Input
              id="co-fullname"
              autoComplete="name"
              aria-invalid={Boolean(fields.fullName)}
              aria-describedby={describedBy("fullName", "co-fullname-error")}
              value={values.fullName}
              onChange={(event) => set("fullName", event.target.value)}
              maxLength={200}
            />
            <FieldError id="co-fullname-error" message={fieldMessage("fullName")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="co-email">
              {copy.checkout.email} <span className="text-muted-foreground">({copy.common.required})</span>
            </Label>
            <Input
              id="co-email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(fields.email)}
              aria-describedby={describedBy("email", "co-email-error")}
              value={values.email}
              onChange={(event) => set("email", event.target.value)}
              maxLength={320}
            />
            <FieldError id="co-email-error" message={fieldMessage("email")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="co-phone">
              {copy.checkout.phone} <span className="text-muted-foreground">({copy.common.optional})</span>
            </Label>
            <Input
              id="co-phone"
              type="tel"
              autoComplete="tel"
              aria-invalid={Boolean(fields.phone)}
              aria-describedby={describedBy("phone", "co-phone-error")}
              value={values.phone}
              onChange={(event) => set("phone", event.target.value)}
              maxLength={32}
            />
            <FieldError id="co-phone-error" message={fieldMessage("phone")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="co-company">
                {copy.checkout.companyName}{" "}
                <span className="text-muted-foreground">({copy.common.optional})</span>
              </Label>
              <Input
                id="co-company"
                autoComplete="organization"
                value={values.companyName}
                onChange={(event) => set("companyName", event.target.value)}
                maxLength={200}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="co-nip">
                {copy.checkout.nip} <span className="text-muted-foreground">({copy.common.optional})</span>
              </Label>
              <Input
                id="co-nip"
                value={values.nip}
                onChange={(event) => set("nip", event.target.value)}
                maxLength={32}
              />
            </div>
          </div>
        </fieldset>

        {/* Adres (opcjonalny) */}
        <fieldset className="grid gap-4" disabled={submitting}>
          <legend className="text-lg font-semibold">
            {copy.checkout.addressHeading}{" "}
            <span className="text-sm font-normal text-muted-foreground">({copy.common.optional})</span>
          </legend>
          <div className="grid gap-1">
            <Label htmlFor="co-street">{copy.checkout.addressStreet}</Label>
            <Input
              id="co-street"
              autoComplete="street-address"
              value={values.addressStreet}
              onChange={(event) => set("addressStreet", event.target.value)}
              maxLength={200}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="co-zip">{copy.checkout.addressZip}</Label>
              <Input
                id="co-zip"
                autoComplete="postal-code"
                value={values.addressZip}
                onChange={(event) => set("addressZip", event.target.value)}
                maxLength={20}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="co-city">{copy.checkout.addressCity}</Label>
              <Input
                id="co-city"
                autoComplete="address-level2"
                value={values.addressCity}
                onChange={(event) => set("addressCity", event.target.value)}
                maxLength={120}
              />
            </div>
          </div>
        </fieldset>

        {/* Sposób odbioru */}
        <fieldset className="grid gap-4" disabled={submitting}>
          <legend className="text-lg font-semibold">{copy.checkout.deliveryHeading}</legend>
          <div className="grid gap-2">
            {deliveryMethods.map((method) => {
              const free = method.method === "pickup" || method.price_grosze === 0;
              return (
                <label
                  key={method.method}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="deliveryMethod"
                      value={method.method}
                      aria-describedby={describedBy("deliveryMethod", "co-delivery-error")}
                      checked={values.deliveryMethod === method.method}
                      onChange={() => set("deliveryMethod", method.method)}
                    />
                    <span>{deliveryLabel(copy, method.method)}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {free ? copy.checkout.deliveryFree : formatMoney(method.price_grosze, currency, locale)}
                  </span>
                </label>
              );
            })}
            <FieldError id="co-delivery-error" message={fieldMessage("deliveryMethod")} />
          </div>

          {showPickup ? (
            <div className="grid gap-1">
              <Label htmlFor="co-pickup">{copy.checkout.pickupLocation}</Label>
              <select
                id="co-pickup"
                className="border-input h-10 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
                aria-invalid={Boolean(fields.pickupLocationId)}
                aria-describedby={describedBy("pickupLocationId", "co-pickup-error")}
                value={values.pickupLocationId}
                onChange={(event) => set("pickupLocationId", event.target.value)}
              >
                <option value="">{copy.checkout.choosePickup}</option>
                {pickupLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                    {location.address_city ? ` — ${location.address_city}` : ""}
                  </option>
                ))}
              </select>
              <FieldError id="co-pickup-error" message={fieldMessage("pickupLocationId")} />
            </div>
          ) : null}
        </fieldset>

        {/* Uwagi */}
        <fieldset className="grid gap-2" disabled={submitting}>
          <Label htmlFor="co-notes">
            {copy.checkout.notes} <span className="text-muted-foreground">({copy.common.optional})</span>
          </Label>
          <Textarea
            id="co-notes"
            value={values.notes}
            onChange={(event) => set("notes", event.target.value)}
            maxLength={2000}
            rows={3}
          />
        </fieldset>

        {/* Honeypot — ukryte pole-pułapka na boty (musi zostać puste). */}
        <div aria-hidden="true" className="sr-only">
          <label htmlFor="co-website">Website</label>
          <input
            id="co-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={values.honeypot}
            onChange={(event) => set("honeypot", event.target.value)}
          />
        </div>
      </div>

      {/* Podsumowanie + akcje (sticky na desktopie) */}
      <aside className="grid h-fit gap-4 rounded-lg border border-border p-5 lg:sticky lg:top-6">
        <h2 className="text-lg font-semibold">{copy.checkout.summaryHeading}</h2>
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{copy.checkout.summaryRental}</dt>
            <dd>{formatMoney(totals.rentalGrosze, currency, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{copy.checkout.summaryDeposit}</dt>
            <dd>{formatMoney(totals.depositGrosze, currency, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{copy.checkout.summaryDelivery}</dt>
            <dd>{formatMoney(totals.deliveryGrosze, currency, locale)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>{copy.checkout.summaryTotal}</dt>
            <dd>{formatMoney(totals.totalGrosze, currency, locale)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{copy.checkout.depositNote}</p>
        <p className="text-xs text-muted-foreground">{copy.common.estimateNote}</p>

        {/* Regulamin */}
        <div className="flex items-start gap-3 border-t border-border pt-4">
          <Checkbox
            id="co-terms"
            aria-invalid={Boolean(fields.terms)}
            aria-describedby={describedBy("terms", "co-terms-error")}
            checked={values.terms}
            onCheckedChange={(checked) => set("terms", checked === true)}
            disabled={submitting}
          />
          <Label htmlFor="co-terms" className="text-sm leading-6 font-normal">
            {copy.checkout.termsLabel}
          </Label>
        </div>
        <FieldError id="co-terms-error" message={fields.terms ? copy.checkout.errors.terms : undefined} />

        {turnstileSiteKey ? (
          <TurnstileWidget
            key={captchaEpoch}
            locale={locale}
            onToken={setCaptchaToken}
            siteKey={turnstileSiteKey}
          />
        ) : null}

        <Button type="submit" className="w-full" size="lg" disabled={submitting}>
          {submitting ? copy.checkout.submitting : copy.checkout.submit}
        </Button>
      </aside>
    </form>
  );
}
