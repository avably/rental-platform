"use client";

/**
 * Pola płatności (Z3, ADR-066) — jedyny komponent kliencki, który rozmawia
 * z dostawcą płatności.
 *
 * CZEGO TEN KOMPONENT NIE ROBI I NIE BĘDZIE ROBIŁ: nie twierdzi, że
 * zamówienie jest opłacone. `confirmPayment()` zwraca obiekt płatności ze
 * statusem — i jest to DEKLARACJA PRZEKAZANA PRZEZ KLIENTA. Kod tej strony
 * jest pod kontrolą użytkownika; nawet gdyby nie był, stoi po złej stronie
 * granicy zaufania. Dlatego wynik potwierdzenia służy tu WYŁĄCZNIE do
 * pokazania błędu, gdy płatność się nie udała; przy powodzeniu dostawca
 * przekierowuje przeglądarkę na naszą stronę powrotu, która pyta o stan
 * WŁASNY serwer.
 *
 * WŁASNE WIĄZANIE ZAMIAST OFICJALNEJ OWIJKI REACTOWEJ: potrzebujemy dwóch
 * rzeczy — załadować bibliotekę dostawcy i zamontować jeden element. Owijka
 * przyniosłaby własny cykl życia i drugą zależność sprzężoną z wersją Reacta,
 * a to jest ~40 linii `useEffect`. Ta sama decyzja co przy koderze formularza
 * w porcie (piszemy swoje zamiast ciągnąć SDK).
 */
import { useEffect, useRef, useState } from "react";

import { formatMoney, type CurrencyCode } from "@avably/core";
import { Button } from "@avably/ui";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import Link from "next/link";

import type { OnlinePaymentPreparation } from "@/lib/checkout/online-payment";
import type { StorefrontCopy } from "@/lib/storefront/copy";
import type { StorefrontLocale } from "@/lib/storefront/locale";

interface PaymentStepProps {
  preparation: OnlinePaymentPreparation;
  orderNumber: string;
  amountGrosze: number;
  currency: CurrencyCode;
  locale: StorefrontLocale;
  copy: StorefrontCopy;
}

export function PaymentStep({
  preparation,
  orderNumber,
  amountGrosze,
  currency,
  locale,
  copy,
}: PaymentStepProps) {
  // --- Tor online niedostępny: to NIE jest ekran awarii (ADR-066) ---------
  //
  // Klient ma tu zamówienie, które istnieje, i wypożyczalnię, która czeka na
  // przelew. Komunikat mówi dokładnie to — bez słowa „błąd", bez proszenia
  // o ponowienie czegoś, co się nie zepsuło.
  if (preparation.status !== "ready") {
    const message =
      preparation.status === "unavailable"
        ? copy.payment.offlineFallback
        : copy.payment.error;
    return (
      <div className="rounded-lg border border-border bg-card p-6" role="status">
        <h2 className="text-xl font-semibold tracking-tight">{copy.payment.offlineTitle}</h2>
        <p className="mt-3 leading-7 text-muted-foreground">{message}</p>
        <p className="mt-4 text-sm">
          {copy.confirmation.orderNumber}:{" "}
          <strong className="tabular-nums">{orderNumber}</strong>
        </p>
        <Link
          href="/checkout/platnosc/status"
          className="mt-6 inline-block font-medium underline underline-offset-4"
        >
          {copy.payment.checkStatus}
        </Link>
      </div>
    );
  }

  return (
    <PaymentFields
      clientSecret={preparation.clientSecret}
      publishableKey={preparation.publishableKey}
      accountId={preparation.accountId}
      orderNumber={orderNumber}
      amountGrosze={amountGrosze}
      currency={currency}
      locale={locale}
      copy={copy}
    />
  );
}

interface PaymentFieldsProps {
  clientSecret: string;
  publishableKey: string;
  accountId: string;
  orderNumber: string;
  amountGrosze: number;
  currency: CurrencyCode;
  locale: StorefrontLocale;
  copy: StorefrontCopy;
}

function PaymentFields({
  clientSecret,
  publishableKey,
  accountId,
  orderNumber,
  amountGrosze,
  currency,
  locale,
  copy,
}: PaymentFieldsProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // `cancelled` zamiast polegania na kolejności: montowanie jest
    // asynchroniczne, a komponent może zniknąć w międzyczasie (nawigacja).
    let cancelled = false;

    async function mount() {
      // Konto najemcy w opcjach ładowania: płatność powstała NA JEGO koncie
      // (obciążenie bezpośrednie), więc przeglądarka musi ją potwierdzać
      // w tym samym kontekście. Bez tego dostawca nie znajdzie płatności.
      const stripe = await loadStripe(publishableKey, { stripeAccount: accountId });
      if (cancelled || !stripe || !mountRef.current) return;

      const elements = stripe.elements({
        clientSecret,
        // Język pól bierzemy z osi TENANTA (jak reszta storefrontu), nie
        // z przeglądarki — sklep prowadzony po polsku ma polskie pola także
        // dla klienta z angielską przeglądarką.
        locale,
      });
      const payment = elements.create("payment", { layout: "tabs" });
      payment.mount(mountRef.current);

      stripeRef.current = stripe;
      elementsRef.current = elements;
      setReady(true);
    }

    void mount().catch(() => {
      if (!cancelled) setError(copy.payment.error);
    });

    return () => {
      cancelled = true;
      elementsRef.current = null;
      stripeRef.current = null;
    };
  }, [clientSecret, publishableKey, accountId, locale, copy.payment.error]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    setError(null);

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Adres powrotu BEZ parametrów własnych: strona powrotu rozpoznaje
        // zamówienie po ciasteczku, a nie po tym, co dopisze do adresu
        // dostawca albo użytkownik.
        return_url: `${window.location.origin}/checkout/platnosc/status`,
      },
    });

    // Dotarcie tutaj oznacza, że przekierowania NIE BYŁO — czyli płatność się
    // nie powiodła (odmowa karty, błąd walidacji pól). Przy powodzeniu
    // przeglądarka jest już na stronie powrotu i ten kod się nie wykonuje.
    //
    // Świadomie NIE zaglądamy do `result.paymentIntent`: przy powodzeniu
    // niesie on `status: 'succeeded'`, a to jest dokładnie ta deklaracja,
    // której nie wolno tu użyć do żadnego twierdzenia.
    setSubmitting(false);
    setError(result.error?.message ?? copy.payment.error);
  }

  return (
    <form className="grid gap-6 lg:grid-cols-[1fr_20rem]" onSubmit={handleSubmit}>
      <div className="grid gap-4">
        {error ? (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="rounded-lg border border-border p-5">
          <div ref={mountRef} />
          {ready ? null : (
            <p className="text-sm text-muted-foreground">{copy.payment.loading}</p>
          )}
        </div>
      </div>

      <aside className="grid h-fit gap-4 rounded-lg border border-border p-5 lg:sticky lg:top-6">
        <h2 className="text-lg font-semibold">{copy.payment.summaryHeading}</h2>
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{copy.confirmation.orderNumber}</dt>
            <dd className="tabular-nums">{orderNumber}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>{copy.payment.amountDue}</dt>
            <dd>{formatMoney(amountGrosze, currency, locale)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{copy.payment.depositNote}</p>

        <Button type="submit" className="w-full" size="lg" disabled={!ready || submitting}>
          {submitting ? copy.payment.submitting : copy.payment.submit}
        </Button>
        <Link
          href="/checkout/platnosc/status"
          className="text-center text-sm underline underline-offset-4"
        >
          {copy.payment.checkStatus}
        </Link>
      </aside>
    </form>
  );
}
