/**
 * Motyw jasny/ciemny panelu (ADR-059).
 *
 * ADR-053 zamknął P1 zdaniem „tokeny `.dark` są w arkuszu, ale przełącznika
 * dark mode w UI NIE MA — to osobna decyzja właściciela". Decyzja zapadła
 * 2026-07-21 i jest ODWRÓCENIEM tamtego stanu: panel dostaje przełącznik.
 *
 * MECHANIKA BEZ NOWYCH ZALEŻNOŚCI: klasa `dark` na `<html>` (wariant, którego
 * używa Tailwind i arkusz `@avably/ui`), wybór trwały w ciasteczku, wartość
 * domyślna z `prefers-color-scheme`.
 *
 * DLACZEGO CIASTECZKO, A NIE localStorage: skrypt startowy musi ustawić klasę
 * PRZED pierwszym malowaniem, inaczej ciemny motyw mrugnie bielą. Ciasteczko
 * czyta się synchronicznie tak samo jak localStorage, ale zostaje w domenie
 * i jest widoczne dla serwera, gdy kiedyś zajdzie potrzeba renderu
 * świadomego motywu. Nie jest poświadczeniem — nie ma w nim nic wrażliwego,
 * więc `HttpOnly` byłoby tu tylko przeszkodą (skrypt musi je czytać).
 */

export const THEME_COOKIE = "avably-theme";
export const THEME_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type Theme = "light" | "dark";

/**
 * Skrypt uruchamiany PRZED hydracją, w `<head>`.
 *
 * Pod CSP `strict-dynamic` (ADR-012) każdy tag `<script>` musi nieść nonce
 * żądania — bez niego przeglądarka odmówi wykonania i motyw wracałby do
 * jasnego przy każdym wejściu.
 *
 * Skrypt USTAWIA TEŻ `data-theme`, żeby przełącznik po hydracji wiedział, od
 * czego zaczyna, bez powtarzania tu logiki odczytu ciasteczka.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)/);
var t=m?m[1]:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
var r=document.documentElement;
r.dataset.theme=t;
r.classList.toggle('dark',t==='dark');
}catch(e){}})();`;
