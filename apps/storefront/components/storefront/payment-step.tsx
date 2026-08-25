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
 * [F1/ADR-137] METODY ASYNCHRONICZNE NIC TU NIE ZMIENIAJĄ — i to jest
 * własność tej architektury, nie przypadek. Element płatności dostawcy sam
 * rysuje zakładki metod (karta/BLIK/P24 — lista ze zdolności i konfiguracji
 * KONTA NAJEMCY, nie z naszego kodu), sam zbiera kod BLIK i sam prowadzi
 * przekierowanie P24; wszystkie trzy drogi kończą się na `return_url`,
 * gdzie strona statusu mówi „sprawdzamy", dopóki webhook nie napisze
 * `paid` z ODCZYTU. Ścieżka po `await` poniżej pozostaje ścieżką WYŁĄCZNIE
 * błędu dla każdej metody.
 *
 * WŁASNE WIĄZANIE ZAMIAST OFICJALNEJ OWIJKI REACTOWEJ: potrzebujemy dwóch
 * rzeczy — załadować bibliotekę dostawcy i zamontować jeden element. Owijka
 * przyniosłaby własny cykl życia i drugą zależność sprzężoną z wersją Reacta,
 * a to jest ~40 linii `useEffect`. Ta sama decyzja co przy koderze formularza
 * w porcie (piszemy swoje zamiast ciągnąć SDK).
 *
 * WYGLĄD Z MOTYWU NAJEMCY (K6, ADR-092): powłoka kroku płatności nosi role
 * (`site-card`, `site-cta`, `site-error-panel`), nie kolory panelu. WYJĄTKIEM
 * jest samo pole karty — rysuje je RAMKA DOSTAWCY w cudzej domenie i stylujemy
 * ją wyłącznie przez API dostawcy, nie naszym arkuszem (tak samo jak widget
 * antybotowy w kasie).
 */
import { useEffect, useRef, useState } from "react";

import { formatMoney, type CurrencyCode } from "@avably/core";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import Link from "next/link";

import { SITE_HEADING } from "@/components/storefront/store-chrome";
import { SummaryList } from "@/components/storefront/summary-list";
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
      <div className="site-card p-6" role="status">
        <h2 className={`text-xl tracking-tight ${SITE_HEADING}`}>{copy.payment.offlineTitle}</h2>
        <p className="site-text-muted mt-3 leading-7">{message}</p>
        <p className="mt-4 text-sm">
          {copy.confirmation.orderNumber}:{" "}
          <strong className="site-numeric">{orderNumber}</strong>
        </p>
        <Link
          href="/checkout/platnosc/status"
          className="site-link mt-6 inline-block font-medium"
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
    // Tory siatek `minmax(0,1fr)` + kolumna 22 rem — ta sama geometria i ta
    // sama naprawa S-15, co w checkout-form.tsx (tor nie dziedziczy szerokości
    // po najszerszym dziecku; wiersze kwot przez SummaryList).
    <form
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start"
      onSubmit={handleSubmit}
    >
      <div className="grid grid-cols-1 gap-4">
        {error ? (
          <div
            className="site-error-panel p-4 text-sm"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="site-card p-5">
          <div ref={mountRef} />
          {ready ? null : <p className="site-text-muted text-sm">{copy.payment.loading}</p>}
        </div>
      </div>

      <aside className="site-card grid h-fit grid-cols-1 gap-4 p-5 lg:sticky lg:top-24">
        <h2 className={`text-[17px] ${SITE_HEADING}`}>{copy.payment.summaryHeading}</h2>
        <SummaryList
          rows={[{ label: copy.confirmation.orderNumber, value: orderNumber }]}
          total={{
            label: copy.payment.amountDue,
            value: formatMoney(amountGrosze, currency, locale),
          }}
        />
        <p className="site-text-muted text-[13px]">{copy.payment.depositNote}</p>

        <button
          type="submit"
          className="site-cta w-full cursor-pointer text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!ready || submitting}
        >
          {submitting ? copy.payment.submitting : copy.payment.submit}
        </button>
        <Link href="/checkout/platnosc/status" className="site-link text-center text-sm">
          {copy.payment.checkStatus}
        </Link>
      </aside>
    </form>
  );
}
