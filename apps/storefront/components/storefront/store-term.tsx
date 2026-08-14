"use client";

/**
 * TERMIN NAJMU W POWŁOCE SKLEPU (faza 5, ADR-179).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Kalendarz stał WYŁĄCZNIE na stronie pojedynczego sprzętu — czyli w miejscu,
 * które mówi klientowi „wybierasz termin TEGO sprzętu". Ustawiał przy tym
 * termin CAŁEGO zamówienia (`CartState.startDate/endDate` jest wspólny, patrz
 * lib/cart/model.ts). Klient nie miał skąd tego wiedzieć: interfejs mówił co
 * innego, niż robił — ta sama klasa wady, którą zamknęły ADR-171 i ADR-172.
 *
 * Drugi skutek był sprzedażowy: żeby w ogóle podać termin, trzeba było najpierw
 * wejść w sprzęt. Klient przeglądał katalog nie wiedząc, co jest wolne.
 *
 * ==================== JEDNO ŹRÓDŁO PRAWDY (R1) ====================
 *
 * Termin dalej mieszka DOKŁADNIE w jednym miejscu — w stanie koszyka. Ten
 * komponent go czyta i zapisuje, ale nie trzyma własnej kopii „terminu
 * wyszukiwania" obok. Dwa stany o tym samym znaczeniu rozjeżdżają się w tydzień,
 * a rozjazd objawia się jako „kalendarz pokazuje lipiec, kasa liczy sierpień".
 *
 * Termin przy PUSTYM koszyku jest legalny: klient najpierw mówi „kiedy", potem
 * wybiera „co".
 *
 * ==================== POWŁOKA NIE MALUJE DOSTĘPNOŚCI (R2) ====================
 *
 * Siatka w powłoce dostaje kalendarz BEZ `dayUnits`. W powłoce nie ma kontekstu
 * sprzętu, więc „dzień zajęty" nie miałby o czym mówić — zajęty DLA CZEGO?
 * Liczba wolnych sztuk pojawia się tam, gdzie kontekst jest: na kaflu katalogu
 * i w widgecie sprzętu.
 *
 * ==================== KONFLIKT: POKAZUJEMY (R4) ====================
 *
 * Zmiana terminu przy pełnym koszyku bywa zawężeniem dostępności. Rdzeń reguły
 * stoi w `lib/cart/conflicts.ts` (czysty, testowalny bez przeglądarki); tutaj
 * jest wyłącznie transport i widok. Nic nie znika z koszyka samo — klient
 * dostaje listę i dwa wyjścia: zdjąć sprzęt albo wrócić do poprzedniego terminu.
 *
 * „Poprzedni termin" żyje w stanie TEGO komponentu, a nie w koszyku, i to jest
 * rozmyślne: to jest bufor cofnięcia, a nie drugi termin. Gdyby siedział
 * w koszyku, byłby dokładnie tym drugim źródłem prawdy, którego R1 zabrania.
 */
import {
  AVAILABILITY_WINDOW_MAX_DAYS,
  availabilityWindowEnd,
  bcp47,
  rentalDaysInclusive,
} from "@avably/core";
import {
  SiteDateRangeCalendar,
  initialSiteCalendarMonth,
  type SiteCalendarLabels,
} from "@avably/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { checkCatalogAvailability } from "@/lib/actions/availability";
import {
  cartConflicts,
  isCheckoutBlockedByConflict,
  NO_CONFLICTS,
  type CartConflictVerdict,
} from "@/lib/cart/conflicts";
import { useCart } from "@/lib/cart/use-cart";
import { format, type StorefrontCopy } from "@/lib/storefront/copy";
import type { StorefrontLocale } from "@/lib/storefront/locale";

/** Minimum, którego panel konfliktu potrzebuje, żeby nazwać pozycję po imieniu. */
export interface StoreTermProduct {
  id: string;
  name: string;
}

