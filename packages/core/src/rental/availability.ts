/**
 * Dostępność egzemplarzy. Funkcja jest CZYSTA: dostaje dane, nie odpytuje bazy.
 *
 * To świadomie inaczej niż w silniku źródłowym, który sam strzelał do bazy
 * i przyjmował nazwy tabel jako konfigurację. Wstrzykiwanie nazw tabel po to,
 * by funkcja mogła sama wykonać zapytanie, rozwiązuje niewłaściwy problem:
 * czysta funkcja nie potrzebuje wiedzieć NIC o schemacie. Zapytania i RLS
 * zostają w warstwie wywołującej, gdzie tenant jest znany i egzekwowalny —
 * silnik nie ma jak przypadkiem przeciec danych między tenantami, bo nie ma
 * dostępu do bazy.
 *
 * Z tego samego powodu statusy blokujące (`pending`/`paid`/…) nie są tu ani
 * stałą, ani parametrem: warstwa wywołująca filtruje po statusie w zapytaniu
 * i podaje już tylko najmy, które blokują. Jedno źródło prawdy o statusach
 * jest w panelu, nie w dwóch miejscach naraz.
 */

import { addDays, assertIsoDate, rangesOverlapInclusive, type IsoDate } from "./dates";

/** Okno serwisowe egzemplarza (serwis, naprawa, wynajem poza systemem). */
export interface UnitServiceWindow {
  unitId: string;
  unavailableFrom: IsoDate | null;
  unavailableTo: IsoDate | null;
}

/** Zajęty termin egzemplarza — najem już wpisany do kalendarza. */
export interface BookedRange {
  unitId: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

export interface AvailabilityParams {
  bufferBeforeDays: number;
  bufferAfterDays: number;
}

export interface AvailabilityResult {
  available: boolean;
  availableUnitIds: string[];
  blockedUnitIds: string[];
}

function assertBuffer(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label}: bufor musi być całkowitą liczbą dób >= 0, otrzymano ${value}`);
  }
}

/**
 * Czy egzemplarz jest wyłączony z użytku w żądanym terminie.
 *
 * Okno serwisowe porównujemy z SAMYM najmem, bez buforów — bufor to czas na
 * przegląd między najmami, a nie kolejny najem, więc nie musi omijać serwisu.
 * Migracja 0007 wymusza CHECK-iem komplet `from`+`to`, ale silnik jest czysty
 * i nie ma prawa na ten CHECK liczyć: dane mogą przyjść z importu albo
 * ze starszego wiersza, więc oba przypadki jednostronne obsługujemy wprost.
 */
function isUnitInService(unit: UnitServiceWindow, start: IsoDate, end: IsoDate): boolean {
  const { unavailableFrom, unavailableTo } = unit;

  if (unavailableFrom && unavailableTo) {
    return rangesOverlapInclusive(start, end, unavailableFrom, unavailableTo);
  }
  // Otwarte z prawej: niedostępny od tej daty w nieskończoność.
  if (unavailableFrom) {
    return end >= unavailableFrom;
  }
  // Otwarte z lewej: niedostępny do tej daty włącznie.
  if (unavailableTo) {
    return start <= unavailableTo;
  }
  return false;
}

/**
 * Które egzemplarze są wolne w żądanym terminie.
 *
 * Bufory doklejamy do ŻĄDANEGO terminu, a najmy z kalendarza porównujemy
 * surowe. Jest to równoważne rozszerzeniu każdego najmu o bufor z obu stron
 * (relacja jest symetryczna), a tańsze: rozszerzamy jeden zakres zamiast N.
 *
 * `available` mówi tylko tyle, że został choć jeden wolny egzemplarz — wybór
 * KTÓREGO należy do warstwy zamówień (Zadanie 4), bo to decyzja biznesowa
 * (rotacja, lokalizacja), nie arytmetyczna.
 */
export function checkAvailability(
  units: UnitServiceWindow[],
  booked: BookedRange[],
  requested: { start: IsoDate; end: IsoDate },
  params: AvailabilityParams,
): AvailabilityResult {
  const start = assertIsoDate(requested.start, "requested.start");
  const end = assertIsoDate(requested.end, "requested.end");

  if (end < start) {
    throw new RangeError(`Zakres najmu odwrócony: end (${end}) jest przed start (${start})`);
  }

  assertBuffer(params.bufferBeforeDays, "bufferBeforeDays");
  assertBuffer(params.bufferAfterDays, "bufferAfterDays");

  const blockedStart = addDays(start, -params.bufferBeforeDays);
  const blockedEnd = addDays(end, params.bufferAfterDays);

  const bookedUnitIds = new Set<string>();
  for (const range of booked) {
    const bookedStart = assertIsoDate(range.startDate, "booked.startDate");
    const bookedEnd = assertIsoDate(range.endDate, "booked.endDate");
    if (rangesOverlapInclusive(blockedStart, blockedEnd, bookedStart, bookedEnd)) {
      bookedUnitIds.add(range.unitId);
    }
  }

  const availableUnitIds: string[] = [];
  const blockedUnitIds: string[] = [];

  for (const unit of units) {
    const free = !isUnitInService(unit, start, end) && !bookedUnitIds.has(unit.unitId);
    (free ? availableUnitIds : blockedUnitIds).push(unit.unitId);
  }

  return {
    available: availableUnitIds.length > 0,
    availableUnitIds,
    blockedUnitIds,
  };
}
