"use client";

/**
 * WIDGET REZERWACJI SPRZĘTU (faza 5, ADR-180; forma zwarta od ADR-194) —
 * CZĘŚĆ TRANSAKCYJNA W CAŁOŚCI.
 *
 * ==================== ROZSTRZYGNIĘCIE WŁAŚCICIELA ====================
 *
 * Kalendarz, dostępność i koszyk zostają JEDNYM NIEROZMONTOWYWALNYM widgetem:
 * najemca może go w przyszłości przesunąć, nie może rozłożyć na części. Dlatego
 * to jest jeden komponent wołany przez TRASĘ, a nie zestaw elementów w treści
 * strony: element w treści da się skasować w kreatorze, a strona sprzętu bez
 * przycisku rezerwacji jest sklepem, w którym nie da się kupić.
 *
 * ==================== FORMA ZWARTA (ADR-194) ====================
 *
 * Do ADR-194 widget renderował ZAWSZE ROZWINIĘTĄ siatkę miesiąca — zjadała pół
 * pierwszego ekranu i spychała opis oraz specyfikację pod zwijkę. Wzorzec
 * właściciela (strona sprzętu jego wypożyczalni starkit.pl) jest kartą:
 * nagłówek „Zarezerwuj termin", podtytuł, POLE pokazujące wybrany zakres albo
 * zachętę do wyboru — a siatka dat otwiera się dopiero po kliknięciu pola,
 * w oknie modalnym (`StoreTermModal`), wspólnym z pigułką paska powłoki.
 *
 * Etykiety minimum najmu TU NIE MA, bo produkt nie ma dziś pola minimum —
 * fraza pojawi się razem z polem, nie wcześniej (ADR-194: żadnych stałych
 * napisów o regule, której system nie ma).
 *
 * ==================== SKĄD BIERZE LICZBY ====================
 *
 * Dwa źródła, dwa różne pytania, ani jednego zapytania w nadmiarze:
 *
 *   • ILE SZTUK WOLNYCH W WYBRANYM TERMINIE — z odpowiedzi katalogowej, którą
 *     powłoka pobiera RAZ na termin (`useStoreTerm().units`). Ta sama liczba
 *     stoi na kaflu katalogu i tutaj, bo pochodzi z tego samego wywołania;
 *     druga podróż po nią byłaby drugą wersją tej samej prawdy.
 *   • ILE SZTUK KTÓREGO DNIA — pyta OKNO wyboru (`StoreTermModal`
 *     z `productId`), raz na widoczną parę miesięcy i tylko póki jest otwarte.
 *     Karta zwinięta nie pyta o nic, o czym nie mówi.
 *
 * ==================== TERMIN MIESZKA W KOSZYKU (R1 z ADR-179) ====================
 *
 * Widget nie trzyma własnego terminu ani go nie zapisuje. Pole pokazuje termin
 * z `useStoreTerm()`, a JEDYNYM miejscem zapisu jest przycisk „Zastosuj"
 * w oknie wyboru (ADR-194) — tym samym, do którego prowadzi pigułka paska.
 * Dwa stany o tym samym znaczeniu rozjeżdżają się w tydzień, a rozjazd wygląda
 * jak „kalendarz pokazuje lipiec, kasa liczy sierpień".
 *
 * WYGLĄD Z MOTYWU NAJEMCY (K6, ADR-092): widget nosi role (`site-*`), nigdy
 * kolory, i składa się ze ZWYKŁYCH elementów HTML — komponenty `@avably/ui`
 * z pasa panelu wniosłyby własne tokeny, których skan źródeł by nie zobaczył.
 */
import {
  calculatePrice,
  formatMoney,
  formatRentalRange,
  type CurrencyCode,
  type PriceParams,
} from "@avably/core";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useStoreTerm } from "@/components/storefront/store-term";
import { StoreTermModal } from "@/components/storefront/store-term-modal";
import { productBenefits } from "@/lib/catalog/product-benefits";
import { MAX_QUANTITY_PER_PRODUCT } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import { format, type StorefrontCopy } from "@/lib/storefront/copy";
import type { StorefrontLocale } from "@/lib/storefront/locale";

