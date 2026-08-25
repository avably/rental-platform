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
import { formatRentalRangeParts } from "@avably/core";
import {
  cn,
  SITE_CONTAINER,
  SiteProductAvailabilityProvider,
  StoreGlyph,
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

import { StoreTermModal } from "@/components/storefront/store-term-modal";
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

/**
 * OTWARTOŚĆ OKNA WYBORU — stan WYZWALACZY, nie mechaniki (aneks ADR-194).
 *
 * Pigułka terminu ma od aneksu DWA wystąpienia w dokumencie: w belce menu
 * (desktop, slot `center` nagłówka) i w wierszu pod belką (mobile) — media
 * query pokazuje dokładnie jedno. Okno wyboru jest przy tym JEDNO, więc stan
 * „otwarte" nie może mieszkać w żadnej z pigułek; mieszka w prowiderze.
 *
 * OSOBNY kontekst, a nie pole w `StoreTermValue`: wartość terminu to kontrakt
 * MECHANIKI (czytają ją kasa, koszyk i kafle), a otwartość okna jest sprawą
 * wyzwalaczy — dopisanie jej do kontraktu przeliczałoby konsumentów mechaniki
 * na każde otwarcie okna i mieszałoby dwa znaczenia w jednej wartości.
 * Domyślna wartość jest bezczynna z tego samego powodu, co `INERT` wyżej.
 */
const StoreTermModalContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function StoreTermProvider({ children }: { children: ReactNode }) {
  const { cart, hydrated, setDates, setQty } = useCart();
  const [previous, setPrevious] = useState<{ start: string | null; end: string | null } | null>(
    null,
  );
  /** Okno wyboru terminu — wspólne dla obu wystąpień pigułki (aneks ADR-194). */
  const [modalOpen, setModalOpen] = useState(false);
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

  const modal = useMemo(() => ({ open: modalOpen, setOpen: setModalOpen }), [modalOpen]);

  return (
    <StoreTermContext.Provider value={value}>
      <StoreTermModalContext.Provider value={modal}>{children}</StoreTermModalContext.Provider>
    </StoreTermContext.Provider>
  );
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
  locale,
  children,
}: {
  copy: StorefrontCopy;
  /** Język NAJEMCY — rozstrzyga formę liczebnika na chipie niedoboru (F11). */
  locale: StorefrontLocale;
  children: ReactNode;
}) {
  const { units } = useStoreTerm();
  const value = useMemo(
    () =>
      units === null
        ? null
        : {
            units,
            // Trzy stany badge'a kafla (ADR-245): „Dostępny" / „Zostały N szt." /
            // „Zajęty w tym terminie". Widget rezerwacji (product-booking) niesie
            // dalej gołą liczbę (`unitsFree`) — inny kontekst, inne pytanie.
            available: copy.term.statusAvailable,
            /*
             * TRZY FORMY LICZEBNIKA (F11). Chip mówił „Zostały 1 szt." — jedna
             * forma wystarcza po angielsku i nie wystarcza po polsku. Wybór
             * formy robi `pluralFormOf` w kaflu (tam jest liczba), a tu jedzie
             * komplet szablonów i język najemcy.
             */
            low: {
              one: copy.term.statusLowOne,
              few: copy.term.statusLowFew,
              many: copy.term.statusLowMany,
            },
            unavailable: copy.term.statusBusy,
            locale,
          },
    [
      units,
      locale,
      copy.term.statusAvailable,
      copy.term.statusLowOne,
      copy.term.statusLowFew,
      copy.term.statusLowMany,
      copy.term.statusBusy,
    ],
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
    // Legenda licznika dostępności (S-22) — kalendarz rysuje ją tylko wtedy,
    // gdy dostał `dayUnits`, więc powłoka bez liczników nie zobaczy jej nigdy.
    unitsLegend: copy.term.unitsLegend,
  };
}