export interface StoreTermValue {
  startDate: string | null;
  endDate: string | null;
  /** Ustawia termin i ZAPAMIĘTUJE poprzedni jako bufor cofnięcia. */
  setTerm: (start: string | null, end: string | null) => void;
  /** Wraca do terminu sprzed ostatniej zmiany; brak bufora = brak akcji. */
  revertTerm: () => void;
  canRevert: boolean;
  verdict: CartConflictVerdict;
  checking: boolean;
  /** Zdejmuje z koszyka WSZYSTKIE pozycje w konflikcie — na jawne kliknięcie. */
  dropConflicting: () => void;
  blocked: boolean;
}

/**
 * Wartość dla tras BEZ ścieżki sprzedaży (płatność, status, dokumenty). Nie
 * `undefined`: komponent, który wywołałby hook poza providerem, ma dostać stan
 * jawny — „nie ma tu terminu" — a nie wyjątek w przeglądarce klienta.
 */
const INERT: StoreTermValue = {
  startDate: null,
  endDate: null,
  setTerm: () => {},
  revertTerm: () => {},
  canRevert: false,
  verdict: NO_CONFLICTS,
  checking: false,
  dropConflicting: () => {},
  blocked: false,
};

const StoreTermContext = createContext<StoreTermValue>(INERT);

export function useStoreTerm(): StoreTermValue {
  return useContext(StoreTermContext);
}

