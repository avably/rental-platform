import { notFound } from "next/navigation";

/**
 * CATCH-ALL NIEDOPASOWANYCH ADRESÓW OSI MARKETINGOWEJ (L-UX-01, ADR-197).
 *
 * Bez tej trasy adres głębszy niż jeden segment pod ważnym locale
 * (np. `/pl/blog/2026`) nie dopasowywał się do niczego — a że oś nie ma
 * root layoutu (dwa rooty: `[locale]` i `(tenant)`, wzorzec next-intl),
 * odpowiadało WBUDOWANE 404 Nexta zamiast ekranu z szablonu. Catch-all jest
 * najsłabszym dopasowaniem routera: każda istniejąca trasa (w tym `[page]`)
 * wygrywa z nim bez zmiany zachowania, reszta spada tu i dostaje
 * `notFound()` → `app/[locale]/not-found.tsx` w języku trasy.
 *
 * NIE dotyczy hostów najemców: middleware odcina na nich oś marketingową
 * (`/pl` i `/en` → neutralne 404, ADR-158/131), zanim router cokolwiek
 * zobaczy.
 *
 * `force-dynamic` jak każda trasa marketingowa: CSP wymaga nonce per żądanie
 * (ten sam powód co w `[page]`), a boundary 404 renderuje się w żądaniu
 * strony, która rzuciła.
 */
export const dynamic = "force-dynamic";

export default function CatchAllPage() {
  notFound();
}
