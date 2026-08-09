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
 *
 * WYGLĄD Z MOTYWU NAJEMCY (K6, ADR-092). Kasa jest ostatnim ekranem przed
 * zapłatą, więc rozjazd wizualny kosztuje tu najwięcej zaufania — nosi zatem
 * WYŁĄCZNIE role (`site-card`, `site-field`, `site-label`, `site-cta`,
 * `site-error`, `site-error-panel`), a wartości bierze ze zmiennych motywu
 * z korzenia strony.
 *
 * POLA SĄ ZWYKŁYM HTML-em, nie komponentami `@avably/ui`. Tamte wnoszą własne
 * tokeny panelu (obrys pola, wypełnienie przycisku, kolor fokusu) w warstwie
 * utilities — czyli paleta panelu wjeżdżałaby tu przez zależność, której skan
 * ŹRÓDEŁ tego pliku nie widzi, a gwarancja „bez palety panelu" byłaby pozorna.
 * Zamiana kosztuje kilka klas układu; nic z dostępności (etykiety, `aria-*`,
 * natywny `<select>`, natywny checkbox) nie znika.
 */
import { formatMoney, type CurrencyCode, type CustomFieldDefinition } from "@avably/core";
import { useEffect, useState, type FormEvent } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { submitCheckout } from "@/lib/actions/checkout";
import { isCheckoutReady, toCheckoutItems } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import { previewTotals } from "@/lib/catalog/preview";
import type {
  CheckoutDeliveryMethod,
  CheckoutField,
  CheckoutInput,
  CheckoutPaymentMethod,
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
import { CheckoutCustomFields } from "@/components/storefront/checkout-custom-fields";
import { checkoutCustomFieldKey } from "@/lib/checkout/custom-fields";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { SITE_HEADING } from "@/components/storefront/store-chrome";

interface CheckoutFormProps {
  products: PublicCatalogProduct[];
  deliveryMethods: PublicDeliveryMethod[];
  pickupLocations: PublicPickupLocation[];
  currency: CurrencyCode;
  locale: StorefrontLocale;
  copy: StorefrontCopy;
  turnstileSiteKey?: string | undefined;
  /**
   * Metody płatności policzone NA SERWERZE (ADR-066) — z odczytu stanu konta
   * najemcy u dostawcy, nie z kolumny w bazie. Tor offline jest w tej liście
   * zawsze; brak `online` znaczy „ten sklep dziś nie przyjmuje płatności
   * online", a nie „coś się zepsuło".
   *
   * Lista jest tu WSKAZÓWKĄ DLA UI, nie bramką: prawdziwa bramka stoi
   * w rdzeniu akcji, po stronie serwera, i pyta o stan konta jeszcze raz.
   */
  paymentMethods: CheckoutPaymentMethod[];
  /**
   * Pola własne DO WYPEŁNIENIA w zamawianiu (C6-A3, ADR-121) — już zawężone
   * na SERWERZE (`checkoutCustomFields`: flaga „zamawianie" ORAZ encja
   * klient/zamówienie). Filtr w komponencie dawałby pole niewidoczne, ale
   * zapisywalne — a serwer i tak liczy ten sam zbiór jeszcze raz przy zapisie.
   */
  customFields: CustomFieldDefinition[];
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

function paymentLabel(copy: StorefrontCopy, method: CheckoutPaymentMethod): string {
  switch (method) {
    case "online":
      return copy.checkout.paymentOnline;
    case "transfer":
      return copy.checkout.paymentTransfer;
    case "cod":
      return copy.checkout.paymentCod;
  }
}

function paymentHint(copy: StorefrontCopy, method: CheckoutPaymentMethod): string {
  switch (method) {
    case "online":
      return copy.checkout.paymentOnlineHint;
    case "transfer":
      return copy.checkout.paymentTransferHint;
    case "cod":
      return copy.checkout.paymentCodHint;
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
  paymentMethod: CheckoutPaymentMethod;
  terms: boolean;
  honeypot: string;
  /**
   * Wartości pól własnych, kluczowane ID DEFINICJI i trzymane STRINGAMI —
   * dokładnie tak, jak wychodzą z kontrolek HTML. Typowanie robi serwer.
   */
  custom: Record<string, string>;
}

const EMPTY_VALUES: Omit<Values, "paymentMethod"> = {
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
  custom: {},
};

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return (
    <p className="site-error min-h-5 text-sm" id={id}>
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
  paymentMethods,
  customFields,
}: CheckoutFormProps) {
  const router = useRouter();
  const { cart, hydrated, clear } = useCart();
  // Pierwsza metoda z listy serwera jest zaznaczona: gdy online jest
  // dostępne, klient chcący zapłacić od razu nie musi nic klikać, a reszta
  // ma wybór o jedno kliknięcie dalej.
  const [values, setValues] = useState<Values>({
    ...EMPTY_VALUES,
    paymentMethod: paymentMethods[0] ?? "transfer",
  });
  const [view, setView] = useState<CheckoutViewState>({ kind: "idle" });
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaEpoch, setCaptchaEpoch] = useState(0);

  // Po sukcesie czyścimy koszyk raz (zamówienie utrwalone po stronie serwera) —
  // efekt synchronizuje zewnętrzny store (localStorage), nie stan Reacta.
  useEffect(() => {
    if (view.kind === "success") clear();
  }, [view.kind, clear]);

  // Zamówienie opłacane online idzie na krok płatności. Nawigacja siedzi
  // w efekcie, nie w handlerze: koszyk musi zostać wyczyszczony niezależnie
  // od tego, czy przejście się powiedzie, a router w handlerze potrafiłby
  // odmontować komponent przed efektem czyszczącym.
  useEffect(() => {
    if (view.kind === "success" && view.nextStep === "payment") {
      router.push("/checkout/platnosc");
    }
  }, [view, router]);

  const fields = view.kind === "validation" ? view.fields : {};
  const messageKey = getCheckoutMessageKey(view);
  const submitting = view.kind === "submitting";

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (view.kind === "validation") setView({ kind: "idle" });
  }

  /** Komunikat pod polem własnym — klucz kontraktu to `cf_<id>`. */
  function customFieldMessage(definitionId: string): string | undefined {
    const error = fields[checkoutCustomFieldKey(definitionId)];
    if (!error) return undefined;
    const messages = copy.checkout.errors.customField;
    switch (error) {
      case "required":
        return messages.required;
      case "too_long":
        return messages.tooLong;
      case "not_allowed":
        return messages.notAllowed;
      default:
        return messages.invalid;
    }
  }

  function setCustomField(definitionId: string, value: string) {
    setValues((current) => ({ ...current, custom: { ...current.custom, [definitionId]: value } }));
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
      case "paymentMethod":
        return errors.paymentMethod;
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

  // --- Zamówienie online: przejście na krok płatności --------------------
  //
  // Świadomie NIE pokazujemy tu ekranu potwierdzenia: mówi on „płatność
  // rozliczysz z wypożyczalnią", co dla klienta płacącego kartą byłoby
  // nieprawdą, a mignąłby mu na ułamek sekundy przed przekierowaniem.
  if (view.kind === "success" && view.nextStep === "payment") {
    return (
      <div className="site-card p-6" role="status">
        <p className="site-text-muted">{copy.payment.loading}</p>
      </div>
    );
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
      <div className="site-card p-6" role="status">
        <h2 className={`text-2xl tracking-tight ${SITE_HEADING}`}>{copy.confirmation.title}</h2>
        <p className="mt-2 text-lg">
          {copy.confirmation.orderNumber}:{" "}
          <strong className="tabular-nums">{order.orderNumber}</strong>
        </p>
        <p className="site-text-muted mt-3 leading-7">{copy.confirmation.paymentNote}</p>

        <dl className="site-rule-top mt-6 grid gap-2 pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="site-text-muted">{copy.confirmation.rentalPeriod}</dt>
            <dd>
              {order.startDate} → {order.endDate}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="site-text-muted">{copy.confirmation.deliveryMethod}</dt>
            <dd>{methodLabel}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="site-text-muted">{copy.confirmation.summaryRental}</dt>
            <dd>{formatMoney(totals.rentalGrosze, currency, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="site-text-muted">{copy.confirmation.summaryDeposit}</dt>
            <dd>{formatMoney(totals.depositGrosze, currency, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="site-text-muted">{copy.confirmation.summaryDelivery}</dt>
            <dd>{formatMoney(totals.deliveryGrosze, currency, locale)}</dd>
          </div>
          <div className="site-rule-top flex justify-between pt-2 text-base font-semibold">
            <dt>{copy.confirmation.summaryTotal}</dt>
            <dd>{formatMoney(totals.totalGrosze, currency, locale)}</dd>
          </div>
        </dl>

        <p className="site-text-muted mt-4 text-sm">
          {view.emailIssues.length > 0 ? copy.confirmation.emailIssue : copy.confirmation.emailSent}
        </p>
        <Link href="/store" className="site-link mt-6 inline-block font-medium">
          {copy.confirmation.backToStore}
        </Link>
      </div>
    );
  }

  // --- Koszyk pusty / bez terminu → nie ma czego zamawiać ----------------
  if (hydrated && !isCheckoutReady(cart)) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="site-text-muted">{copy.checkout.cartEmpty}</p>
        <Link href="/store" className="site-link font-medium">
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
      paymentMethod: values.paymentMethod,
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
      // Mapa idzie ZAWSZE, także pusta: to serwer rozstrzyga, czy najemca ma
      // pole wymagane, którego klient nie wypełnił. Pominięcie klucza przy
      // pustym formularzu zamieniałoby „nic nie wpisałem" w „nie ma o co
      // pytać" — a to są dwa różne zdania.
      customFields: values.custom,
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
          <div className="site-error-panel p-4 text-sm" role="alert">
            {messageKey === "unavailable" ? copy.checkout.errors.unavailable : null}
            {messageKey === "rejected" ? copy.checkout.errors.rejected : null}
            {messageKey === "rate_limited" ? copy.checkout.errors.rateLimited : null}
            {messageKey === "captcha" ? copy.checkout.errors.captcha : null}
            {messageKey === "connection" ? copy.checkout.errors.connection : null}
            {messageKey === "payment_unavailable" ? copy.checkout.errors.paymentUnavailable : null}
            {messageKey === "server" ? copy.checkout.errors.server : null}
          </div>
        ) : null}

        {/* Dane kontaktowe */}
        <fieldset className="grid gap-4" disabled={submitting}>
          <legend className={`text-lg ${SITE_HEADING}`}>{copy.checkout.contactHeading}</legend>
          <div className="grid gap-1">
            <label className="site-label text-sm" htmlFor="co-fullname">
              {copy.checkout.fullName} <span className="site-text-muted">({copy.common.required})</span>
            </label>
            <input
              className="site-field h-9 w-full px-3 text-sm"
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
            <label className="site-label text-sm" htmlFor="co-email">
              {copy.checkout.email} <span className="site-text-muted">({copy.common.required})</span>
            </label>
            <input
              className="site-field h-9 w-full px-3 text-sm"
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
            <label className="site-label text-sm" htmlFor="co-phone">
              {copy.checkout.phone} <span className="site-text-muted">({copy.common.optional})</span>
            </label>
            <input
              className="site-field h-9 w-full px-3 text-sm"
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
              <label className="site-label text-sm" htmlFor="co-company">
                {copy.checkout.companyName}{" "}
                <span className="site-text-muted">({copy.common.optional})</span>
              </label>
              <input
                className="site-field h-9 w-full px-3 text-sm"
                id="co-company"
                autoComplete="organization"
                value={values.companyName}
                onChange={(event) => set("companyName", event.target.value)}
                maxLength={200}
              />
            </div>
            <div className="grid gap-1">
              <label className="site-label text-sm" htmlFor="co-nip">
                {copy.checkout.nip} <span className="site-text-muted">({copy.common.optional})</span>
              </label>
              <input
                className="site-field h-9 w-full px-3 text-sm"
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
          <legend className={`text-lg ${SITE_HEADING}`}>
            {copy.checkout.addressHeading}{" "}
            <span className="site-text-muted text-sm font-normal">({copy.common.optional})</span>
          </legend>
          <div className="grid gap-1">
            <label className="site-label text-sm" htmlFor="co-street">{copy.checkout.addressStreet}</label>
            <input
              className="site-field h-9 w-full px-3 text-sm"
              id="co-street"
              autoComplete="street-address"
              value={values.addressStreet}
              onChange={(event) => set("addressStreet", event.target.value)}
              maxLength={200}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label className="site-label text-sm" htmlFor="co-zip">{copy.checkout.addressZip}</label>
              <input
                className="site-field h-9 w-full px-3 text-sm"
                id="co-zip"
                autoComplete="postal-code"
                value={values.addressZip}
                onChange={(event) => set("addressZip", event.target.value)}
                maxLength={20}
              />
            </div>
            <div className="grid gap-1">
              <label className="site-label text-sm" htmlFor="co-city">{copy.checkout.addressCity}</label>
              <input
                className="site-field h-9 w-full px-3 text-sm"
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
          <legend className={`text-lg ${SITE_HEADING}`}>{copy.checkout.deliveryHeading}</legend>
          <div className="grid gap-2">
            {deliveryMethods.map((method) => {
              const free = method.method === "pickup" || method.price_grosze === 0;
              return (
                <label
                  key={method.method}
                  className="site-card flex items-center justify-between gap-3 p-3"
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      className="accent-[color:var(--site-accent)]"
                      name="deliveryMethod"
                      value={method.method}
                      aria-describedby={describedBy("deliveryMethod", "co-delivery-error")}
                      checked={values.deliveryMethod === method.method}
                      onChange={() => set("deliveryMethod", method.method)}
                    />
                    <span>{deliveryLabel(copy, method.method)}</span>
                  </span>
                  <span className="site-text-muted text-sm">
                    {free ? copy.checkout.deliveryFree : formatMoney(method.price_grosze, currency, locale)}
                  </span>
                </label>
              );
            })}
            <FieldError id="co-delivery-error" message={fieldMessage("deliveryMethod")} />
          </div>

          {showPickup ? (
            <div className="grid gap-1">
              <label className="site-label text-sm" htmlFor="co-pickup">{copy.checkout.pickupLocation}</label>
              {/*
                Natywny <select> zostaje (dostępność, klawiatura, natywna lista
                na telefonie), ale systemowa strzałka znika: `appearance-none`
                zdejmuje ją razem z systemowym tłem, a własna wraca jako
                warstwa pod spodem. Bez tego pole było jedynym elementem
                formularza rysowanym przez system operacyjny — obcym wśród
                pozostałych i innym na każdej platformie.

                Strzałka jest `pointer-events-none`, więc kliknięcie w nią
                nadal otwiera listę; `pr-9` rezerwuje jej miejsce, żeby długa
                nazwa punktu nie wjeżdżała pod ikonę.
              */}
              <div className="relative">
                <select
                  id="co-pickup"
                  className="site-field h-10 w-full appearance-none px-3 pr-9 text-sm"
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
                <svg
                  aria-hidden="true"
                  className="site-text-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </div>
              <FieldError id="co-pickup-error" message={fieldMessage("pickupLocationId")} />
            </div>
          ) : null}
        </fieldset>

        {/* Sposób płatności */}
        <fieldset className="grid gap-4" disabled={submitting}>
          <legend className={`text-lg ${SITE_HEADING}`}>{copy.checkout.paymentHeading}</legend>
          <div className="grid gap-2">
            {paymentMethods.map((method) => (
              <label
                key={method}
                className="site-card flex items-start gap-3 p-3"
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  className="mt-1 accent-[color:var(--site-accent)]"
                  value={method}
                  aria-describedby={describedBy("paymentMethod", "co-payment-error")}
                  checked={values.paymentMethod === method}
                  onChange={() => set("paymentMethod", method)}
                />
                <span className="grid gap-0.5">
                  <span>{paymentLabel(copy, method)}</span>
                  <span className="site-text-muted text-sm">
                    {paymentHint(copy, method)}
                  </span>
                </span>
              </label>
            ))}
            <FieldError id="co-payment-error" message={fieldMessage("paymentMethod")} />
          </div>

          {/*
            Sklep bez płatności online nie dostaje komunikatu o awarii ani
            wyszarzonej opcji „niedostępne" — dostaje zdanie opisujące, jak
            ta wypożyczalnia się rozlicza (ADR-066). Dla klienta to nie jest
            brak funkcji, tylko informacja o sprzedawcy.
          */}
          {paymentMethods.includes("online") ? null : (
            <p className="site-text-muted text-sm">{copy.checkout.paymentOfflineNote}</p>
          )}
        </fieldset>

        {/* Pola własne najemcy (C6-A3) — sekcja znika, gdy najemca ich nie ma. */}
        <CheckoutCustomFields
          definitions={customFields}
          values={values.custom}
          onChange={setCustomField}
          errors={Object.fromEntries(
            customFields.map((definition) => [definition.id, customFieldMessage(definition.id)]),
          )}
          heading={copy.checkout.customFieldsHeading}
          requiredLabel={copy.common.required}
          optionalLabel={copy.common.optional}
          choosePlaceholder={copy.checkout.customFieldChoose}
          disabled={submitting}
        />

        {/* Uwagi */}
        <fieldset className="grid gap-2" disabled={submitting}>
          <label className="site-label text-sm" htmlFor="co-notes">
            {copy.checkout.notes} <span className="site-text-muted">({copy.common.optional})</span>
          </label>
          <textarea
            id="co-notes"
            className="site-field w-full px-3 py-2 text-sm"
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
      <aside className="site-card grid h-fit gap-4 p-5 lg:sticky lg:top-6">
        <h2 className={`text-lg ${SITE_HEADING}`}>{copy.checkout.summaryHeading}</h2>
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="site-text-muted">{copy.checkout.summaryRental}</dt>
            <dd>{formatMoney(totals.rentalGrosze, currency, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="site-text-muted">{copy.checkout.summaryDeposit}</dt>
            <dd>{formatMoney(totals.depositGrosze, currency, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="site-text-muted">{copy.checkout.summaryDelivery}</dt>
            <dd>{formatMoney(totals.deliveryGrosze, currency, locale)}</dd>
          </div>
          <div className="site-rule-top flex justify-between pt-2 text-base font-semibold">
            <dt>{copy.checkout.summaryTotal}</dt>
            <dd>{formatMoney(totals.totalGrosze, currency, locale)}</dd>
          </div>
        </dl>
        <p className="site-text-muted text-xs">{copy.checkout.depositNote}</p>
        <p className="site-text-muted text-xs">{copy.common.estimateNote}</p>

        {/* Regulamin */}
        <div className="site-rule-top flex items-start gap-3 pt-4">
          {/*
            Natywny checkbox zamiast komponentu panelu: znacznik akceptacji ma
            być w AKCENCIE najemcy (`accent-color`), a nie w kolorze aplikacji.
            Kontrakt zdarzeń wraca do natywnego `onChange` — `checked` dalej
            steruje stanem formularza, więc pole zostaje kontrolowane.
          */}
          <input
            id="co-terms"
            type="checkbox"
            className="mt-1 size-4 accent-[color:var(--site-accent)]"
            aria-invalid={Boolean(fields.terms)}
            aria-describedby={describedBy("terms", "co-terms-error")}
            checked={values.terms}
            onChange={(event) => set("terms", event.target.checked)}
            disabled={submitting}
          />
          {/* Zgoda to tekst ciągły, nie etykieta pola — stąd bez `site-label`. */}
          <label htmlFor="co-terms" className="text-sm leading-6">
            {copy.checkout.termsLabel}
          </label>
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

        <button
          type="submit"
          className="site-cta w-full cursor-pointer text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? copy.checkout.submitting : copy.checkout.submit}
        </button>
      </aside>
    </form>
  );
}
