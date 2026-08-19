import { notFound } from "next/navigation";

/**
 * CATCH-ALL NIEDOPASOWANYCH ADRESÓW (L-UX-01, ADR-197).
 *
 * Bez tej trasy adres nieznany panelowi (np. `/pl/nie-ma-takiej-strony`)
 * nie dopasowywał się do niczego i dostawał WBUDOWANE 404 Nexta — angielskie,
 * bez wyglądu systemu i bez wyjścia — bo aplikacja nie ma root layoutu
 * (`app/[locale]` jest rootem, wzorzec next-intl), więc nie ma też miejsca na
 * globalny `not-found.tsx`. Catch-all jest NAJSŁABSZYM dopasowaniem routera:
 * każda istniejąca trasa wygrywa z nim bez zmiany zachowania, a cała reszta
 * spada tu i dostaje `notFound()` → `app/[locale]/not-found.tsx` w języku
 * trasy i z wyjściem na pulpit.
 *
 * Ekran 404 nie czyta żadnych danych, więc trasa nie potrzebuje guardów —
 * bramki dostępu pilnują TREŚCI, a tu treści nie ma.
 */
export default function CatchAllPage() {
  notFound();
}
