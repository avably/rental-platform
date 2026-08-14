"use client";

/**
 * WIDGET REZERWACJI SPRZĘTU (faza 5, ADR-180) — CZĘŚĆ TRANSAKCYJNA W CAŁOŚCI.
 *
 * ==================== ROZSTRZYGNIĘCIE WŁAŚCICIELA ====================
 *
 * Kalendarz, dostępność i koszyk zostają JEDNYM NIEROZMONTOWYWALNYM widgetem:
 * najemca może go w przyszłości przesunąć, nie może rozłożyć na części. Dlatego
 * to jest jeden komponent wołany przez TRASĘ, a nie zestaw elementów w treści
 * strony: element w treści da się skasować w kreatorze, a strona sprzętu bez
 * przycisku rezerwacji jest sklepem, w którym nie da się kupić.
 *
 * W tym etapie widget stoi w STAŁYM miejscu. Przesuwanie wymaga własnego typu
 * sekcji i jest osobną pracą — ale miejsce jest stałe DZIŚ, a nie na zawsze,
 * i nic w tym pliku tego nie przesądza.
 *
 * ==================== OBIE GAŁĘZIE TRASY, JEDEN WIDGET ====================
 *
 * Trasa sprzętu oddaje jedną z dwóch rzeczy (ADR-178): stronę wbudowaną albo
 * szablon najemcy. Widget stoi w OBU. Najemca, który opublikował szablon, nie
 * może stracić sprzedaży — a do ADR-180 tracił ją w całości: szablon był
 * powierzchnią wyłącznie prezentacyjną.
 *
 * ==================== SKĄD BIERZE LICZBY ====================
 *
 * Dwa źródła, dwa różne pytania, ani jednego zapytania w nadmiarze:
 *
 *   • ILE SZTUK WOLNYCH W WYBRANYM TERMINIE — z odpowiedzi katalogowej, którą
 *     powłoka pobiera RAZ na termin (`useStoreTerm().units`). Ta sama liczba
 *     stoi na kaflu katalogu i tutaj, bo pochodzi z tego samego wywołania;
 *     druga podróż po nią byłaby drugą wersją tej samej prawdy.
 *   • ILE SZTUK KTÓREGO DNIA — z `checkAvailabilityDays`, raz na WIDOCZNY
 *     miesiąc. Tego katalogowa nie wie i wiedzieć nie może: jej odpowiedź jest
 *     o zakresie, a siatka pyta o każdy dzień z osobna.
 *
 * ==================== TERMIN MIESZKA W KOSZYKU (R1 z ADR-179) ====================
 *
 * Widget nie trzyma własnego terminu. Klika się w jego kalendarz, a zapisuje to
 * do stanu koszyka przez `useStoreTerm().setTerm` — dokładnie tam, gdzie pisze
 * pasek terminu w powłoce. Dwa stany o tym samym znaczeniu rozjeżdżają się
 * w tydzień, a rozjazd wygląda jak „kalendarz pokazuje lipiec, kasa liczy
 * sierpień". Do ADR-180 strona sprzętu miała własną parę pól daty obok paska
 * powłoki — czyli dokładnie ten rozjazd, tylko widoczny gołym okiem.
 *
 * WYGLĄD Z MOTYWU NAJEMCY (K6, ADR-092): widget nosi role (`site-*`), nigdy
 * kolory, i składa się ze ZWYKŁYCH elementów HTML — komponenty `@avably/ui`
 * z pasa panelu wniosłyby własne tokeny, których skan źródeł by nie zobaczył.
 */
import {
  availabilityWindowEnd,
  bcp47,
  calculatePrice,
  formatMoney,
  type CurrencyCode,
  type PriceParams,
} from "@avably/core";
import {
  SiteDateRangeCalendar,
  initialSiteCalendarMonth,
  siteCalendarMonthDays,
} from "@avably/ui";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { calendarLabels, useStoreTerm } from "@/components/storefront/store-term";
import { checkAvailabilityDays } from "@/lib/actions/availability";
import { MAX_QUANTITY_PER_PRODUCT } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import { format, type StorefrontCopy } from "@/lib/storefront/copy";
import type { StorefrontLocale } from "@/lib/storefront/locale";

/** Dzisiaj jako ISO — dolna granica okna wyboru. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Okno zapytania o dni WIDOCZNEGO miesiąca, przycięte do okna wyboru.
 *
 * Przycięcie nie jest kosmetyką: baza odmawia okna szerszego niż sufit i nie
 * ma po co pytać o dni, których siatka i tak nie pozwoli wybrać. `null` znaczy
 * „ten miesiąc leży w całości poza oknem" — nawigacja kalendarza do niego nie
 * dopuszcza, ale stan początkowy przychodzi z zewnątrz.
 */
