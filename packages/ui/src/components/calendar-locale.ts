/**
 * Mapa locale aplikacji → locale kalendarza (R3-1c, uwaga 5).
 *
 * DLACZEGO MAPA STOI TUTAJ, A NIE W PANELU. `react-day-picker` jest
 * zależnością `@avably/ui` i nikogo poza nim; gdyby tabelę trzymał panel,
 * musiałby importować `react-day-picker/locale` przez pakiet, który tej
 * zależności nie eksportuje. Jedno miejsce oznacza też, że drugi konsument
 * kalendarza (galeria systemu projektowego, w przyszłości storefront)
 * dostaje TĘ SAMĄ odpowiedź, a nie własną kopię `if (locale === "pl")`.
 *
 * DLACZEGO NIE `useLocale()` Z next-intl W SAMYM KALENDARZU. `@avably/ui`
 * nie zna frameworka tłumaczeń i nie ma go w zależnościach — wciągnięcie
 * `next-intl` do biblioteki komponentów po to, żeby jeden komponent sam
 * sobie odczytał język, związałoby CAŁY pakiet z jedną apką (storefront
 * ładuje wiadomości inaczej). Język czyta więc wywołujący (w panelu:
 * `lib/fields/date-fields.tsx`, jedyne wejście do dat całego panelu)
 * i podaje go tutaj jako zwykły kod BCP-47.
 *
 * Nieznany kod spada na angielski, bo tak samo zachowuje się reszta
 * routingu (ADR-013: `pl` i `en`, domyślny `pl` ustawia middleware) —
 * kalendarz nie jest miejscem na trzeci wariant tej decyzji.
 */
import { enUS, pl, type DayPickerLocale } from "react-day-picker/locale";

/**
 * Locale kalendarza dla kodu języka aplikacji (`pl`, `en`, `pl-PL`, …).
 *
 * Zwracany obiekt niesie RÓWNIEŻ etykiety dostępności (`labels.labelPrevious`
 * i reszta) — dlatego kalendarz nie ma prawa ich nadpisywać własnym tekstem
 * w jednym języku, tak jak robił to przed R3-1c.
 */
export function dayPickerLocale(code: string): DayPickerLocale {
  return code.toLowerCase().startsWith("pl") ? pl : enUS;
}
