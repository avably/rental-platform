/**
 * Lista 39 ekranów przeglądu produktu (ADR-071) — kolejność za decyzją
 * właściciela z 2026-07-22: 1) codzienna praca operatora, 2) onboarding
 * konta, 3) onboarding konfiguracji sklepu, 4) storefront klienta,
 * 5) marketing, 6) admin.
 *
 * Prefiks numeryczny etykiety JEST kluczem sortowania „wg kolejności ekranu"
 * w widoku PM — dlatego etykieta trafia do bazy w całości („01 Dashboard"),
 * a nie jako osobny numer: uwaga zostaje czytelna nawet, gdy lista się
 * przesunie. Trasa nierozpoznana dostaje etykietę awaryjną z prefiksem 99
 * (sortuje się na końcu, ale nie ginie).
 */
import type { ReviewSurface } from "./schema";

export interface ReviewScreen {
  /** Etykieta pokazywana w pinezce/widoku PM, np. „01 Dashboard". */
  label: string;
  surface: ReviewSurface;
  /** Dopasowanie pathname BEZ prefiksu locale. Pierwsze trafienie wygrywa. */
  match: RegExp;
}

export const REVIEW_SCREENS: ReviewScreen[] = [
  // 1) Codzienna praca operatora (panel)
  { label: "01 Dashboard", surface: "panel", match: /^\/$/ },
  { label: "02 Zamówienia — lista", surface: "panel", match: /^\/zamowienia$/ },
  { label: "03 Zamówienie — nowe", surface: "panel", match: /^\/zamowienia\/nowe/ },
  { label: "04 Zamówienie — szczegół", surface: "panel", match: /^\/zamowienia\/[^/]+/ },
  { label: "05 Katalog — lista", surface: "panel", match: /^\/katalog$/ },
  { label: "06 Katalog — nowy produkt", surface: "panel", match: /^\/katalog\/nowy/ },
  // 07–09: ekran przeprowadził się spod Katalogu do Dostaw (2026-08-04).
  // Zmieniamy DOPASOWANIE, nie etykiety: numer jest kluczem sortowania i stoi
  // w bazie razem z każdą wystawioną pinezką, więc przenumerowanie rozjechałoby
  // uwagi zebrane wcześniej. Wpisy zostają PRZED „25 Ustawienia dostaw" —
  // wygrywa pierwsze trafienie, więc `/ustawienia-dostaw/punkty-odbioru` musi
  // być sprawdzone zanim złapie je szerszy wzorzec ustawień dostaw.
  { label: "07 Punkty odbioru — lista", surface: "panel", match: /^\/ustawienia-dostaw\/punkty-odbioru$/ },
  { label: "08 Punkt odbioru — nowy", surface: "panel", match: /^\/ustawienia-dostaw\/punkty-odbioru\/nowy/ },
  { label: "09 Punkt odbioru — szczegół", surface: "panel", match: /^\/ustawienia-dostaw\/punkty-odbioru\/[^/]+/ },
  { label: "10 Katalog — egzemplarze", surface: "panel", match: /^\/katalog\/[^/]+\/egzemplarze/ },
  { label: "11 Katalog — progi cenowe", surface: "panel", match: /^\/katalog\/[^/]+\/progi/ },
  { label: "12 Katalog — zdjęcia", surface: "panel", match: /^\/katalog\/[^/]+\/zdjecia/ },
  { label: "13 Katalog — produkt", surface: "panel", match: /^\/katalog\/[^/]+/ },
  { label: "14 Historia e-maili", surface: "panel", match: /^\/historia-emaili/ },

  // 2) Onboarding konta
  { label: "15 Logowanie", surface: "panel", match: /^\/login/ },
  { label: "16 Rejestracja — sprawdź skrzynkę", surface: "panel", match: /^\/register\/sprawdz-skrzynke/ },
  { label: "17 Rejestracja", surface: "panel", match: /^\/register/ },
  { label: "18 Reset hasła", surface: "panel", match: /^\/reset/ },
  { label: "19 Zaproszenie — akcept", surface: "panel", match: /^\/zaproszenie\// },
  { label: "20 Bezpieczeństwo (2FA)", surface: "panel", match: /^\/bezpieczenstwo/ },
  { label: "21 Organizacja — nowa", surface: "panel", match: /^\/organizacja\/nowa/ },
  { label: "22 Organizacja", surface: "panel", match: /^\/organizacja/ },
  { label: "23 Zaproszenia zespołu", surface: "panel", match: /^\/zaproszenia/ },

  // 3) Onboarding konfiguracji sklepu
  { label: "24 Strona sklepu", surface: "panel", match: /^\/strona/ },
  { label: "25 Ustawienia dostaw", surface: "panel", match: /^\/ustawienia-dostaw/ },
  { label: "26 Ustawienia e-maili", surface: "panel", match: /^\/ustawienia-emaili/ },
  { label: "27 Ustawienia umów", surface: "panel", match: /^\/ustawienia-umow/ },
  { label: "28 Ustawienia płatności", surface: "panel", match: /^\/ustawienia-platnosci/ },
  { label: "29 Ustawienia domen", surface: "panel", match: /^\/ustawienia-domen/ },

  // 4) Storefront klienta
  { label: "30 Sklep — katalog", surface: "storefront", match: /^\/(store)?$/ },
  { label: "31 Sklep — produkt", surface: "storefront", match: /^\/product\// },
  { label: "32 Koszyk", surface: "storefront", match: /^\/cart/ },
  { label: "33 Checkout — płatność", surface: "storefront", match: /^\/checkout\/platnosc/ },
  { label: "34 Checkout", surface: "storefront", match: /^\/checkout/ },

  // 5) Marketing (www)
  { label: "35 Landing", surface: "marketing", match: /^\/(home-b|home-c)?$/ },
  { label: "36 Cennik", surface: "marketing", match: /^\/pricing/ },
  { label: "37 FAQ", surface: "marketing", match: /^\/faq/ },
  { label: "38 Kontakt", surface: "marketing", match: /^\/contact/ },

  // 6) Admin (oś superadmina)
  { label: "39 Admin platformy", surface: "panel", match: /^\/admin/ },
];

/** Etykieta ekranu dla trasy; nierozpoznana trasa → „99 <surface> <route>". */
export function screenFor(surface: ReviewSurface, route: string): string {
  const hit = REVIEW_SCREENS.find((s) => s.surface === surface && s.match.test(route));
  return hit ? hit.label : `99 ${surface} ${route}`.slice(0, 120);
}

/** Prefiks numeryczny etykiety — klucz sortowania „wg kolejności ekranu". */
export function screenOrder(label: string): number {
  const parsed = Number.parseInt(label, 10);
  return Number.isNaN(parsed) ? 999 : parsed;
}

/** Pathname bez prefiksu locale (marketing/panel mają /en|/pl, sklep nie). */
export function stripLocale(pathname: string): string {
  const stripped = pathname.replace(/^\/(en|pl)(?=\/|$)/, "");
  return stripped === "" ? "/" : stripped;
}
