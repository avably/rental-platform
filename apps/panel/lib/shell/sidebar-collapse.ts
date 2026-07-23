/**
 * Zwijanie sidebara panelu do paska ikon (uwaga przeglądu właściciela,
 * 2026-07-23).
 *
 * BEZ MIGRACJI I BEZ BAZY: preferencja „zwinięty / rozwinięty" to wyłącznie
 * stan interfejsu jednego urządzenia, więc mieszka w `localStorage`, nie w
 * kolumnie tenanta. Domyślnie ROZWINIĘTY — pierwsze wejście pokazuje pełne
 * etykiety, zwinięcie jest świadomym wyborem, nie zaskoczeniem.
 *
 * DLACZEGO ATRYBUT NA <html>, A NIE STAN REACTA: szerokość paska i widoczność
 * znaku marki wiszą na elementach renderowanych po stronie serwera (`<aside>`
 * w layoucie), które nie przerysowują się przy zmianie stanu klienta. Skrypt
 * startowy ustawia `data-sidebar` na `<html>` PRZED pierwszym malowaniem, a
 * CSS (wariant `sidebar-collapsed:`) reaguje na atrybut bez udziału Reacta —
 * dzięki temu pasek nie mruga szerokością przy przeładowaniu strony, dokładnie
 * jak motyw nie mruga bielą (ADR-059). Ten sam atrybut czyta hook nawigacji,
 * więc treść (etykiety kontra tooltipy) i geometria mają JEDNO źródło prawdy.
 *
 * Wzorzec skopiowany z `lib/theme.ts`; różnica jest jedna i celowa: motyw
 * trzyma wybór w ciasteczku (bo serwer może go kiedyś potrzebować do renderu),
 * a zwinięcie sidebara jest czysto klienckie i nie ma powodu opuszczać
 * przeglądarki — stąd `localStorage`, zgodnie z decyzją „bez migracji".
 */

export const SIDEBAR_STORAGE_KEY = "avably-sidebar";
export const SIDEBAR_EVENT = "avably:sidebar";
export const SIDEBAR_ATTRIBUTE = "sidebar";

export type SidebarState = "expanded" | "collapsed";

/** Stan z surowej wartości magazynu — wszystko poza `"collapsed"` to rozwinięty. */
export function sidebarStateFrom(raw: string | null | undefined): SidebarState {
  return raw === "collapsed" ? "collapsed" : "expanded";
}

/**
 * Skrypt uruchamiany PRZED hydracją, na początku powłoki panelu.
 *
 * Pod CSP `strict-dynamic` (ADR-012) tag `<script>` musi nieść nonce żądania —
 * bez niego przeglądarka odmówi wykonania i pasek wracałby do rozwiniętego
 * przy każdym wejściu. Odczyt `localStorage` jest synchroniczny, więc atrybut
 * jest na miejscu, zanim `<aside>` zostanie sparsowany i pomalowany.
 */
export const SIDEBAR_BOOTSTRAP_SCRIPT = `(function(){try{
var s=localStorage.getItem('${SIDEBAR_STORAGE_KEY}');
document.documentElement.dataset.${SIDEBAR_ATTRIBUTE}=(s==='collapsed')?'collapsed':'expanded';
}catch(e){}})();`;
