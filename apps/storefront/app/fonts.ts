import localFont from "next/font/local";

/*
 * Sygnał operacyjny (ADR-053, delta P1a): sklep — jak panel — w całości
 * w Geist Sans. Poprzednie trzy rodziny (sans, mono, serif nagłówków landing)
 * usunięte zgodnie z sekcją 08 artefaktu Fazy 2 („wyłącznie Geist Sans").
 *
 * KRÓJ Z REPOZYTORIUM, NIE Z SIECI (dziennik 2026-08-12) — ten sam plik, co
 * w panelu, i z tego samego powodu: krój pobierany w czasie budowania wiąże
 * powodzenie buildu z dostępnością cudzego CDN-u. 2026-08-12 awaria
 * `fonts.gstatic.com` wywróciła CI dwa razy przy commicie, który później
 * zbudował się bez żadnej zmiany. Kroje stron najemców leżą u nas od ADR-090;
 * krój powłoki dołącza do nich.
 *
 * `weight: "400 600"` odwzorowuje poprzedni stan: serwowany był ten sam plik
 * zmienny w trzech deklaracjach (400/500/600), więc `font-bold` (700)
 * rozstrzygał się do najbliższej dostępnej — 600.
 */
const sans = localFont({
  src: "../../../packages/ui/fonts/geist-variable.woff2",
  variable: "--font-geist-sans",
  weight: "400 600",
  style: "normal",
  display: "swap",
});

export const fontVariables = sans.variable;
