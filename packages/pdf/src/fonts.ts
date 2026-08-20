import { Font } from "@react-pdf/renderer";

import {
  ROBOTO_BOLD_TTF_BASE64,
  ROBOTO_ITALIC_TTF_BASE64,
  ROBOTO_REGULAR_TTF_BASE64,
} from "./fonts-data";

// Roboto (Latin Extended) — pełna obsługa polskich znaków. Wbudowana Helvetica
// @react-pdf używa kodowania WinAnsi bez ł/ą/ę/ż/ś/ć/ń/ź, więc bez własnego
// fontu polski tekst gubiłby glify (i psuł ekstrakcję tekstu).
//
// Bajty czcionek są OSADZONE w module (`fonts-data.ts`, base64) i podawane do
// silnika jako data-URI — NIE jako ścieżka pliku. To świadoma decyzja z ADR-220:
// na Vercelu (`next build` = Turbopack) tracer `@vercel/nft` nie wykrywał
// dynamicznej ścieżki `fs`, więc `.ttf` nie trafiały do funkcji serverless i
// render umowy padał na `ENOENT Roboto-Regular.ttf`. `@react-pdf/font@4.0.8` dla
// `src` będącego data-URI dekoduje base64 przez `fontkit.create` — bez żadnego
// odczytu z dysku, więc render jest niezależny od tracingu i układu bundla.
//
// Źródłem prawdy zostają pliki `packages/pdf/assets/fonts/*.ttf`; moduł
// `fonts-data.ts` jest z nich GENEROWANY (`scripts/generate-pdf-fonts-data.mjs`)
// i pilnowany testem `test/fonts-data.test.ts`.
const dataUri = (base64: string): string => `data:font/ttf;base64,${base64}`;

let registered = false;

/**
 * Rejestruje rodzinę „Roboto" w silniku @react-pdf. Idempotentna — wielokrotne
 * wywołanie (np. render EN i PL w jednym procesie testowym) rejestruje raz.
 */
export function registerFonts(): void {
  if (registered) return;

  Font.register({
    family: "Roboto",
    fonts: [
      { src: dataUri(ROBOTO_REGULAR_TTF_BASE64), fontWeight: 400 },
      { src: dataUri(ROBOTO_BOLD_TTF_BASE64), fontWeight: 700 },
      { src: dataUri(ROBOTO_ITALIC_TTF_BASE64), fontWeight: 400, fontStyle: "italic" },
    ],
  });

  // Bez hyphenacji — domyślny callback łamie polskie słowa w dowolnym miejscu.
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}