/**
 * Okno zapytania o dni — definicja mieszka od ADR-194 przy oknie wyboru,
 * bo to ono pyta o dni. Re-eksport zostaje: to jest arytmetyka rezerwacji,
 * a jej dotychczasowi importerzy nie mają powodu wiedzieć o przeprowadzce.
 */
export { bookingMonthWindow } from "@/components/storefront/store-term-modal";

export function ProductBooking({
  productId,
  priceParams,
  copy,
  locale,
  currency,
}: {
  productId: string;
  /** Parametry wyceny pozycji — podgląd kwoty liczy się bez podróży do bazy. */
  priceParams: PriceParams;
  copy: StorefrontCopy;
  /** Język NAJEMCY (oś tenancka) — na BCP-47 przelicza okno wyboru. */
  locale: StorefrontLocale;
  currency: CurrencyCode;
}) {
  const term = useStoreTerm();
  const { cart, add } = useCart();

  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const complete =
    term.startDate !== null && term.endDate !== null && term.endDate >= term.startDate;

  /**
   * ZMIANA TERMINU ZERUJE POTWIERDZENIE I ILOŚĆ — w renderze, nie w efekcie
   * (efekt pokazałby na jedną klatkę „dodano" przy terminie, przy którym nikt
   * nie dodawał). Termin przychodzi z koszyka, czyli spoza drzewa: zapisuje go
   * okno wyboru, pasek powłoki albo druga karta.
   */
  const termKey = `${term.startDate}|${term.endDate}`;
  const [seenTerm, setSeenTerm] = useState(termKey);
  if (seenTerm !== termKey) {
    setSeenTerm(termKey);
    setQuantity(1);
    setAdded(false);
  }

  /** `undefined` = nie wiem (brak terminu, odpowiedź w drodze, odmowa bazy). */
  const units = complete ? term.units?.[productId] : undefined;

  /*
    ILE TEJ POZYCJI JUŻ LEŻY W KOSZYKU (S-51 audytu 2026-08-25).

    Do tej poprawki karta oferowała PEŁNĄ dostępność niezależnie od koszyka:
    przy trzech wolnych sztukach klient mógł dodać trzy, wrócić i dodać kolejne
    trzy — a prawda wychodziła dopiero w koszyku, banerem naprawczym nad
    gotowym zamówieniem. Sufit liczy się więc od WOLNYCH MINUS JUŻ WZIĘTE:
    naprawa w miejscu, w którym powstaje błąd, a nie po fakcie.

    Koszyk jest jeden na cały sklep i trzyma jeden termin (R1, ADR-179), więc
    „już wzięte" nie ma jak dotyczyć innego okna niż to, o które właśnie pytamy.
  */
  const inCart = cart.items.find((line) => line.productId === productId)?.quantity ?? 0;

  /*
    SUFIT ILOŚCI. Przy „nie wiem" (brak odpowiedzi o dostępność) zostaje limit
    modelu — patrz decyzja o `canAdd` niżej. Przy znanej liczbie wolnych sztuk
    sufit schodzi o to, co już leży w koszyku, i nigdy nie schodzi poniżej zera.
  */
  const remaining = units === undefined ? MAX_QUANTITY_PER_PRODUCT : Math.max(0, units - inCart);
  const maxQuantity = Math.max(1, Math.min(remaining, MAX_QUANTITY_PER_PRODUCT));

  /** Cała dostępność jest już w koszyku — pozycja istnieje, ale nie ma czego dobrać. */
  const exhaustedByCart = units !== undefined && units > 0 && remaining === 0;
  /*
    DODANIE JEST MOŻLIWE TAKŻE PRZY „NIE WIEM" — i to jest ta sama decyzja, co
    przy bramce kasy w ADR-179: nieudany odczyt dostępności nie może zabierać
    najemcy sprzedaży, bo WIĄŻĄCA bramka i tak stoi na serwerze (przypisanie
    egzemplarza pod advisory lockiem w `app.public_checkout`). Gaśnie wyłącznie
    to, co WIEMY, że jest niemożliwe: termin niekompletny, zero wolnych sztuk
    i komplet wolnych sztuk JUŻ w koszyku (S-51). Na czas samego sprawdzania
    przycisk też gaśnie — odpowiedź jest o sekundę, a przycisk czynny w trakcie
    zachęca do kliknięcia w ciemno.
  */
  const canAdd = complete && !term.checking && units !== 0 && !exhaustedByCart;

  /*
    KORZYŚCI Z DANYCH POZYCJI (benchmark pkt 5). Liczone z `priceParams`, czyli
    z tego samego obiektu, z którego liczy się podgląd kwoty — nie ma tu ani
    jednego odczytu w nadmiarze i ani jednego napisu spoza danych najemcy.
  */
  const benefits = useMemo(
    () => productBenefits({ priceParams, copy, currency, locale }),
    [priceParams, copy, currency, locale],
  );

  const preview = useMemo(() => {
    if (!complete) return null;
    const price = calculatePrice(term.startDate!, term.endDate!, priceParams);
    return {
      rental: price.rentalGrosze * quantity,
      deposit: price.depositGrosze * quantity,
    };
  }, [complete, term.startDate, term.endDate, priceParams, quantity]);

  function onAdd() {
    if (!canAdd) return;
    /*
      CLAMP PRZY DODAWANIU (S-51), a nie tylko na polu ilości. Pole można
      ominąć: strzałki klawiatury, wklejenie wartości, druga karta, która
      dołożyła sztuki do koszyka po ostatnim renderze tej. Liczba, która
      NAPRAWDĘ trafia do koszyka, przechodzi więc przez sufit jeszcze raz,
      w chwili kliknięcia — bo to jest jedyny moment, w którym coś się zmienia.
    */
    const requested = Math.max(1, Math.min(quantity, maxQuantity));
    // Termin jest JUŻ w koszyku — zapisało go okno wyboru („Zastosuj"). Drugi
    // zapis tutaj byłby miejscem, w którym widget mógłby zapisać COŚ INNEGO.
    add(productId, requested);
    setAdded(true);
  }

  return (
    <section className="site-card p-4" data-product-booking={productId}>
      <h2 className="site-label text-base">{copy.term.bookingHeading}</h2>
      <p className="site-text-muted mt-1 text-sm">{copy.term.bookingSubtitle}</p>

      <div className="mt-4 grid gap-1">
        <span className="site-text-muted text-xs font-semibold uppercase tracking-wide">
          {copy.term.fieldLabel}
        </span>
        {/*
          POLE TERMINU — wejście do okna wyboru (ADR-194). Przycisk w roli pola
          (`site-field`), bo systemowy input daty nie umie zakresu, a wpisywanie
          z klawiatury i tak kończyłoby się w tym samym oknie. Bez terminu niesie
          zachętę, z terminem — wybrany zakres; oba stany czyta ta sama bramka.
        */}
        <button
          type="button"
          data-product-booking-field
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="site-field flex h-auto w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 shrink-0 opacity-70"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          {complete ? (
            /*
              TERMIN PO LUDZKU (F8): „26–28 sie 2026 · 3 dni" tym SAMYM
              formatterem, którym mówi pasek powłoki, koszyk i kasa. Do F8 stało
              tu ISO z szablonu copy („2026-08-26 → 2026-08-28"), czyli klient
              czytał w widgecie rezerwacji inny zapis daty niż dwa kliknięcia
              dalej w koszyku.
            */
            <span>{formatRentalRange(term.startDate!, term.endDate!, locale)}</span>
          ) : (
            <span className="site-text-muted">{copy.term.fieldPrompt}</span>
          )}
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <p className="min-h-6 text-sm" role="status" aria-live="polite">
          {!complete ? (
            <span className="site-text-muted">{copy.product.dateRequired}</span>
          ) : term.checking ? (
            <span className="site-text-muted">{copy.term.checking}</span>
          ) : units === undefined ? (
            <span className="site-text-muted">{copy.term.bookingUnknown}</span>
          ) : units === 0 ? (
            <span className="site-error" data-product-booking-units="0">
              {copy.product.unavailable}
            </span>
          ) : exhaustedByCart ? (
            /*
              CAŁA DOSTĘPNOŚĆ JUŻ W KOSZYKU (S-51). Komunikat mówi OBIE liczby
              — ile klient ma i z ilu — bo bez nich „nie możesz dodać" wygląda
              jak awaria sklepu, a nie jak stan jego własnego koszyka.
            */
            <span data-product-booking-in-cart={inCart}>
              {format(copy.product.cartAlready, { inCart, available: units })}
            </span>
          ) : (
            <span data-product-booking-units={units}>
              {format(copy.term.unitsFree, { units })}
            </span>
          )}
        </p>

        <div className="grid gap-1">
          <label htmlFor="booking-qty" className="site-label text-sm">
            {copy.product.quantity}
          </label>
          <input
            id="booking-qty"
            type="number"
            min={1}
            max={maxQuantity}
            value={quantity}
            disabled={!canAdd}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              if (Number.isNaN(parsed)) return setQuantity(1);
              setQuantity(Math.min(Math.max(1, parsed), maxQuantity));
            }}
            className="site-field h-9 w-24 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {preview ? (
          <p className="site-text-muted text-sm">
            {copy.checkout.summaryRental}: {formatMoney(preview.rental, currency, locale)} ·{" "}
            {copy.checkout.summaryDeposit}: {formatMoney(preview.deposit, currency, locale)}
          </p>
        ) : null}
        <p className="site-text-muted text-xs">{copy.common.estimateNote}</p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="site-cta cursor-pointer text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            data-product-booking-add
            disabled={!canAdd}
            onClick={onAdd}
          >
            {copy.product.addToCart}
          </button>
          {added ? (
            <span className="site-text-muted inline-flex items-center gap-2 text-sm">
              {copy.product.added} ·{" "}
              <Link href="/cart" className="site-link font-medium">
                {copy.product.goToCart}
              </Link>
            </span>
          ) : null}
        </div>

        {/*
          LISTA KORZYŚCI POD CTA (spec 2026-08-25, benchmark pkt 5). Stoi POD
          przyciskiem, nie nad nim: to nie jest zachęta do kliknięcia, tylko
          odpowiedź na „co właściwie biorę", której klient szuka już po decyzji.
          Pozycje wyłącznie z danych pozycji katalogu — patrz `productBenefits`;
          sprzęt bez kaucji i bez progów nie dostaje tu NICZEGO.
        */}
        {benefits.length > 0 ? (
          <ul
            data-product-benefits={benefits.length}
            aria-label={copy.product.benefitsLabel}
            className="site-rule-top m-0 flex list-none flex-col gap-1.5 p-0 pt-3 text-sm"
          >
            {benefits.map((benefit) => (
              <li key={benefit.kind} data-product-benefit={benefit.kind} className="flex gap-2">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--site-accent)]"
                >
                  <path d="M4 10.5 8 14.5 16 6" />
                </svg>
                <span>{benefit.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/*
        OKNO WYBORU — z kontekstem sprzętu: siatka niesie liczbę wolnych sztuk
        per dzień i odmawia dniom z zerem (ADR-179/194). Montowane wyłącznie na
        czas otwarcia, więc SSR strony sprzętu nie niesie ani jednego dnia.
      */}
      {open ? (
        <StoreTermModal
          copy={copy}
          locale={locale}
          productId={productId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