export function bookingMonthWindow(
  month: string,
  minDate: string,
  maxDate: string,
): { from: string; to: string } | null {
  const days = siteCalendarMonthDays(month);
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) return null;

  const from = first < minDate ? minDate : first;
  const to = last > maxDate ? maxDate : last;
  return from > to ? null : { from, to };
}

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
  /** Język NAJEMCY (oś tenancka) — na BCP-47 przeliczany tu, raz. */
  locale: StorefrontLocale;
  currency: CurrencyCode;
}) {
  const term = useStoreTerm();
  const { add } = useCart();

  const today = todayIso();
  const horizon = availabilityWindowEnd(today);
  const [month, setMonth] = useState(() =>
    initialSiteCalendarMonth(term.startDate, today, today, horizon),
  );
  /**
   * SIATKA WRACA NA TERMIN, KTÓRY KLIENT JUŻ MA.
   *
   * Koszyk jest znany dopiero PO hydratacji, więc pierwszy render zna termin
   * `null` i ustawia miesiąc na bieżący. Wracający klient z terminem w lipcu
   * zobaczyłby więc maj i musiał przewijać do miejsca, w którym już był — ta
   * sama wada, którą pasek powłoki rozwiązuje re-kotwiczeniem przy otwarciu
   * (widget jest otwarty zawsze, więc kotwicą jest sama ZMIANA terminu).
   *
   * Poprawka stanu W RENDERZE, a nie w efekcie: efekt przemalowałby siatkę po
   * pierwszym pokazaniu jej na złym miesiącu. Nawigacji klienta to nie rusza —
   * przewinięcie miesiąca nie zmienia terminu, więc nie przechodzi tym warunkiem.
   */
  const [anchor, setAnchor] = useState(term.startDate);
  if (anchor !== term.startDate) {
    setAnchor(term.startDate);
    setMonth(initialSiteCalendarMonth(term.startDate, today, today, horizon));
  }
  /**
   * ODPOWIEDŹ RAZEM Z MIESIĄCEM, KTÓREGO DOTYCZY — ten sam idiom, co przy
   * dostępności terminu w powłoce. Bez klucza siatka czerwca przez chwilę
   * malowałaby liczby maja, czyli pokazywałaby dowód, którego nie ma.
   */
  const [days, setDays] = useState<{ month: string; units: Record<string, number> } | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const window = bookingMonthWindow(month, today, horizon);
    if (window === null) return;
    let cancelled = false;
    void checkAvailabilityDays(productId, window.from, window.to)
      .then((answer) => {
        // Odmowa bazy to „nie wiem o tym miesiącu": siatka zostaje bez liczb,
        // a nie zamalowana na zajęte. Zamalowana kasowałaby sprzedaż za awarię.
        if (!cancelled && answer !== null) setDays({ month, units: answer.days });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productId, month, today, horizon]);

  const complete =
    term.startDate !== null && term.endDate !== null && term.endDate >= term.startDate;
  /** `undefined` = nie wiem (brak terminu, odpowiedź w drodze, odmowa bazy). */
  const units = complete ? term.units?.[productId] : undefined;

  const maxQuantity = Math.min(units ?? MAX_QUANTITY_PER_PRODUCT, MAX_QUANTITY_PER_PRODUCT);
  /*
    DODANIE JEST MOŻLIWE TAKŻE PRZY „NIE WIEM" — i to jest ta sama decyzja, co
    przy bramce kasy w ADR-179: nieudany odczyt dostępności nie może zabierać
    najemcy sprzedaży, bo WIĄŻĄCA bramka i tak stoi na serwerze (przypisanie
    egzemplarza pod advisory lockiem w `app.public_checkout`). Gaśnie wyłącznie
    to, co WIEMY, że jest niemożliwe: termin niekompletny i zero wolnych sztuk.
    Na czas samego sprawdzania przycisk też gaśnie — odpowiedź jest o sekundę,
    a przycisk czynny w trakcie zachęca do kliknięcia w ciemno.
  */
  const canAdd = complete && !term.checking && units !== 0;

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
    // Termin jest JUŻ w koszyku — pisze go kalendarz przez `setTerm`. Drugi
    // zapis tutaj byłby miejscem, w którym widget mógłby zapisać COŚ INNEGO.
    add(productId, quantity);
    setAdded(true);
  }

  return (
    <section className="site-card p-4" data-product-booking={productId}>
      <h2 className="site-label text-base">{copy.term.bookingHeading}</h2>

      <div className="mt-3 grid gap-5 @min-[40rem]/site:grid-cols-[auto_1fr]">
        <SiteDateRangeCalendar
          month={month}
          onMonthChange={setMonth}
          start={term.startDate}
          end={term.endDate}
          onSelect={(selection) => {
            term.setTerm(selection.start, selection.end);
            setAdded(false);
            setQuantity(1);
          }}
          minDate={today}
          maxDate={horizon}
          /*
            LICZBY TYLKO DLA MIESIĄCA, KTÓREGO DOTYCZY ODPOWIEDŹ. `null` znaczy
            dla siatki „nie wiem" — dni zostają wybieralne, bez liczby pod datą.
          */
          dayUnits={days !== null && days.month === month ? days.units : null}
          labels={calendarLabels(copy)}
          locale={bcp47(locale)}
          className="max-w-sm"
        />

        <div className="flex flex-col gap-3">
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
        </div>
      </div>
    </section>
  );
}