/** Dzisiaj jako ISO — dolna granica okna wyboru. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function StoreTermProvider({ children }: { children: ReactNode }) {
  const { cart, hydrated, setDates, setQty } = useCart();
  const [previous, setPrevious] = useState<{ start: string | null; end: string | null } | null>(
    null,
  );
  /**
   * ODPOWIEDŹ RAZEM Z PYTANIEM, NA KTÓRE ODPOWIADA.
   *
   * Werdykt nie jest samodzielnym stanem — jest odpowiedzią na konkretne
   * pytanie „czy TEN koszyk mieści się w TYM terminie". Trzymanie go bez
   * pytania kończy się nieaktualnym konfliktem na ekranie: klient zmienia
   * termin, a przez chwilę widzi werdykt dla poprzedniego, bo odpowiedź
   * jeszcze nie wróciła. Sklejenie odpowiedzi z kluczem zapytania robi ten
   * stan NIEREPREZENTOWALNYM — nieaktualna odpowiedź po prostu nie pasuje
   * do bieżącego klucza i nie zostaje pokazana.
   */
  const [answer, setAnswer] = useState<{ key: string; verdict: CartConflictVerdict } | null>(null);

  const { startDate, endDate, items } = cart;
  // Podpis pozycji, a nie sama tablica: `items` jest nową referencją przy
  // każdej migawce koszyka, więc tablica w kluczu odpytywałaby serwer w kółko.
  const itemsKey = items.map((line) => `${line.productId}:${line.quantity}`).join(",");
  const rangeReady = startDate !== null && endDate !== null && endDate >= startDate;
  /** `null` = nie ma o co pytać: pusty koszyk albo niekompletny termin. */
  const queryKey = rangeReady && itemsKey !== "" ? `${startDate}|${endDate}|${itemsKey}` : null;

  useEffect(() => {
    if (!hydrated || queryKey === null) return;
    let cancelled = false;
    void checkCatalogAvailability(startDate!, endDate!)
      .then((availability) => {
        if (!cancelled) setAnswer({ key: queryKey, verdict: cartConflicts(items, availability) });
      })
      .catch(() => {
        // Błąd transportu to „nie wiem", a nie „wszystko wolne".
        if (!cancelled) setAnswer({ key: queryKey, verdict: { conflicts: [], unknown: true } });
      });
    return () => {
      cancelled = true;
    };
    // `items`, `startDate` i `endDate` są w całości zakodowane w `queryKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, queryKey]);

  // `useMemo`, a nie goła stała: werdykt wchodzi w zależności `dropConflicting`
  // i wartości kontekstu, więc nowa referencja przy każdym renderze
  // przeliczałaby oba na każdy ruch dowolnego stanu w drzewie sklepu.
  const verdict = useMemo<CartConflictVerdict>(() => {
    if (queryKey === null) return NO_CONFLICTS;
    if (answer !== null && answer.key === queryKey) return answer.verdict;
    // Pytanie zadane, odpowiedzi jeszcze nie ma — to jest „nie wiem", a nie
    // „nie ma konfliktu". Kasa zostaje otwarta (patrz
    // isCheckoutBlockedByConflict), ale nikt nie twierdzi, że sprawdził.
    return { conflicts: [], unknown: true };
  }, [queryKey, answer]);
  const checking = queryKey !== null && (answer === null || answer.key !== queryKey);

  const setTerm = useCallback(
    (start: string | null, end: string | null) => {
      // BUFOR COFNIĘCIA ZAPAMIĘTUJE WYŁĄCZNIE TERMIN KOMPLETNY.
      //
      // Wybór zakresu to DWA kliknięcia, więc `setTerm` woła się dwa razy:
      // najpierw `{start, null}`, potem `{start, end}`. Gdyby bufor łapał
      // każdy z nich, „wróć do poprzedniego terminu" cofałoby do stanu
      // POŚREDNIEGO tej samej zmiany — czyli do połowy zakresu, którego klient
      // nigdy nie miał. Termin niekompletny nie jest terminem, do którego da
      // się wrócić; jest w połowie wpisaną wartością.
      const complete = startDate !== null && endDate !== null && endDate >= startDate;
      if (complete) setPrevious({ start: startDate, end: endDate });
      setDates(start, end);
    },
    [startDate, endDate, setDates],
  );

  const revertTerm = useCallback(() => {
    if (previous === null) return;
    setDates(previous.start, previous.end);
    setPrevious(null);
  }, [previous, setDates]);

  const dropConflicting = useCallback(() => {
    // Przez `setQty(…, 0)`, a nie przez zapis całego koszyka: mutatory koszyka
    // liczą nowy stan na ŚWIEŻYM odczycie ze storage, więc równoległa karta
    // nie zostanie nadpisana migawką sprzed sekundy.
    for (const conflict of verdict.conflicts) setQty(conflict.productId, 0);
  }, [verdict, setQty]);

  const value = useMemo<StoreTermValue>(
    () => ({
      startDate,
      endDate,
      setTerm,
      revertTerm,
      canRevert: previous !== null,
      verdict,
      checking,
      dropConflicting,
      blocked: isCheckoutBlockedByConflict(verdict),
    }),
    [startDate, endDate, setTerm, revertTerm, previous, verdict, checking, dropConflicting],
  );

  return <StoreTermContext.Provider value={value}>{children}</StoreTermContext.Provider>;
}

/** Etykiety kalendarza z copy najemcy — pakiet UI nie zna `StorefrontCopy`. */
function calendarLabels(copy: StorefrontCopy): SiteCalendarLabels {
  return {
    previousMonth: copy.term.previousMonth,
    nextMonth: copy.term.nextMonth,
    weekdays: [
      copy.term.weekdayMon,
      copy.term.weekdayTue,
      copy.term.weekdayWed,
      copy.term.weekdayThu,
      copy.term.weekdayFri,
      copy.term.weekdaySat,
      copy.term.weekdaySun,
    ],
    dayAvailable: copy.term.dayAvailable,
    dayUnavailable: copy.term.dayUnavailable,
    dayOutOfRange: copy.term.dayOutOfRange,
  };
}

/**
 * PASEK TERMINU — widoczna część powłoki. Stoi POD nagłówkiem, czyli w tym
 * samym korzeniu motywu, co reszta sklepu (K6, ADR-092): pasek poza korzeniem
 * brałby paletę panelu.
 */
export function StoreTermBar({
  copy,
  products,
  locale,
}: {
  copy: StorefrontCopy;
  products: StoreTermProduct[];
  /** Język NAJEMCY — na kod `Intl` przeliczamy go tu, raz. */
  locale: StorefrontLocale;
}) {
  const term = useStoreTerm();
  const [open, setOpen] = useState(false);
  const today = todayIso();
  const horizon = availabilityWindowEnd(today);
  const [month, setMonth] = useState(() =>
    initialSiteCalendarMonth(term.startDate, today, today, horizon),
  );

  // Otwarcie kalendarza ustawia miesiąc na termin, który klient JUŻ ma. Bez
  // tego wracający klient z terminem w lipcu otwiera siatkę na maju i musi
  // przewijać do miejsca, w którym już był.
  function openCalendar() {
    setMonth(initialSiteCalendarMonth(term.startDate, today, today, horizon));
    setOpen(true);
  }

  const byId = new Map(products.map((product) => [product.id, product.name]));
  const complete =
    term.startDate !== null && term.endDate !== null && term.endDate >= term.startDate;
  const summary = complete
    ? format(copy.term.rangeSummary, {
        start: term.startDate!,
        end: term.endDate!,
        days: rentalDaysInclusive(term.startDate!, term.endDate!),
      })
    : copy.term.noDates;

  return (
    <div className="site-rule-top" data-store-term>
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-6 py-3">
        <span className="site-label text-sm">{copy.term.heading}</span>
        <span className="site-text-muted text-sm" data-store-term-summary>
          {summary}
        </span>
        <button
          type="button"
          className="site-cta-secondary cursor-pointer px-3 py-1 text-sm font-semibold"
          aria-expanded={open}
          data-store-term-toggle
          onClick={() => (open ? setOpen(false) : openCalendar())}
        >
          {open ? copy.term.close : complete ? copy.term.change : copy.term.choose}
        </button>
        {term.checking ? (
          <span className="site-text-muted text-xs" role="status">
            {copy.term.checking}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="mx-auto w-full max-w-5xl px-6 pb-4">
          <SiteDateRangeCalendar
            month={month}
            onMonthChange={setMonth}
            start={term.startDate}
            end={term.endDate}
            onSelect={(selection) => {
              term.setTerm(selection.start, selection.end);
              // Kalendarz zamyka się dopiero po DOMKNIĘCIU zakresu — zamknięcie
              // po pierwszym kliknięciu zabierałoby drugie.
              if (selection.end !== null) setOpen(false);
            }}
            minDate={today}
            maxDate={horizon}
            labels={calendarLabels(copy)}
            locale={bcp47(locale)}
            className="max-w-sm"
          />
          <p className="site-text-muted mt-2 text-xs">
            {format(copy.term.windowNote, { days: AVAILABILITY_WINDOW_MAX_DAYS })}
          </p>
        </div>
      ) : null}

      {/*
        PANEL KONFLIKTU (R4). Pokazujemy, czego nie da się wynająć w tym
        terminie, i zostawiamy rozstrzygnięcie klientowi. `role="alert"`, bo to
        jest zmiana stanu, o której klient nie prosił — pojawia się w reakcji na
        jego zmianę terminu, ale mówi o pozycjach, na które nie patrzył.
      */}
      {term.verdict.conflicts.length > 0 ? (
        <div className="mx-auto w-full max-w-5xl px-6 pb-4">
          <div className="site-error-panel p-4 text-sm" role="alert" data-store-term-conflict>
            <p className="font-semibold">{copy.term.conflictHeading}</p>
            <ul className="mt-2 grid list-none gap-1 p-0">
              {term.verdict.conflicts.map((conflict) => (
                <li key={conflict.productId} data-store-term-conflict-item={conflict.productId}>
                  {format(copy.term.conflictLine, {
                    name: byId.get(conflict.productId) ?? conflict.productId,
                    requested: conflict.requested,
                    available: conflict.available,
                  })}
                </li>
              ))}
            </ul>
            <p className="mt-2">{copy.term.conflictBlocksCheckout}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                className="site-cta-secondary cursor-pointer px-3 py-1 text-sm font-semibold"
                data-store-term-drop
                onClick={term.dropConflicting}
              >
                {copy.term.conflictRemove}
              </button>
              {term.canRevert ? (
                <button
                  type="button"
                  className="site-cta-secondary cursor-pointer px-3 py-1 text-sm font-semibold"
                  data-store-term-revert
                  onClick={term.revertTerm}
                >
                  {copy.term.conflictRevert}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
