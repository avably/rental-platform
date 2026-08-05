/**
 * PUBLICZNY URL ZDJĘCIA SEKCJI — JEDNA FUNKCJA, ZERO KLAS (E3).
 *
 * Funkcja mieszkała w `sections.tsx` (0043) i to było w porządku, dopóki
 * potrzebowały jej wyłącznie sekcje v1. Od E3 sięga po nią także galeria
 * strukturalna, a komponenty strukturalne mają ZAMKNIĘTĄ listę importów spoza
 * swojego katalogu (`structured-role-usage.test.tsx`): każdy nowy import to
 * potencjalny producent klas, który omijałby skan ról motywu.
 *
 * `sections.tsx` jest producentem klas i to się nie zmieni — więc zamiast
 * wpuszczać go na allowlistę, wyprowadzamy stąd SAM PRZELICZNIK ADRESU. Plik
 * nie zawiera ani jednej klasy i nie może jej zawierać: nie ma tu JSX-a.
 *
 * `base` (prefiks do bucketa włącznie) wstrzykuje warstwa danych
 * (storefront/podgląd panelu) — pakiet UI nie zna adresu Supabase. Bez `base`
 * zdjęcia degradują się do kafla zastępczego, więc render nie zależy od Storage.
 */
export function siteImageUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
