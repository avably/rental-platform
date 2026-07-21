import { Geist } from "next/font/google";

// Sygnał operacyjny (ADR-053, delta P1a): sklep — jak panel — w całości
// w Geist Sans. Poprzednie trzy rodziny (sans, mono, serif nagłówków landing)
// usunięte zgodnie z sekcją 08 artefaktu Fazy 2 („wyłącznie Geist Sans").
const sans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const fontVariables = sans.variable;
