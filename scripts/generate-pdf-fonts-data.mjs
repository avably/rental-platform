// Generator modułu z bajtami czcionek umowy jako base64 (Option B, ADR-220).
//
// Powód istnienia: na Vercelu (`next build` = Turbopack) tracer `@vercel/nft`
// NIE wykrywa dynamicznej ścieżki `fs`, którą `@react-pdf/font` czytał z dysku
// (`packages/pdf/assets/fonts/*.ttf`), więc pliki nie trafiały do bundla funkcji
// serverless i render umowy padał na `ENOENT Roboto-Regular.ttf`.
// `outputFileTracingIncludes` jest w tej wersji Next NIE-DZIAŁAJĄCE pod
// Turbopackiem (build zwraca `buildTraceContext: undefined`, więc krok
// dołączania include'ów nigdy się nie wykonuje) — dlatego bajty czcionek
// osadzamy w module JS jako data-URI. `@react-pdf/font@4.0.8` dekoduje data-URI
// przez `fontkit.create`, bez żadnego dostępu do dysku w runtime.
//
// ŹRÓDŁO PRAWDY zostaje w `packages/pdf/assets/fonts/*.ttf` — ten skrypt tylko
// je koduje. Regeneracja po podmianie czcionki:
//   node scripts/generate-pdf-fonts-data.mjs
// Zgodność wygenerowanego modułu z plikami `.ttf` pilnuje test
// `packages/pdf/test/fonts-data.test.ts` (base64 z dysku === stałe w module).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(here, "..", "packages", "pdf", "assets", "fonts");
const outFile = join(here, "..", "packages", "pdf", "src", "fonts-data.ts");

// Kolejność i nazwy stałych są kontraktem `fonts.ts`.
const FONTS = [
  { file: "Roboto-Regular.ttf", constName: "ROBOTO_REGULAR_TTF_BASE64" },
  { file: "Roboto-Bold.ttf", constName: "ROBOTO_BOLD_TTF_BASE64" },
  { file: "Roboto-Italic.ttf", constName: "ROBOTO_ITALIC_TTF_BASE64" },
];

function encode(file) {
  return readFileSync(join(fontsDir, file)).toString("base64");
}

const header = `// AUTOGENEROWANE — NIE EDYTUJ RĘCZNIE.
//
// Źródło prawdy: packages/pdf/assets/fonts/*.ttf
// Regeneracja:   node scripts/generate-pdf-fonts-data.mjs
// Uzasadnienie:  ADR-220 (czcionki umowy w bundlu serverless jako data-URI).
//
// Bajty trzech czcionek Roboto (Regular/Bold/Italic) w base64. Osadzone w module,
// bo tracer Vercela nie dołączał plików .ttf do funkcji serverless (dynamiczna
// ścieżka fs), a outputFileTracingIncludes nie działa pod Turbopackiem w Next 16.
`;

const body = FONTS.map(
  ({ file, constName }) => `\n// ${file}\nexport const ${constName} =\n  "${encode(file)}";\n`,
).join("");

writeFileSync(outFile, `${header}${body}`, "utf8");

const sizes = FONTS.map(({ file }) => `${file}=${encode(file).length}B`).join(", ");
// eslint-disable-next-line no-console
console.log(`fonts-data.ts zapisany (${outFile}). Base64: ${sizes}`);