/**
 * PIGUŁKA TERMINU — JEDYNY TEKST BELKI IKONOWEJ (F7b; forma z ADR-194).
 *
 * DWA STANY, JEDEN STAN KOSZYKA: bez terminu pigułka niesie zachętę („Wybierz
 * termin"), z terminem — wybrany zakres. Nie jest to nowy stan, tylko nowy
 * WIDOK `CartState.startDate/endDate`; SSR maluje stan „bez terminu", bo
 * koszyk mieszka w `localStorage` i serwer go nie zna — hydratacja podmienia
 * treść pigułki, nie jej obecność. Klik (w dowolnym stanie) otwiera to samo
 * okno wyboru, do którego prowadzi pole na stronie sprzętu — BEZ dostępności,
 * bo w powłoce nie ma produktu bieżącego (R2 z ADR-179).
 *
 * ==================== JEDNO WYSTĄPIENIE (F7b) ====================
 *
 * Aneks ADR-194 dał pigułce dwa wystąpienia: w belce od 48 rem kontenera
 * i w wierszu POD belką poniżej progu. F7b znosi ten podział — belka ikonowa
 * mieści pigułkę na każdej szerokości, bo obok niej stoją trzy kwadraty 44 px,
 * a nie pełne pole wyszukiwania. Wystąpienie jest jedno, progów nie ma żadnych,
 * więc nie ma też pasa szerokości, w którym pigułka mogłaby się zdublować.
 *
 * ==================== „NIE ZA SZEROKA" (dyspozycja właściciela) ====================
 *
 * Trzy rzeczy trzymają szerokość: WARIANT KRÓTKI frazy (bez roku bieżącego —
 * `formatRentalRange({ short: true })`), PRIORYTET TREŚCI przy braku miejsca
 * (F12, niżej) i BRAK dopisku „· Zmień" — do F7b pigułka z terminem niosła go
 * obok zakresu, czyli najdłuższy napis belki był instrukcją, a nie treścią.
 * Afordancję zmiany niesie sama pigułka: jest przyciskiem otwierającym okno
 * wyboru (`aria-haspopup="dialog"`).
 *
 * ==================== PRIORYTET TREŚCI, NIE WIELOKROPEK (F12) ====================
 *
 * Do F12 szerokość trzymał `max-w` z `truncate`. Właściciel zobaczył skutek na
 * własnym telefonie: „23.09–25.09 · …" — pigułka dobiła do sufitu i wielokropek
 * zjadł treść W ŚRODKU INFORMACJI, a przy tym zajęła większą część belki niż
 * znak firmy. Wielokropek na frazie terminu jest wadą innego rodzaju niż na
 * nazwie sklepu: nazwę ściętą klient rozpozna po pierwszych literach, a datę
 * ściętą po prostu przestaje znać — i nie ma jak się dowiedzieć, że przestał.
 *
 * Od F12 pigułka nie ścina niczego. Przy ciasnym pasie ZDEJMUJE człony
 * w kolejności rosnącego znaczenia, regułą kontenerową (nie pomiarem tekstu
 * w JS — ten wymagałby drugiego renderu i rozjeżdżałby się z SSR):
 *
 *   1. poniżej 34 rem kontenera znika „· N dni" — długość najmu klient zna,
 *      bo sam ją przed chwilą wybrał, a w koszyku i kasie stoi ona w formie
 *      pełnej (te powierzchnie zostają przy `formatRentalRange`);
 *   2. poniżej 28 rem znika ZNAK KALENDARZA — na telefonie jest ozdobą pojęcia,
 *      które napis obok nazywa wprost;
 *   3. ZAKRES nie znika nigdy i nigdy się nie ścina (`whitespace-nowrap` bez
 *      `truncate`, bez `max-w`) — to jest treść, po którą klient patrzy.
 *
 * Człony przychodzą z rdzenia OSOBNO (`formatRentalRangeParts`), a nie z cięcia
 * gotowej frazy w komponencie: separator „·" ma jedno miejsce definicji, więc
 * belka i koszyk nie mogą powiedzieć tego samego dwiema składniami.
 *
 * PAS ODDANY ZNAKOWI FIRMY. Zdjęcie sufitu nie rozpycha belki — pigułka zwężyła
 * się z 9 rem (144 px, sufit F7b, do którego fraza dobijała ZAWSZE) do
 * szerokości własnej treści; przy oknie 390 px to ~76–84 px zamiast 144.
 * Odzyskane ~60 px idą w całości do znaku firmy, bo to on jest jedynym
 * elastycznym elementem wiersza (patrz `StoreShellHeader`) — i to jest
 * odpowiedź na drugą uwagę właściciela („logo małe").
 */
