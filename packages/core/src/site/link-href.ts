/**
 * CEL ODNOŚNIKA — JEDNA ALLOWLISTA SCHEMATÓW NA CAŁY PRODUKT.
 *
 * ==================== DLACZEGO OSOBNY LIŚĆ ====================
 *
 * Ta reguła jest granicą bezpieczeństwa: przepuszcza adresy, które najemca wpisze
 * w przycisk, w link kafla galerii, w stopkę i w sformatowany tekst — a potem
 * render wkłada je w atrybut `href` na PUBLICZNEJ stronie. `javascript:` w tym
 * miejscu to wykonanie skryptu z treści.
 *
 * Do tej pory reguła istniała w TRZECH kopiach: `ctaHref` (treść v1), `href`
 * elementu płótna v2 i `href` runu tekstowego. Wszystkie trzy były identyczne
 * co do znaku, a każda niosła komentarz o tym, że kopii być nie może — co jest
 * dokładnie tym objawem, o którym te komentarze ostrzegały. Rozjazd nie wymagał
 * pomyłki, tylko poprawki w jednym z trzech miejsc, i przy rozszerzeniu listy
 * o `tel:`/`mailto:` byłby przesądzony.
 *
 * Liść jest po to, żeby kopii nie dało się zrobić przypadkiem: `./elements`,
 * `./rich-text` i `./index` biorą TĘ definicję, a nie swoją.
 *
 * ==================== ALLOWLISTA, NIE BLOCKLISTA ====================
 *
 * Wpuszczamy WYMIENIONE schematy, a nie „wszystko poza zakazanymi". Różnica
 * jest zasadnicza przy schematach, których dziś nikt nie zna: `javascript:`,
 * `data:`, `blob:` i każdy przyszły egzotyczny odpadają z DEFINICJI, a nie
 * dlatego, że ktoś pamiętał, żeby je dopisać.
 *
 * ==================== DLACZEGO `tel:` I `mailto:` (decyzja właściciela) ====================
 *
 * Wypożyczalnia sprzedaje przez telefon. Przycisk „Zadzwoń" w hero był do tej
 * pory NIEPRZEDSTAWIALNY: dane kontaktowe renderowały się jako odnośniki
 * z sekcji kontaktu, ale operator nie mógł zrobić z nich wezwania do działania
 * w miejscu, w którym klient patrzy. Oba schematy są bezpieczne w sposób, który
 * nie wymaga zaufania do treści: nie wykonują kodu, nie otwierają karty
 * przeglądarki (stąd brak `rel` — patrz `externalLinkRel` w @avably/ui) i nie
 * mają dostępu do dokumentu.
 *
 * Sprawdzamy przy nich JEDNĄ rzecz ponad schemat: czy adres w ogóle ma treść.
 * `mailto:` bez małpy i `tel:` bez ani jednej cyfry to nie są adresy — to są
 * literówki, które inaczej wyszłyby dopiero jako martwy przycisk u klienta.
 * Dalej NIE idziemy: numer międzynarodowy z nawiasami i spacjami oraz `mailto:`
 * z `?subject=` są poprawne, a walidator sprytniejszy od standardu odrzucałby
 * adresy, które działają.
 */
import { z } from "zod";

/** Schematy, które wpuszczamy — komplet, w jednym miejscu. */
const DOZWOLONE_SCHEMATY = ["http:", "https:", "mailto:", "tel:"] as const;

function celJestDozwolony(value: string): boolean {
  // Ścieżka własna i kotwica nie mają schematu — i nie mogą go dostać przez
  // `new URL`, które bez bazy uzna „/store" za adres nieprawidłowy.
  if (value.startsWith("/") || value.startsWith("#")) return true;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (!(DOZWOLONE_SCHEMATY as readonly string[]).includes(url.protocol)) return false;

  // `new URL("tel:")` PARSUJE się poprawnie (schemat nieznany standardowi ma
  // ścieżkę nieprzezroczystą, tu pustą), więc bez tego zdania pusty adres
  // przechodziłby walidację i wychodził na stronę jako martwy przycisk.
  if (url.protocol === "mailto:") return url.pathname.includes("@");
  if (url.protocol === "tel:") return /\d/.test(url.pathname);

  return true;
}

/**
 * Cel odnośnika: absolutny http(s), ścieżka względna (`/cennik`), kotwica
 * (`#kontakt`), adres e-mail (`mailto:`) albo numer telefonu (`tel:`).
 */
export const linkHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine(celJestDozwolony, {
    message:
      "Dozwolone: adres http(s), ścieżka względna (/...), kotwica (#...), e-mail (mailto:...) albo telefon (tel:...)",
  });
