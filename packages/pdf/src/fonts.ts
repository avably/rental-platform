import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Font } from "@react-pdf/renderer";

// Roboto (Latin Extended) — pełna obsługa polskich znaków. Fonty leżą w pakiecie
// (`assets/fonts/`) i są ROZWIĄZYWANE względem tego modułu, nie względem
// `process.cwd()` — pakiet nie zakłada, z jakiego katalogu go uruchomiono.
// Wbudowana Helvetica @react-pdf używa kodowania WinAnsi bez ł/ą/ę/ż/ś/ć/ń/ź,
// więc bez własnego fontu polski tekst gubiłby glify (i psuł ekstrakcję tekstu).
const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");

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
      { src: join(fontsDir, "Roboto-Regular.ttf"), fontWeight: 400 },
      { src: join(fontsDir, "Roboto-Bold.ttf"), fontWeight: 700 },
      { src: join(fontsDir, "Roboto-Italic.ttf"), fontWeight: 400, fontStyle: "italic" },
    ],
  });

  // Bez hyphenacji — domyślny callback łamie polskie słowa w dowolnym miejscu.
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}
