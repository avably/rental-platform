/**
 * `rel` LINKÓW WYCHODZĄCYCH NA ŻYWEJ ŚCIEŻCE (E1, ADR-094 — sprzątanie z audytu).
 *
 * Wada, którą ta funkcja zamyka: element `button` płótna v2 renderował `<a>`
 * BEZ `rel`, a jego adres pochodzi od najemcy i bywa absolutny. Link do obcego
 * hosta bez `rel="noopener"` daje stronie docelowej `window.opener` — czyli
 * uchwyt do karty sklepu naszego klienta. `noreferrer` dokłada drugą połowę:
 * obcy host nie dostaje adresu podstrony, z której klient wyszedł.
 *
 * DLACZEGO NIE „ZAWSZE": `rel` na kotwicy (`#kontakt`) i na ścieżce własnej
 * (`/store`) nie chroni przed niczym, a zaśmieca znaczniki i myli przy czytaniu
 * różnicy. Rozstrzyga więc CEL, a nie miejsce w kodzie — i rozstrzyga to jedna
 * funkcja, żeby „prawie tak samo" nie powtórzyło się w sześciu komponentach.
 *
 * `mailto:`/`tel:` są poza zakresem: nie otwierają karty przeglądarki, więc nie
 * ma tam ani `opener`, ani referrera. Zwracamy `undefined`, czyli brak atrybutu.
 */
export const EXTERNAL_LINK_REL = "noopener noreferrer";

export function externalLinkRel(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const value = href.trim();
  // Kotwica i ścieżka własna zostają bez `rel` — to ta sama strona.
  if (value.startsWith("#") || value.startsWith("/")) return undefined;
  // Protokół inny niż http(s) (mailto, tel) nie otwiera karty.
  return /^https?:\/\//i.test(value) ? EXTERNAL_LINK_REL : undefined;
}
