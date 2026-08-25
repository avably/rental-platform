/**
 * SIEROTY TYPOGRAFICZNE (S-47, audyt UX 2026-08-25) — jednoliterowe spójniki
 * (a, i, o, u, w, z) nie mają prawa wisieć na końcu wiersza: „…rezerwacje
 * online, z⏎terminami" czyta się jak usterka składu, bo NIM jest.
 *
 * ==================== WARSTWA RENDERU, NIE DANYCH ====================
 *
 * Wiązanie dzieje się w chwili budowania węzłów tekstowych (nagłówki, opisy,
 * body sekcji) — treść najemcy w bazie zostaje NIETKNIĘTA. Mutowanie danych
 * oznaczałoby, że operator widzi w edytorze znaki, których nie wpisał, a każda
 * zmiana reguły wymagałaby migracji treści zamiast jednej poprawki w renderze.
 *
 * ==================== DLACZEGO TOKENY, NIE REGEX ====================
 *
 * Jedno przejście po tokenach rozstrzyga też CIĄGI spójników („…online, i w
 * weekendy"): każdy token oceniany jest osobno, więc „i" ORAZ „w" dostają
 * twardą spację bez pętli do punktu stałego, którą wymusza regex zjadający
 * separator poprzedzającego dopasowania. Lookbehind odpada z konstrukcji —
 * render idzie także do przeglądarki klienta sklepu, a reguła bez lookbehind
 * jest poprawna w każdym silniku, nie „w prawie każdym".
 *
 * Wiązana jest spacja PO spójniku (spójnik przykleja się do NASTĘPNEGO słowa)
 * — dokładnie ta, na której łamanie jest błędem. Spacji PRZED spójnikiem nie
 * ruszamy: łamanie przed nim jest poprawne.
 */

/** Litery, które w polszczyźnie bywają samodzielnym spójnikiem/przyimkiem. */
const ORPHAN_LETTERS = new Set(["a", "i", "o", "u", "w", "z"]);

/**
 * Znaki OTWIERAJĄCE, które wolno pominąć przed spójnikiem: „(w magazynie)",
 * „„i nakrycia"", pogrubienie `**w**` z SafeRichText. Zamknięty, krótki zbiór —
 * interpunkcja ZA tokenem (przecinek po „a,") znaczy, że to nie jest spójnik
 * wiszący przed swoim słowem, więc takich tokenów nie wiążemy.
 */
const OPENING_MARKS = new Set(["(", "„", "«", '"', "'", "*", "[", "”", "’"]);

/** Czy token (słowo między spacjami) jest wiszącym jednoliterowym spójnikiem. */
function isOrphanToken(token: string): boolean {
  // Twarde złamanie linii wewnątrz tokenu: spójnik liczy się od OSTATNIEJ
  // linii („…hal.\ni w zestawie" → ocenie podlega „i").
  const lastLine = token.slice(token.lastIndexOf("\n") + 1);
  let start = 0;
  while (start < lastLine.length && OPENING_MARKS.has(lastLine[start]!)) start += 1;
  const core = lastLine.slice(start);
  return core.length === 1 && ORPHAN_LETTERS.has(core.toLowerCase());
}

/**
 * Podmienia spację po każdym jednoliterowym spójniku na TWARDĄ (U+00A0).
 * Czysta funkcja tekst→tekst: nie zna znaczników, więc wołający podaje jej
 * wyłącznie zwykły tekst (pojedynczy run / linię), nigdy surowy HTML.
 */
export function bindOrphans(text: string): string {
  if (text.length < 3 || !text.includes(" ")) return text;
  const tokens = text.split(" ");
  let out = tokens[0]!;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    // Pusty token = wielokrotna spacja w treści; zostaje jak była — wiązanie
    // podwójnej spacji dawałoby U+00A0 + spację, czyli nadal łamliwą parę.
    const bind = token !== "" && isOrphanToken(tokens[index - 1]!);
    out += (bind ? "\u00A0" : " ") + token;
  }
  return out;
}