export function StoreTermPill({
  copy,
  locale = "pl",
}: {
  copy: StorefrontCopy;
  /**
   * Język NAJEMCY — do frazy terminu (`formatRentalRange`, F8/S-10: „26–28
   * sie · 3 dni" zamiast ISO). Opcjonalny z domyślnym rynkiem startowym,
   * żeby nie łamać istniejących wywołań; powłoka podaje locale jawnie.
   */
  locale?: StorefrontLocale;
}) {
  const term = useStoreTerm();
  const { open, setOpen } = useContext(StoreTermModalContext);

  const complete =
    term.startDate !== null && term.endDate !== null && term.endDate >= term.startDate;
  /*
    CZŁONY OSOBNO (F12), bo pigułka zdejmuje je pojedynczo — patrz nagłówek
    komponentu. Fraza jest ATOMOWA (NBSP w środku tokenów), więc data nie łamie
    się w środku na wąskiej pigułce (audyt S-10: „2026-08-/28"), a miesiąc jest
    SŁOWNY w każdym silniku (F12: Safari składał „23.09–25.09"). Wariant KRÓTKI
    (F7b) zdejmuje rok bieżący; rok z przyszłości zostaje, bo bez niego byłaby
    to inna data.
  */
  const parts = complete
    ? formatRentalRangeParts(term.startDate!, term.endDate!, locale, { short: true })
    : null;

  return (
    <>
      {/*
        PIGUŁKA MA SZEROKOŚĆ SWOJEJ TREŚCI — bez `max-w`, bez `truncate` (F12).
        Trzyma ją w ryzach nie sufit, tylko to, ILE członów wchodzi na danym
        progu kontenera (patrz nagłówek komponentu). `whitespace-nowrap` jest
        tu WARUNKIEM, nie ozdobą: bez `truncate` (które niosło je w pakiecie)
        fraza mogłaby się ZAWINĄĆ i rozepchnąć belkę w drugi wiersz — a belka
        ma zostać jednorzędowa na każdej szerokości.

        Progi 28/34 rem policzone z pasa strony (`SITE_CONTAINER` = 83,333%
        szerokości kontenera): przy oknie 390 px pas ma 325 px, trzy ikony
        biorą 120, odstępy 14, więc na pigułkę i znak firmy zostaje 191 —
        sam zakres („28 wrz – 2 paź", przypadek najszerszy) mieści się w tym
        z zapasem na znak, komplet z dobami już nie.
      */}
      <button
        type="button"
        className={
          "site-cta-secondary inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 " +
          "whitespace-nowrap rounded-full text-xs font-semibold " +
          "@min-[40rem]/site:gap-2 @min-[40rem]/site:text-sm"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        data-store-term-toggle
        onClick={() => setOpen(true)}
      >
        {/*
          ZNAK KALENDARZA ZNIKA PIERWSZY PO DOBACH (F12). `hidden` (czyli
          `display: none`), a nie `opacity`/`invisible`: znak ma oddać PAS,
          nie tylko przestać być widoczny. Dla czytnika ekranu nie zmienia się
          nic — znak jest `aria-hidden` na każdej szerokości, a nazwę kontrolki
          niesie tekst frazy.
        */}
        <StoreGlyph name="calendar" className="hidden h-4 w-4 shrink-0 @min-[28rem]/site:block" />
        {/*
          ZACHĘTA JEST KRÓTKA („Wybierz termin", nie „Wybierz termin najmu"):
          w belce ikonowej to jedyny napis, a każde zbędne słowo zabiera piksele
          nazwie najemcy obok. Dłuższa forma nie mieściła się na żadnym
          telefonie — a ścięte „Wybierz termin na…" byłoby gorsze od krótszego
          zdania.

          Znacznik `data-store-term-summary` zostaje na OWIJCE obu członów:
          wisi na nim kontrakt „pigułka odzwierciedla zakres z koszyka", a jego
          `textContent` ma dalej być pełną frazą — tą samą, którą składa
          `formatRentalRange` dla koszyka i kasy.
        */}
        <span data-store-term-summary>
          {parts !== null ? (
            <>
              <span data-store-term-range>{parts.range}</span>
              {/*
                DOBY ZNIKAJĄ PIERWSZE. Separator „·" mieszka RAZEM z nimi
                w jednym elemencie — inaczej po zdjęciu członu został by
                w belce wiszący środkowy kropkowy znak bez prawej strony.
                Spacja przed „·" jest zwykła (jedyny legalny punkt łamania
                frazy, S-10), reszta odstępów to NBSP z rdzenia.
              */}
              <span data-store-term-days className="hidden @min-[34rem]/site:inline">
                {` ·\u00a0${parts.days}`}
              </span>
            </>
          ) : (
            copy.term.choose
          )}
        </span>
      </button>
      {/*
        „SPRAWDZAM DOSTĘPNOŚĆ" — KOMUNIKAT, NIE TREŚĆ BELKI (F7b).

        Odczyt dostępności rusza SAM, na każdą zmianę terminu (patrz
        `StoreTermProvider`), więc w belce ikonowej migałby napis o pracy,
        o którą nikt nie prosił — i rozpychałby przy tym jedyny tekstowy
        element nagłówka. Zostaje jako `sr-only`: czytnik ekranu dostaje
        `role="status"` (grzeczna zapowiedź), oko — nic. Widoczny stan
        „sprawdzam" ma tam, gdzie jest o czym mówić: w karcie rezerwacji
        na stronie sprzętu.
      */}
      {term.checking ? (
        <span className="sr-only" role="status">
          {copy.term.checking}
        </span>
      ) : null}
    </>
  );
}

/**
 * POWIERZCHNIA TERMINU POD NAGŁÓWKIEM — OKNO WYBORU I PANEL KONFLIKTU.
 * Stoi POD belką, czyli w tym samym korzeniu motywu, co reszta sklepu
 * (K6, ADR-092): pasek poza korzeniem brałby paletę panelu.
 *
 * ==================== WIERSZ MOBILNY WYPADŁ (F7b) ====================
 *
 * Do F7b mieszkał tu drugi egzemplarz pigułki: wiersz `@min-[48rem]/site:hidden`
 * pokazywany wtedy, gdy belka była za ciasna na pełne pole wyszukiwania plus
 * pigułkę. Belka ikonowa tego problemu nie ma (trzy kwadraty 44 px zamiast
 * pola), więc pigułka jest JEDNA — w belce, na każdej szerokości. Zniknął
 * razem z wierszem cały próg kontenerowy, który obie formy rozdzielał, a
 * z nim klasa wad „w pasie 47–48 rem pigułki są dwie albo nie ma żadnej".
 *
 * Goły znacznik `data-store-term` zostaje na OWIJCE: wisi na nim puls
 * produkcyjny, a owijka jest w SSR każdej strony handlowej niezależnie od
 * szerokości okna. Okno wyboru i panel konfliktu mieszkają tutaj, bo konflikt
 * musi być widoczny na każdej szerokości, a okno jest `position: fixed`, więc
 * miejsce w przepływie jest mu obojętne.
 */
export function StoreTermBar({
  copy,
  products,
  locale,
}: {
  copy: StorefrontCopy;
  products: StoreTermProduct[];
  /** Język NAJEMCY — do okna wyboru (nazwy miesięcy `Intl`). */
  locale: StorefrontLocale;
}) {
  const term = useStoreTerm();
  const { open, setOpen } = useContext(StoreTermModalContext);

  const byId = new Map(products.map((product) => [product.id, product.name]));

  return (
    <div data-store-term>
      {/*
        OKNO WYBORU — bez `productId`, więc bez malowania dostępności (R2).
        Zapis terminu wyłącznie przyciskiem „Zastosuj" w oknie (ADR-194).
      */}
      {open ? (
        <StoreTermModal copy={copy} locale={locale} onClose={() => setOpen(false)} />
      ) : null}

      {/*
        PANEL KONFLIKTU (R4). Pokazujemy, czego nie da się wynająć w tym
        terminie, i zostawiamy rozstrzygnięcie klientowi. `role="alert"`, bo to
        jest zmiana stanu, o której klient nie prosił — pojawia się w reakcji na
        jego zmianę terminu, ale mówi o pozycjach, na które nie patrzył.
      */}
      {term.verdict.conflicts.length > 0 ? (
        <div className={cn(SITE_CONTAINER, "pb-4 md:pt-4")}>
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
