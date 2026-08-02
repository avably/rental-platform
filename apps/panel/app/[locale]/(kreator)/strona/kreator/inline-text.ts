"use client";

/**
 * EDYCJA W MIEJSCU: DOM → RUNY (K3, ADR-086).
 *
 * ================== TO JEST BRAMA, NIE PARSER ==================
 *
 * `contenteditable` przyjmuje WSZYSTKO: wklejenie ze strony internetowej wnosi
 * tabele, `<span style>`, `<img>`, a przy odrobinie złej woli `<script>` albo
 * `<a href="javascript:…">`. Gdybyśmy zapisali to, co jest w DOM-ie, treść
 * operatora stałaby się znacznikami na publicznej stronie jego klientów.
 *
 * Ten moduł czyta drzewo i wypuszcza WYŁĄCZNIE to, co rozumiemy: tekst plus
 * trzy cechy (pogrubienie, pochylenie, link). Wszystko inne jest przezroczyste
 * — wchodzimy w dzieci i bierzemy z nich sam tekst. To jest ALLOWLISTA, nie
 * czyszczenie: nie usuwamy złych znaczników, tylko nie potrafimy ich wypisać.
 *
 * Efekt: wklejony `<img src=x onerror=alert(1)>` nie wnosi ani jednego runu
 * (obrazek nie ma tekstu), a wklejony `<script>alert(1)</script>` wnosi run
 * z TEKSTEM „alert(1)", który render pokaże jako napis. Adres z `javascript:`
 * wchodzi tu jako kandydat i odpada dopiero na schemacie — świadomie: jedna
 * reguła adresów na cały system (Zod), a nie druga kopia w przeglądarce.
 */
import { normalizeRuns, type TextRun } from "@avably/core/site";

/** Znaczniki, które NIOSĄ formatowanie. Reszta jest przezroczysta. */
const BOLD_TAGS = new Set(["B", "STRONG"]);
const ITALIC_TAGS = new Set(["I", "EM"]);

interface Formatting {
  bold?: boolean;
  italic?: boolean;
  href?: string;
}

/**
 * Runy z poddrzewa edytowanego elementu. Wynik jest znormalizowany (sąsiedzi
 * o tym samym formatowaniu sklejeni), więc nadaje się do zapisu wprost.
 *
 * PUSTA lista znaczy „operator skasował treść" — wołający ma wtedy zostawić
 * poprzedni tekst, a nie zapisać pustkę, bo pusty element nie przejdzie
 * schematu i zniknąłby z płótna bez śladu.
 */
export function runsFromDom(root: Node): TextRun[] {
  const collected: TextRun[] = [];
  walk(root, {}, collected);
  return normalizeRuns(collected);
}

function walk(node: Node, format: Formatting, out: TextRun[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text.length > 0) out.push({ ...format, text });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const element = child as Element;
    if (element.tagName === "BR") {
      out.push({ ...format, text: "\n" });
      continue;
    }

    const next: Formatting = { ...format };
    if (BOLD_TAGS.has(element.tagName)) next.bold = true;
    if (ITALIC_TAGS.has(element.tagName)) next.italic = true;
    if (element.tagName === "A") {
      const href = element.getAttribute("href")?.trim();
      // Adres bierzemy JAKI JEST — o tym, czy wolno go zapisać, rozstrzyga
      // allowlista schematów w Zodzie. Druga kopia tej reguły tutaj
      // rozjechałaby się z tamtą w dniu, w którym ktoś poprawi jedną z nich.
      if (href) next.href = href;
    }

    walk(element, next, out);
  }
}

/**
 * Czy runy różnią się od tych, które element miał przed edycją. Bez tego każde
 * wejście w tekst i wyjście z niego (nawet bez zmiany) dokładałoby krok do
 * historii i wysyłało zapis.
 */
export function runsEqual(a: readonly TextRun[] | undefined, b: readonly TextRun[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((run, index) => {
    const other = right[index]!;
    return (
      run.text === other.text &&
      Boolean(run.bold) === Boolean(other.bold) &&
      Boolean(run.italic) === Boolean(other.italic) &&
      run.href === other.href
    );
  });
}
