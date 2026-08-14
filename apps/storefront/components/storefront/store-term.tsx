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
 * ==================== JEDNO PYTANIE NA TERMIN (ADR-180) ====================
 *
 * Odpowiedź `app.get_public_catalog_availability` niesie liczby dla CAŁEGO
 * katalogu, więc odpowiada naraz na trzy pytania zadawane w trzech miejscach:
 * „co się nie mieści w koszyku" (panel konfliktu), „ile wolnych sztuk TEGO
 * sprzętu" (widget rezerwacji) i „co jest wolne" (kafle katalogu). Provider
 * pyta o nią RAZ NA TERMIN i rozdaje wszystkim trzem.
 *
 * Klucz zapytania nie niesie już podpisu koszyka i to jest zmiana ADR-180:
 * do etapu A pytanie leciało na każdą zmianę pozycji, choć odpowiedź o KATALOG
 * od koszyka nie zależy. Konflikt liczy się z tej samej odpowiedzi funkcją
 * czystą (`cartConflicts`), więc dołożenie sprzętu do koszyka nie kosztuje
 * dziś ani jednej podróży do bazy.
 *
 * Pytanie leci też przy PUSTYM koszyku — inaczej niż w etapie A. Powód jest
 * sprzedażowy: klient, który wybrał termin i przegląda katalog, ma zobaczyć na
 * kaflach, co jest wolne, ZANIM cokolwiek doda.
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
  SiteProductAvailabilityProvider,
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
import type { PublicCatalogAvailability } from "@/lib/checkout/contract";
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
  /**
   * ILE SZTUK KTÓREJ POZYCJI JEST WOLNYCH w wybranym terminie (ADR-180).
   *
   * `null` (cała mapa) znaczy „nie wiem" i ma DOKŁADNIE trzy powody: nie ma
   * terminu, odpowiedź jeszcze nie wróciła albo odczyt się nie udał. Klucz
   * NIEOBECNY w mapie znaczy to samo o jednej pozycji. Zero znaczy „nic nie
   * zostało" i jest odpowiedzią, nie brakiem odpowiedzi — dlatego te dwa stany
   * nie dzielą jednej wartości: kafel i widget rysują je inaczej, a pomylenie
   * ich albo obiecuje sprzęt, którego nie ma, albo gasi sprzedaż sprzętu,
   * który jest.
   *
   * MAPA, A NIE FUNKCJA PYTAJĄCA: ta sama wartość jedzie wprost do dostawcy
   * kontekstu kafli w pakiecie UI. Funkcja wymagałaby przy nim drugiej
   * reprezentacji tej samej wiedzy.
   */
  units: Readonly<Record<string, number>> | null;
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
  units: null,
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
   * Dostępność nie jest samodzielnym stanem — jest odpowiedzią na konkretne
   * pytanie „co jest wolne w TYM terminie". Trzymanie jej bez pytania kończy
   * się nieaktualnymi liczbami na ekranie: klient zmienia termin, a przez
   * chwilę widzi odpowiedź dla poprzedniego, bo nowa jeszcze nie wróciła.
   * Sklejenie odpowiedzi z kluczem zapytania robi ten stan NIEREPREZENTOWALNYM
   * — nieaktualna odpowiedź po prostu nie pasuje do bieżącego klucza i nie
   * zostaje pokazana.
   *
   * `availability: null` W ODPOWIEDZI jest stanem osobnym od braku odpowiedzi:
   * znaczy „baza odmówiła" (najemca poza oknem, zakres odwrócony, awaria
   * transportu) i też jest wiedzą — mianowicie wiedzą, że nie wiemy.
   */
  const [answer, setAnswer] = useState<{
    key: string;
    availability: PublicCatalogAvailability | null;
  } | null>(null);

  const { startDate, endDate, items } = cart;
  // Podpis pozycji, a nie sama tablica: `items` jest nową referencją przy
  // każdej migawce koszyka, więc tablica w zależnościach przeliczałaby werdykt
  // na każdy render dowolnego stanu w drzewie sklepu.
  const itemsKey = items.map((line) => `${line.productId}:${line.quantity}`).join(",");
  const rangeReady = startDate !== null && endDate !== null && endDate >= startDate;
  /**
   * `null` = nie ma o co pytać, czyli WYŁĄCZNIE brak kompletnego terminu.
   * Koszyk w kluczu nie siedzi (ADR-180) — patrz nagłówek pliku.
   */
  const queryKey = rangeReady ? `${startDate}|${endDate}` : null;

  useEffect(() => {
    if (!hydrated || queryKey === null) return;
    let cancelled = false;
    void checkCatalogAvailability(startDate!, endDate!)
      .then((availability) => {
        if (!cancelled) setAnswer({ key: queryKey, availability });
      })
      .catch(() => {
        // Błąd transportu to „nie wiem", a nie „wszystko wolne".
        if (!cancelled) setAnswer({ key: queryKey, availability: null });
      });
    return () => {
      cancelled = true;
    };
    // `startDate` i `endDate` są w całości zakodowane w `queryKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, queryKey]);

  /** Odpowiedź NA BIEŻĄCE pytanie albo `null` — jedno miejsce, w którym się to rozstrzyga. */
  const availability = useMemo<PublicCatalogAvailability | null>(
    () => (answer !== null && answer.key === queryKey ? answer.availability : null),
    [answer, queryKey],
  );
  const checking = queryKey !== null && (answer === null || answer.key !== queryKey);

  // `useMemo`, a nie goła stała: werdykt wchodzi w zależności `dropConflicting`
  // i wartości kontekstu, więc nowa referencja przy każdym renderze
  // przeliczałaby oba na każdy ruch dowolnego stanu w drzewie sklepu.
  const verdict = useMemo<CartConflictVerdict>(() => {
    if (queryKey === null) return NO_CONFLICTS;
    // Pytanie zadane, odpowiedzi jeszcze nie ma (albo baza odmówiła) — to jest
    // „nie wiem", a nie „nie ma konfliktu". Kasa zostaje otwarta (patrz
    // isCheckoutBlockedByConflict), ale nikt nie twierdzi, że sprawdził.
    // Rozstrzyga o tym `cartConflicts`, dla którego `null` JEST tym stanem.
    return cartConflicts(items, availability);
    // `items` przez podpis — patrz `itemsKey` wyżej.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, availability, itemsKey]);

  /**
   * Mapa `product_id → wolne sztuki` liczona RAZ na odpowiedź.
   *
   * POZYCJA NIEOBECNA W ODPOWIEDZI TO „NIE WIEM", A NIE ZERO — i to jest
   * celowo INNA odpowiedź niż w `cartConflicts`, gdzie brak pozycji liczy się
   * jako zero. Różnica bierze się z pytania: tam pytamy „czy wolno puścić do
   * kasy sprzęt, którego katalog już nie zna" (nie wolno), tutaj „co napisać
   * na kaflu" — a kafel pozycji spoza odpowiedzi ma milczeć, nie ogłaszać
   * braku.
   */
  const units = useMemo<Readonly<Record<string, number>> | null>(() => {
    if (availability === null) return null;
    const map: Record<string, number> = {};
    for (const row of availability.products) map[row.product_id] = row.available_units;
    return map;
  }, [availability]);

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
      units,
    }),
    [startDate, endDate, setTerm, revertTerm, previous, verdict, checking, dropConflicting, units],
  );

  return <StoreTermContext.Provider value={value}>{children}</StoreTermContext.Provider>;
}

