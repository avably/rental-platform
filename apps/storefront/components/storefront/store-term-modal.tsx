"use client";

/**
 * MODAL WYBORU TERMINU — JEDNA MECHANIKA, DWA WEJŚCIA (ADR-194).
 *
 * ==================== CO ZASTĘPUJE ====================
 *
 * Do ADR-194 kalendarz zakresu stał ROZWINIĘTY na stałe: w pasku powłoki po
 * kliknięciu „zmień termin" rozkładał się w treści strony, a na stronie sprzętu
 * siatka miesiąca wisiała zawsze i zjadała pół pierwszego ekranu. Wzorzec
 * właściciela (strona jego wypożyczalni starkit.pl oraz karta produktu
 * https://perfect-moments.co.uk/products/baby-shower-charades-x24-cards) jest
 * odwrotny: na stronie stoi ZWARTE wejście (pole daty w karcie rezerwacji,
 * pigułka w pasku), a siatka dat otwiera się dopiero na życzenie — w oknie
 * modalnym nad treścią.
 *
 * ==================== DWA WEJŚCIA, RÓŻNA WIEDZA ====================
 *
 *   • Z KARTY REZERWACJI na stronie sprzętu (props `productId` obecny): modal
 *     pokazuje dostępność TEGO sprzętu — liczbę wolnych sztuk pod datą, dni
 *     z zerem niewybieralne (dane ADR-179, liczone na żywo, NIGDY z cache —
 *     bramka ADR-186).
 *   • Z PIGUŁKI paska powłoki (bez `productId`): sam wybór zakresu. Nie ma
 *     „produktu bieżącego", więc malowanie zajętości nie miałoby o czym mówić
 *     — zajęte DLA CZEGO? (R2 z ADR-179).
 *
 * ==================== ZASTOSUJ = JEDYNY ZAPIS (ADR-194) ====================
 *
 * Klik w dzień zmienia WYŁĄCZNIE szkic (stan tego okna). Do stanu koszyka
 * (`CartState.startDate/endDate` — jedyne źródło prawdy terminu, R1 z ADR-179)
 * pisze DOKŁADNIE jedno miejsce: przycisk „Zastosuj". Zamknięcie krzyżykiem,
 * Escape ani kliknięciem tła nie zapisuje nic. „Wyczyść" zeruje szkic —
 * wyzerowany termin dociera do koszyka tą samą drogą, co każdy inny: przez
 * „Zastosuj". Szkic nie jest drugim stanem terminu — żyje krócej niż okno
 * i nie widzi go nikt poza nim (ta sama klasa, co bufor cofnięcia w ADR-179).
 *
 * ==================== GODZIN NIE MA ====================
 *
 * Model domenowy jest DZIENNY (doby, `rentalDaysInclusive`). Zakładka godzin
 * z wzorca rynkowego jest świadomie odcięta — patrz ADR-194.
 *
 * WYGLĄD Z MOTYWU NAJEMCY (K6, ADR-092): modal nosi role (`site-*`), nigdy
 * kolory, i stoi WEWNĄTRZ drzewa komponentu (nie w portalu) — czyli pod
 * korzeniem motywu, bez którego zmienne `--site-*` nie istnieją. Pozycję nad
 * treścią daje `position: fixed`, któremu miejsce w drzewie jest obojętne.
 */
import { AVAILABILITY_WINDOW_MAX_DAYS, availabilityWindowEnd, bcp47 } from "@avably/core";
import {
  SiteDateRangeCalendar,
  initialSiteCalendarMonth,
  shiftSiteCalendarMonth,
  siteCalendarMonthDays,
} from "@avably/ui";
import { useEffect, useRef, useState } from "react";

import { calendarLabels, useStoreTerm } from "@/components/storefront/store-term";
import { checkAvailabilityDays } from "@/lib/actions/availability";
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

/**
 * Okno zapytania dla PARY miesięcy widocznych naraz (ADR-194): unia okien obu
 * miesięcy, wciąż JEDNO zapytanie. Druga połowa pary przy krańcu horyzontu
 * bywa w całości poza oknem — wtedy pytamy o samą pierwszą.
 */
function visibleMonthsWindow(
  month: string,
  minDate: string,
  maxDate: string,
): { from: string; to: string } | null {
  const first = bookingMonthWindow(month, minDate, maxDate);
  const second = bookingMonthWindow(shiftSiteCalendarMonth(month, 1), minDate, maxDate);
  if (first === null) return second;
  if (second === null) return first;
  return { from: first.from, to: second.to };
}

