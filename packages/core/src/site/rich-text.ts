/**
 * TREŚĆ SFORMATOWANA ELEMENTU — MODEL RUNÓW (K3, ADR-086).
 *
 * ================== TO JEST OŚ BEZPIECZEŃSTWA, NIE WYGODA ==================
 *
 * Edycja W MIEJSCU pozwala operatorowi pogrubić fragment, pochylić go i wstawić
 * link. Naiwna implementacja trzyma wynik jako HTML z `contenteditable` i wsadza
 * go w render przez `dangerouslySetInnerHTML` — i to jest dokładnie ta droga,
 * którą do PUBLICZNEGO sklepu najemcy wchodzi `<script>`, `onerror=` albo
 * `javascript:`. Treść operatora ląduje na stronie oglądanej przez jego
 * klientów, więc pole tekstowe kreatora jest granicą zaufania.
 *
 * Dlatego treść NIE JEST HTML-em. Jest LISTĄ RUNÓW: kawałek tekstu plus
 * zamknięty zbiór atrybutów (`bold`, `italic`, `href`). Render składa znaczniki
 * SAM, z zaufanych części — `<strong>`, `<em>`, `<a>` powstają w drzewie
 * Reacta, a tekst wchodzi jako tekst. Nie ma miejsca, w którym string od
 * operatora stałby się znacznikiem: nawet gdyby wpisał `<script>alert(1)`,
 * przejdzie przez schemat jako TEKST i wyświetli się jako tekst.
 *
 * `href` runu przechodzi tę samą allowlistę schematów co przycisk CTA
 * (http/https/ścieżka/kotwica) — allowlista, nie blocklista, więc `javascript:`
 * i `data:` odpadają z definicji, a nie z listy zakazów.
 *
 * ================== ZWIĄZEK Z TEKSTEM PROSTYM ==================
 *
 * Element niesie RÓWNIEŻ zwykły `text` — to on trafia do metadanych strony
 * (tytuł, opis) i to on jest treścią, gdy formatowania nie ma. Runy są
 * OPCJONALNE, a schemat pilnuje, żeby ich spłaszczenie było równe `text`:
 * inaczej strona pokazywałaby jedno, a wyszukiwarka indeksowała drugie.
 */
import { z } from "zod";

import { linkHrefSchema } from "./link-href";

/** Sufit długości pojedynczego runu — akapit dzieli się na runy, nie odwrotnie. */
const RUN_MAX_LENGTH = 2_000;

/** Sufit liczby runów w jednym elemencie. Formatowanie, nie edytor tekstu. */
export const MAX_RUNS_PER_ELEMENT = 200;

/**
 * Cel linku w runie — DOKŁADNIE ta sama allowlista, co `href` przycisku.
 *
 * Zdanie „wspólna definicja, bo dwie kopie tej reguły rozjechałyby się" stało
 * tu od K3 nad WŁASNĄ, trzecią kopią. Definicja mieszka teraz w `./link-href`
 * i ten plik ją re-eksportuje: nazwa importu (także w `./index` i w panelu)
 * zostaje bez zmian, a kopii nie da się już zrobić przez nieuwagę.
 */
export { linkHrefSchema };

/**
 * Pojedynczy run: kawałek tekstu i jego formatowanie. `.strict()` jest tu
 * częścią obrony — nieznany klucz (np. przemycone `html` albo `onClick`) jest
 * BŁĘDEM, a nie ignorowanym balastem, więc nie da się przeszmuglować pola,
 * które kiedyś ktoś nieopatrznie zacznie renderować.
 *
 * Tekst NIE jest przycinany (`trim`): spacja między pogrubionym a zwykłym
 * słowem jest treścią, a nie ozdobą — przycięcie sklejałoby wyrazy.
 */
export const textRunSchema = z
  .object({
    text: z.string().min(1).max(RUN_MAX_LENGTH),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    href: linkHrefSchema.optional(),
  })
  .strict();
export type TextRun = z.infer<typeof textRunSchema>;

export const richTextSchema = z.array(textRunSchema).min(1).max(MAX_RUNS_PER_ELEMENT);
export type RichText = z.infer<typeof richTextSchema>;

/** Spłaszczenie runów do zwykłego tekstu — jedyna droga z runów do `text`. */
export function plainTextOf(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

/**
 * Runy z gołego tekstu — punkt wejścia edycji w miejscu dla treści, która
 * formatowania jeszcze nie ma. Pusty tekst NIE daje runów: lista runów jest
 * niepusta z definicji, a element bez treści i tak nie przejdzie schematu.
 */
export function runsFromPlainText(text: string): RichText | undefined {
  return text.length > 0 ? [{ text }] : undefined;
}

/**
 * Scalanie sąsiadów o IDENTYCZNYM formatowaniu. Edytor w miejscu produkuje
 * runy per węzeł DOM, więc bez tego jedno zdanie potrafi rozpaść się na
 * kilkanaście identycznie sformatowanych kawałków — i każde kliknięcie
 * rozbijałoby je dalej, aż do sufitu liczby runów.
 */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const previous = out.at(-1);
    if (previous && sameFormatting(previous, run)) {
      out[out.length - 1] = { ...previous, text: previous.text + run.text };
      continue;
    }
    out.push({ ...run });
  }
  // PUSTA lista jest legalnym WYNIKIEM (operator skasował całą treść), ale nie
  // jest legalną TREŚCIĄ — schemat wymaga co najmniej jednego runu. Wołający
  // ma wtedy zdjąć runy z elementu, a nie zapisywać pustą listę.
  return out;
}

function sameFormatting(a: TextRun, b: TextRun): boolean {
  return Boolean(a.bold) === Boolean(b.bold) && Boolean(a.italic) === Boolean(b.italic) && a.href === b.href;
}
