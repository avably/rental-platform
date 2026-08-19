/**
 * Bramka numeracji ADR (ADR-187) — pilnuje, żeby dwie równoległe prace nie
 * wypuściły DWÓCH RÓŻNYCH decyzji pod tym samym numerem w żywej dokumentacji
 * `docs/dokumentacja/index.html`.
 *
 * PO CO TO ISTNIEJE. 2026-08-14 dwie gałęzie dostały numer ADR-184 (jedna
 * przyszła spoza kolejki PM, więc numeru nikt nie pilnował). Kolizja wyszła
 * dopiero przy rebase drugiej gałęzi, PO merge'u pierwszej — i kosztowała
 * przenumerowanie 27 plików oraz dodatkową rundę CI. Git tego nie pokazuje:
 * gdy oba wpisy trafiają w RÓŻNE miejsca pliku, konfliktu nie ma. Duplikat
 * wychodzi wyłącznie z policzenia bloków — więc liczy je bramka, na PR-ze.
 *
 * WZORZEC JEST WSPÓLNY z resolwerem konfliktów tego pliku
 * (`resolwer-adr.py`, repo `starkit-system`): obie strony muszą liczyć TAK
 * SAMO, inaczej rozstrzygnięcie konfliktu i bramka mówiłyby o innym zbiorze.
 *
 * KONTROLA PO PUSTYM ZBIORZE JEST CZĘŚCIĄ BRAMKI, nie ozdobą. Wzorzec
 * przypięty do konkretnego HTML-a przestaje pasować przy każdej zmianie
 * szablonu — a liczenie po pustym zbiorze nie znajdzie żadnego duplikatu
 * i bramka będzie zielona NA WSZYSTKIM. Dlatego zero bloków to porażka,
 * a nie „czysto".
 *
 * WYJĄTKÓW NIE MA. Zastany duplikat ADR-007 (dwie różne decyzje pod jednym
 * numerem, dopuszczony w pierwszej wersji bramki jawną mapą ZASTANE_DUPLIKATY
 * — ADR-187 D4) został 2026-08-19 rozwiązany przenumerowaniem późniejszego
 * bloku na ADR-201. Wyjątek zniknął razem ze swoim powodem, dokładnie tak, jak
 * zapowiadał ADR-187: od tej chwili KAŻDY duplikat numeru pali bramkę.
 *
 * Użycie (zero instalacji — same moduły wbudowane Node):
 *   node scripts/audit-adr-duplikaty.mjs [ścieżka/do/index.html]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Żywa dokumentacja — jedyny plik z dziennikiem decyzji. */
export const PLIK_DOMYSLNY = fileURLToPath(
  new URL("../docs/dokumentacja/index.html", import.meta.url),
);

/**
 * Wzorzec liczenia — DOKŁADNIE ten sam, którym liczy resolwer konfliktów
 * (`<div class="log"><p class="h"><b>ADR-NNN</b>`). Zmiana tego wzorca bez
 * zmiany resolwera rozjeżdża dwa narzędzia, które muszą widzieć ten sam zbiór.
 */
export const WZORZEC_BLOKU = /<div class="log"><p class="h"><b>(ADR-\d{3})<\/b>/g;

/**
 * Ten sam blok, ale tolerancyjnie na białe znaki i atrybuty. Służy WYŁĄCZNIE
 * do kontroli przyrządu: jeśli wzorzec luźny widzi więcej bloków niż ścisły,
 * szablon HTML odjechał od wzorca liczenia i liczba z bramki przestała być
 * liczbą wszystkich wpisów. Cicha utrata części zbioru jest groźniejsza niż
 * jego utrata w całości — całość łapie kontrola po pustym zbiorze, część nie
 * łapie już nic.
 */
export const WZORZEC_LUZNY =
  /<div\s[^>]*class="log"[^>]*>\s*<p\s[^>]*class="h"[^>]*>\s*<b>\s*(ADR-\d{3})\s*<\/b>/g;

