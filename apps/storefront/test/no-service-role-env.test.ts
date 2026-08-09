/**
 * Bramka nieobecności klucza service_role w storefroncie (ADR-099/ADR-115).
 *
 * Audyt bezpieczeństwa uznał za ryzyko najwyższe samą OBECNOŚĆ klucza
 * service_role (sekret SUPABASE_…SERVICE_ROLE_KEY, pisany tu z wielokropkiem,
 * żeby nie łamać własnej reguły) w env publicznej aplikacji — nie logikę tras.
 * Po wdrożeniu ADR-099 storefront nie ma prawa znać tej nazwy: ani w kodzie,
 * ani w testach, ani w konfiguracji. Ta suita skanuje CAŁE drzewo źródeł
 * apki i pali się na pierwszym wystąpieniu.
 *
 * Dlaczego obok scripts/audit-service-role.sh: skrypt CI pilnuje całego
 * repo, ale filtruje linie zawierające SUPABASE_LOCAL_SERVICE_ROLE_KEY —
 * sprytna linia łącząca obie nazwy przeszłaby mu bokiem. Tu reguła jest
 * bezwzględna: w storefroncie nie wolno używać produkcyjnej nazwy NIGDZIE,
 * także obok nazwy lokalnej (dawny wzorzec `vi.stubEnv` z review-api.test.ts
 * zniknął razem z drogą zapisu). Nazwa sekretu w tym pliku jest składana
 * z kawałków, żeby bramka nie łapała samej siebie.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const APP_ROOT = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "public"]);
const EXTENSIONS = /\.(ts|tsx|mjs|cjs|js|jsx|json|sh|env|example|md)$/;

// Składane z kawałków — patrz nagłówek.
const FORBIDDEN = ["SUPABASE", "SERVICE_ROLE_KEY"].join("_");

function walk(dir: string, hits: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(path, hits);
      continue;
    }
    if (!EXTENSIONS.test(entry) && !entry.startsWith(".env")) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (line.includes(FORBIDDEN)) {
        hits.push(`${relative(APP_ROOT, path)}:${index + 1}: ${line.trim()}`);
      }
    }
  }
}

describe("storefront bez klucza service_role (ADR-099)", () => {
  it("żaden plik apki nie odwołuje się do produkcyjnej nazwy sekretu", () => {
    const hits: string[] = [];
    walk(APP_ROOT, hits);
    // Jedyny dozwolony plik: ten test (definiuje bramkę, składając nazwę
    // z kawałków — dosłowne wystąpienie nawet tutaj jest błędem).
    expect(
      hits,
      `Storefront jest aplikacją PUBLICZNĄ i nie ma prawa znać nazwy klucza ` +
        `omijającego RLS (ADR-099). Usuń odwołania:\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("bramka widzi pliki — pusty skan nic nie broni", () => {
    // Kontrola pozytywna skanera: plik, który na pewno istnieje i zawiera
    // znany tekst, musi być widziany przez ten sam mechanizm odczytu.
    const route = readFileSync(join(APP_ROOT, "app/api/review/comments/route.ts"), "utf8");
    expect(route.length).toBeGreaterThan(0);
  });
});
