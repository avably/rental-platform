/**
 * Manifest doboru plików paczki wtyczki WordPress (M2, ADR-110).
 *
 * DOBÓR JEST LISTĄ DOZWOLONYCH: do archiwum wjeżdża wyłącznie plik pasujący
 * do `RUNTIME_ALLOWLIST`. Poprzedni dobór blacklistą przepuszczał wszystko,
 * czego wzorzec nie znał — podłożony `.env` z kluczem API wjeżdżał do paczki
 * przy zielonej suicie i jechał na serwer WordPressa każdego najemcy
 * (recenzja PM #212, dowiedzione odczytem sekretów z rozpakowanych bajtów).
 *
 * TRZECIEJ KATEGORII NIE MA: plik, który nie pasuje ani do listy dozwolonych,
 * ani do nazwanej listy wykluczeń dev, PALI budowę (recepta odmawia głośno).
 * Dzięki temu lista zbyt wąska nie zgubi nowego pliku runtime po cichu —
 * dołożenie pliku wymaga świadomej decyzji: wzorzec w allowlist (jedzie do
 * najemców) albo wpis w wykluczeniach (zostaje rusztowaniem dev).
 *
 * Manifest importują OBIE strony: recepta `scripts/build-wp-plugin-zip.mjs`
 * i bramka `apps/panel/test/wordpress-plugin-package.test.ts` (ta liczy
 * inwariant kompletności niezależnie od recepty).
 */

/** Wzorce plików RUNTIME — dokładnie to, co ma stanąć na serwerze najemcy. */
export const RUNTIME_ALLOWLIST = [
  "avably-booking.php",
  "uninstall.php",
  "readme.txt",
  "README.md",
  "includes/*.php",
  "assets/*.css",
  "assets/*.js",
  "blocks/**/*.json",
  "blocks/**/*.js",
  "blocks/**/*.php",
  "blocks/**/*.css",
  "languages/*.po",
  "languages/*.mo",
  "languages/*.pot",
];

/**
 * Jawna, nazwana lista wykluczeń — rusztowanie deweloperskie, które ŚWIADOMIE
 * nie jedzie do paczki. Wpis tutaj to decyzja, nie efekt uboczny wzorca.
 */
export const DEV_EXCLUSIONS = [
  "dev/**",
  "tests/**",
  "phpunit.xml.dist",
  ".gitignore",
  ".phpunit.result.cache",
  "**/.DS_Store",
  "node_modules/**",
];

/**
 * Wzorzec → RegExp: `*` nie przekracza ukośnika, `**` i skraca dowolnie wiele
 * katalogów. Zbiór operatorów celowo minimalny (bez nawiasów, negacji i klas)
 * — manifest ma być czytelny w recenzji, nie ekspresyjny.
 */
export function patternToRegExp(pattern) {
  let source = "";
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      source += "(?:[^/]+/)*"; // zero lub więcej pełnych segmentów katalogów
      index += 3;
    } else if (pattern.startsWith("**", index)) {
      source += ".*"; // wszystko poniżej, z ukośnikami włącznie
      index += 2;
    } else if (pattern[index] === "*") {
      source += "[^/]*"; // dowolna nazwa, ale bez schodzenia w podkatalogi
      index += 1;
    } else {
      source += pattern[index].replace(/[.+^${}()|[\]\\]/, "\\$&");
      index += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

/** Czy ścieżka (względna, z `/` jako separatorem) pasuje do któregoś wzorca. */
export function matchesAny(path, patterns) {
  return patterns.some((pattern) => patternToRegExp(pattern).test(path));
}