export function StoreTermModal({
  copy,
  locale,
  productId,
  onClose,
}: {
  copy: StorefrontCopy;
  locale: StorefrontLocale;
  /**
   * Sprzęt, którego dostępność modal maluje na siatce. Brak = wejście
   * z pigułki paska: sam wybór zakresu, bez liczb (R2 z ADR-179).
   */
  productId?: string;
  onClose: () => void;
}) {
  const term = useStoreTerm();

  const today = todayIso();
  const horizon = availabilityWindowEnd(today);

  /**
   * SZKIC ZAKRESU — stan tego okna, zainicjowany terminem z koszyka W CHWILI
   * OTWARCIA. Późniejsza zmiana koszyka spoza okna (druga karta) szkicu nie
   * rusza: klient właśnie coś wybiera i podmiana wyboru pod ręką byłaby gorsza
   * niż chwilowa rozbieżność, którą i tak rozstrzyga „Zastosuj".
   */
  const [draft, setDraft] = useState<{ start: string | null; end: string | null }>(() => ({
    start: term.startDate,
    end: term.endDate,
  }));
  /** Miesiąc-kotwica: otwarcie celuje w termin, który klient JUŻ ma. */
  const [month, setMonth] = useState(() =>
    initialSiteCalendarMonth(term.startDate, today, today, horizon),
  );

  /**
   * ODPOWIEDŹ DZIENNA RAZEM Z KLUCZEM, KTÓREGO DOTYCZY — ten sam idiom, co
   * w prowiderze terminu. Bez klucza siatka czerwca przez chwilę malowałaby
   * liczby maja, czyli pokazywałaby dowód, którego nie ma.
   */
  const [days, setDays] = useState<{ month: string; units: Record<string, number> } | null>(null);

  useEffect(() => {
    if (productId === undefined) return;
    const window = visibleMonthsWindow(month, today, horizon);
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

  /*
    FOKUS I KLAWIATURA. Okno dostaje fokus przy otwarciu (czytnik ekranu ma
    usłyszeć tytuł, nie resztę strony), Escape zamyka BEZ zapisu. Przewijanie
    strony pod modalem gaśnie na czas otwarcia — i wraca dokładnie do wartości
    zastanej, bo modal nie jest właścicielem stylu dokumentu.
  */
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      data-store-term-modal
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={copy.term.heading}
        tabIndex={-1}
        className="site-card w-full max-w-2xl p-5 outline-none"
        // Klik WEWNĄTRZ okna nie jest kliknięciem tła — zatrzymany tu, żeby
        // wybór dnia nie zamykał okna bez „Zastosuj".
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="site-label text-base">{copy.term.heading}</h2>
            <p className="site-text-muted mt-1 text-xs">
              {format(copy.term.windowNote, { days: AVAILABILITY_WINDOW_MAX_DAYS })}
            </p>
          </div>
          <button
            type="button"
            className="site-cta-secondary cursor-pointer px-3 py-1 text-sm font-semibold"
            aria-label={copy.term.close}
            data-store-term-modal-close
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <SiteDateRangeCalendar
          month={month}
          onMonthChange={setMonth}
          months={2}
          start={draft.start}
          end={draft.end}
          /*
            KLIK W DZIEŃ ZMIENIA SZKIC — i NIC poza szkicem (ADR-194). Zapis do
            koszyka ma dokładnie jedno miejsce: „Zastosuj" niżej.
          */
          onSelect={(selection) => setDraft({ start: selection.start, end: selection.end })}
          minDate={today}
          maxDate={horizon}
          /*
            LICZBY TYLKO DLA KLUCZA, KTÓREGO DOTYCZY ODPOWIEDŹ, i tylko przy
            wejściu ze strony sprzętu. `null` znaczy dla siatki „nie wiem" —
            dni zostają wybieralne, bez liczby pod datą.
          */
          dayUnits={
            productId !== undefined && days !== null && days.month === month ? days.units : null
          }
          labels={calendarLabels(copy)}
          locale={bcp47(locale)}
          // Wewnątrz okna kalendarz nie jest osobną kartą — kartą jest okno.
          className="border-0 p-0 shadow-none"
        />

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            className="site-cta-secondary cursor-pointer px-4 py-1.5 text-sm font-semibold"
            data-store-term-clear
            onClick={() => setDraft({ start: null, end: null })}
          >
            {copy.term.clear}
          </button>
          <button
            type="button"
            className="site-cta cursor-pointer text-sm font-semibold"
            data-store-term-apply
            onClick={() => {
              // JEDYNY ZAPIS TERMINU W CAŁYM OKNIE (ADR-194). Prowider trzyma
              // przy tym bufor cofnięcia — panel konfliktu dostaje „wróć do
              // poprzedniego terminu" dokładnie jak przy starej formie.
              term.setTerm(draft.start, draft.end);
              onClose();
            }}
          >
            {copy.term.apply}
          </button>
        </div>
      </div>
    </div>
  );
}