/** Numery ADR w kolejności wystąpienia, wyłuskane podanym wzorcem. */
export function numeryAdr(tresc, wzorzec = WZORZEC_BLOKU) {
  return [...String(tresc).matchAll(new RegExp(wzorzec.source, "g"))].map((t) => t[1]);
}

/** Zliczenie wystąpień każdego numeru. */
export function policz(numery) {
  const licznik = new Map();
  for (const numer of numery) licznik.set(numer, (licznik.get(numer) ?? 0) + 1);
  return licznik;
}

/**
 * Werdykt bramki dla treści pliku.
 *
 * @param {string} tresc zawartość `docs/dokumentacja/index.html`
 * @returns {{ blokow: number, unikalnych: number, problemy: string[] }}
 */
export function zbadaj(tresc) {
  const numery = numeryAdr(tresc, WZORZEC_BLOKU);
  const luzne = numeryAdr(tresc, WZORZEC_LUZNY);
  const licznik = policz(numery);
  const problemy = [];

  // Kontrola po pustym zbiorze — patrz nagłówek pliku.
  if (numery.length === 0) {
    problemy.push(
      "wzorzec nie znalazł ANI JEDNEGO bloku ADR — to nie znaczy „bez duplikatów”, " +
        "tylko że wzorzec przestał pasować do pliku (zmiana szablonu HTML?). " +
        `Oczekiwany kształt: ${WZORZEC_BLOKU.source}`,
    );
    return { blokow: 0, unikalnych: 0, problemy };
  }

  // Kontrola przyrządu — wzorzec ścisły musi widzieć CAŁY zbiór, nie jego część.
  if (luzne.length > numery.length) {
    problemy.push(
      `wzorzec ścisły widzi ${numery.length} bloków, a luźny ${luzne.length} — ` +
        "szablon HTML odjechał od wzorca liczenia, więc bramka liczy już tylko " +
        "część wpisów. Zrównaj wzorzec z plikiem (i z resolwerem konfliktów).",
    );
  }

  const najwyzszy = [...licznik.keys()].sort().at(-1);
  for (const [numer, ile] of [...licznik].sort()) {
    if (ile === 1) continue;
    problemy.push(
      `${numer}: ${ile} bloki pod tym samym numerem — dwie prace dostały ten sam ` +
        `numer ADR. Nadaj nowszej pierwszy wolny (najwyższy zajęty: ${najwyzszy}) ` +
        "i przenumeruj jej wpisy w kodzie, dokumentacji i tytułach commitów.",
    );
  }

  return { blokow: numery.length, unikalnych: licznik.size, problemy };
}

function main() {
  const sciezka = process.argv[2] ?? PLIK_DOMYSLNY;
  const { blokow, unikalnych, problemy } = zbadaj(readFileSync(sciezka, "utf8"));

  process.stdout.write(`Bramka numeracji ADR — ${sciezka}\n`);
  process.stdout.write(`  bloków: ${blokow}, unikalnych numerów: ${unikalnych}\n`);
  if (problemy.length === 0) {
    process.stdout.write("  WERDYKT: numeracja bez kolizji\n");
    return 0;
  }
  for (const problem of problemy) process.stderr.write(`  BŁĄD: ${problem}\n`);
  process.stderr.write(`WERDYKT: bramka numeracji ADR odmawia — ${problemy.length} problem(ów)\n`);
  return 1;
}

// Uruchomienie jako CLI (import w teście tego nie odpala). W odróżnieniu od
// klasyfikatora kosztów ta bramka jest FAIL-CLOSED: każdy błąd — z brakiem
// pliku włącznie — kończy się czerwienią, bo brak odczytu to brak dowodu.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main());
  } catch (error) {
    process.stderr.write(`BŁĄD bramki numeracji ADR: ${error?.message ?? error}\n`);
    process.exit(1);
  }
}