/**
 * DOSTĘPNOŚĆ DLA KAFLI KATALOGU (faza 5, ADR-180) — most między terminem
 * a rendererem sekcji.
 *
 * Kafle rysuje pakiet UI, który nie zna ani koszyka, ani akcji serwera, ani
 * słownika najemcy. Ten komponent jest jedynym miejscem, w którym te trzy
 * rzeczy spotykają się z rendererem: bierze liczby z JEDNEJ odpowiedzi
 * providera i podaje je razem z etykietami.
 *
 * Stoi w powłoce, a nie w trasie katalogu, bo sekcja sprzętu rysuje się dziś na
 * KAŻDEJ stronie najemcy (strona główna, podstrona treściowa, szablon strony
 * sprzętu). Most w jednej trasie znaczyłby kafle z liczbami na stronie głównej
 * i kafle bez liczb na podstronie — bez jednego błędu w konsoli.
 */
export function StoreCatalogAvailability({
  copy,
  children,
}: {
  copy: StorefrontCopy;
  children: ReactNode;
}) {
  const { units } = useStoreTerm();
  const value = useMemo(
    () =>
      units === null
        ? null
        : { units, available: copy.term.unitsFree, unavailable: copy.term.unitsNone },
    [units, copy.term.unitsFree, copy.term.unitsNone],
  );

  return <SiteProductAvailabilityProvider value={value}>{children}</SiteProductAvailabilityProvider>;
}

/**
 * Etykiety kalendarza z copy najemcy — pakiet UI nie zna `StorefrontCopy`.
 *
 * Eksportowane, bo kalendarzy w sklepie są DWA (pasek powłoki i widget
 * rezerwacji na stronie sprzętu, ADR-180) i mają mówić tym samym językiem.
 * Druga kopia tego mapowania rozjechałaby nazwy dni tygodnia między jedną
 * siatką a drugą — w tym samym dokumencie.
 */
export function calendarLabels(copy: StorefrontCopy): SiteCalendarLabels {
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
