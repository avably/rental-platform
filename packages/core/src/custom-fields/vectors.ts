/**
 * Wektory parytetu rdzeń ↔ baza (C6-A1, ADR-118).
 *
 * DLACZEGO TO JEST W KODZIE PRODUKCYJNYM, A NIE W TEŚCIE. Reguła zgodności
 * wartości z definicją istnieje w DWÓCH miejscach: w triggerze
 * `app.custom_fields_validate` (0057) i w `validateCustomFieldValues`. Dwie
 * kopie reguły rozjeżdżają się przy pierwszej poprawce, a rozjazd nie boli od
 * razu — boli wtedy, gdy formularz mówi „zapisano", a baza odmawia (albo,
 * gorzej, gdy formularz odrzuca coś, co surowe API przyjmuje).
 *
 * Zestaw wektorów w DWÓCH plikach testowych byłby dokładnie tą samą pułapką
 * co dwie kopie reguły. Dlatego zestaw jest JEDEN i mieszka po stronie
 * kontraktu: suita rdzenia przepuszcza go przez funkcję TypeScriptu, a suita
 * `packages/db/test/custom-fields.test.ts` przez PRAWDZIWY trigger na żywej
 * bazie. Dopisanie wektora automatycznie obowiązuje obie strony.
 *
 * Każdy wektor musi być rozstrzygalny BEZ kontekstu wiersza (bez historii
 * wartości, bez wymagalności) — te reguły mają własne testy po obu stronach.
 */

import type { CustomFieldType } from "./types";

export interface CustomFieldParityVector {
  /** Czytelna nazwa — trafia do nazwy przypadku testowego po obu stronach. */
  name: string;
  type: CustomFieldType;
  /** Opcje listy wyboru; wymagane wyłącznie dla `select`. */
  options?: readonly string[];
  /** Wartość dokładnie w takiej postaci, w jakiej trafia do JSONB. */
  value: unknown;
  /** Czy OBIE strony mają ją przyjąć. */
  valid: boolean;
}

export const CUSTOM_FIELD_PARITY_VECTORS: readonly CustomFieldParityVector[] = [
  // --- tekst ---
  { name: "tekst zwykły", type: "text", value: "Numer uprawnień 123", valid: true },
  { name: "tekst 200 znaków", type: "text", value: "x".repeat(200), valid: true },
  { name: "tekst 201 znaków", type: "text", value: "x".repeat(201), valid: false },
  {
    // Liczy się ZNAK, nie jednostka UTF-16: 200 emoji to 200 znaków dla
    // Postgresa i 400 jednostek dla naiwnego `String.length`.
    name: "tekst 200 znaków spoza BMP",
    type: "text",
    value: "\u{1F600}".repeat(200),
    valid: true,
  },
  { name: "tekst ze znakiem sterującym", type: "text", value: "a\u0001b", valid: false },
  { name: "tekst z łamaniem wiersza", type: "text", value: "a\nb", valid: false },
  { name: "tekst liczbą", type: "text", value: 42, valid: false },

  // --- tekst długi ---
  { name: "tekst długi z łamaniem wiersza", type: "textarea", value: "a\nb\tc", valid: true },
  { name: "tekst długi ze znakiem sterującym", type: "textarea", value: "a\u0001b", valid: false },
  { name: "tekst długi 2001 znaków", type: "textarea", value: "x".repeat(2001), valid: false },

  // --- liczba ---
  { name: "liczba całkowita", type: "number", value: 1234, valid: true },
  { name: "liczba z częścią dziesiętną", type: "number", value: 1234.5, valid: true },
  { name: "liczba ujemna", type: "number", value: -7.25, valid: true },
  { name: "liczba jako tekst", type: "number", value: "1234", valid: false },
  { name: "liczba poza zakresem", type: "number", value: 1e13, valid: false },
  { name: "liczba z 7 miejscami po przecinku", type: "number", value: 1.1234567, valid: false },
  {
    // Pułapka notacji wykładniczej: `(1e-7).toString()` to „1e-7", więc
    // naiwne liczenie miejsc po przecinku widziało tu zero.
    name: "liczba 1e-7 (skala 7 w bazie)",
    type: "number",
    value: 0.0000001,
    valid: false,
  },
  { name: "liczba boolem", type: "number", value: true, valid: false },

  // --- data ---
  { name: "data poprawna", type: "date", value: "2026-08-09", valid: true },
  { name: "data nieistniejąca", type: "date", value: "2026-02-31", valid: false },
  { name: "data w formacie polskim", type: "date", value: "09.08.2026", valid: false },
  { name: "data z czasem", type: "date", value: "2026-08-09T10:00:00Z", valid: false },
  { name: "data przestępna", type: "date", value: "2028-02-29", valid: true },
  { name: "data nieprzestępna", type: "date", value: "2027-02-29", valid: false },
  // GRANICE, nie środek przedziału. PostgreSQL nie ma roku zerowego
  // (1 p.n.e. → 1 n.e.), więc `'0000-01-01'::date` wywala się na zakresie,
  // a JavaScript rok 0 zna i round-trip przez setUTCFullYear go przepuszczał.
  // Ten rozjazd znalazła sonda PM, nie ten zestaw — bo zestaw sprawdzał
  // środek przedziału. Stąd trzy wektory graniczne zamiast jednego.
  { name: "rok zerowy (Postgres go nie ma)", type: "date", value: "0000-01-01", valid: false },
  { name: "pierwszy rok kalendarza", type: "date", value: "0001-01-01", valid: true },
  { name: "górna granica formatu czterocyfrowego", type: "date", value: "9999-12-31", valid: true },

  // --- lista wyboru ---
  { name: "opcja z listy", type: "select", options: ["Alfa", "Beta"], value: "Beta", valid: true },
  { name: "opcja spoza listy", type: "select", options: ["Alfa", "Beta"], value: "Gamma", valid: false },
  {
    // Dopasowanie opcji jest DOKŁADNE (wielkość liter ma znaczenie) — inaczej
    // eksport i umowa drukowałyby inny napis niż wybrany.
    name: "opcja różniąca się wielkością liter",
    type: "select",
    options: ["Alfa", "Beta"],
    value: "beta",
    valid: false,
  },

  // --- pole zaznaczane ---
  { name: "checkbox prawda", type: "checkbox", value: true, valid: true },
  { name: "checkbox fałsz", type: "checkbox", value: false, valid: true },
  { name: "checkbox tekstem", type: "checkbox", value: "tak", valid: false },

  // --- telefon ---
  { name: "telefon z prefiksem kraju", type: "phone", value: "+48 501 234 567", valid: true },
  { name: "telefon krajowy", type: "phone", value: "501234567", valid: true },
  { name: "telefon w nawiasach", type: "phone", value: "(22) 123-45-67", valid: true },
  { name: "telefon za krótki", type: "phone", value: "12345", valid: false },
  { name: "telefon literami", type: "phone", value: "nie-telefon", valid: false },
  {
    // Sześć dozwolonych znaków, ZERO cyfr. Wcześniej przechodziło: kanonizator
    // numeru zwracał NULL, a `NULL not between …` daje NULL, więc `if`
    // w triggerze się nie wykonywał.
    name: "telefon bez ani jednej cyfry",
    type: "phone",
    value: "+()-()",
    valid: false,
  },
  { name: "telefon z 16 cyframi", type: "phone", value: "1234567890123456", valid: false },

  // --- wspólne ---
  { name: "wartość pusta jako null", type: "text", value: null, valid: false },
] as const;
