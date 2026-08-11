/**
 * TRIPWIRE ZGODNOŚCI — analityka/czat nie wejdzie bez zgody i polityk (panel).
 *
 * Bliźniacza suita apps/storefront/test/analytics-consent-tripwire.test.ts —
 * tam pełne uzasadnienie (decyzja właściciela 2026-08-11, notatka-cookies.md
 * w starkit-system docs/prawne/, warunek #33) oraz skan powierzchni
 * WSPÓLNYCH: packages/security (jedyne źródło CSP obu apek — panel woła ten
 * sam `buildCsp`, więc host dopisany tam wszedłby także do panelu),
 * manifesty workspace, lockfile, .github, scripts/, integrations/.
 *
 * TA suita pilnuje drzewa apps/panel: layoutów, komponentów, proxy.ts,
 * next.config.ts, vercel.json ORAZ katalogu testów (host przemycony do
 * oczekiwań testu to przygotowanie gruntu). Suity apek celowo nie
 * współdzielą kodu (wzorzec helpers/integration-env.ts) — zmiany wzorców
 * wprowadzać w obu plikach.
 *
 * CSP nie jest mechanizmem blokującym: script-src = nonce + 'strict-dynamic',
 * więc snippet z nonce'em layoutu wykonałby się z dowolnego hosta. Blokadą
 * jest NIEOBECNOŚĆ kodu ładującego — i jej pilnują te skany.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCsp } from "@avably/security";

const APP_ROOT = join(__dirname, "..");

/** Składanie wzorców z kawałków — bramka nie może łapać własnej definicji. */
const glue = (...parts: string[]): string => parts.join("");

/** Inwentarz hostów analityki/czatu — lustro listy ze suity storefrontu. */
const FORBIDDEN_HOSTS: readonly string[] = [
  glue("post", "hog", ".com"),
  glue("google-", "analytics", ".com"),
  glue("googletag", "manager", ".com"),
  glue("analytics.", "google", ".com"),
  glue("smart", "supp", ".com"),
  glue("hot", "jar", ".com"),
  glue("clari", "ty", ".ms"),
  glue("double", "click", ".net"),
  glue("mix", "panel", ".com"),
  glue("ampli", "tude", ".com"),
  glue("mato", "mo"),
  glue("plausi", "ble", ".io"),
  glue("full", "story", ".com"),
  glue("inter", "com", ".io"),
  glue("crisp", ".chat"),
  glue("tawk", ".to"),
  glue("livechat", "inc", ".com"),
  glue("hs-", "scripts", ".com"),
];

/** Sygnatury aktywacji snippetu (case-sensitive). */
const FORBIDDEN_ACTIVATIONS: readonly string[] = [
  glue("post", "hog", "-js"),
  glue("@post", "hog/"),
  glue("post", "hog", ".init"),
  glue("window.", "data", "Layer"),
  glue("@next/", "third-", "parties"),
  glue("@microsoft/", "clari", "ty"),
  glue("@hot", "jar/"),
  glue("_smart", "supp"),
];

/** Sygnatury nazw env analityki (case-sensitive, wielkie litery). */
const FORBIDDEN_ENV_NAMES: readonly string[] = [
  glue("POST", "HOG"),
  glue("GOOGLE_", "ANALYTICS"),
  glue("GTM", "_"),
  glue("SMART", "SUPP"),
  glue("HOT", "JAR"),
  glue("CLARI", "TY_"),
  glue("ANALYTICS", "_KEY"),
  glue("ANALYTICS", "_ID"),
  glue("ANALYTICS", "_HOST"),
  glue("ANALYTICS", "_ORIGIN"),
  glue("ANALYTICS", "_URL"),
];

/** Świadoma allowlista integracji — wpis wyłącznie z kompletem zgodności. */
const CONSENT_ALLOWLIST: ReadonlyArray<{ fragment: string; pr: string }> = [];

const INSTRUKCJA = [
  "TRIPWIRE ZGODNOŚCI (decyzja właściciela 2026-08-11, notatka-cookies.md",
  "w starkit-system docs/prawne/, warunek #33): wykryto ślad analityki/czatu.",
  "Jeżeli INTEGRUJESZ analitykę lub czat — to jest właściwy moment, ale",
  "komplet wchodzi w TYM SAMYM PR:",
  "  1. baner zgody (opt-in PRZED załadowaniem jakiegokolwiek skryptu dostawcy),",
  "  2. aktualizacja polityki cookies i polityki prywatności,",
  "  3. aktualizacja załącznika sub-procesorów",
  "     (starkit-system docs/prawne/zalacznik-subprocesorzy.md),",
  "  4. świadomy wpis do CONSENT_ALLOWLIST w tym teście (fragment + nr PR).",
  "Bez kompletu każde wystąpienie hosta/pakietu/env-a dostawcy jest defektem",
  "zgodności. Nie wyłączaj testu i nie zwężaj wzorców — rozszerz allowlistę.",
].join("\n");

const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", ".git"]);
const EXTENSIONS = /\.(ts|tsx|mjs|cjs|mts|js|jsx|json|sh|yml|yaml|md|html|css|txt|env|example)$/;

interface Hit {
  file: string;
  line: number;
  fragment: string;
  text: string;
}

function scanContent(file: string, content: string, hits: Hit[]): void {
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    const lower = line.toLowerCase();
    for (const fragment of FORBIDDEN_HOSTS) {
      if (lower.includes(fragment)) {
        hits.push({ file, line: index + 1, fragment, text: line.trim().slice(0, 160) });
      }
    }
    for (const fragment of [...FORBIDDEN_ACTIVATIONS, ...FORBIDDEN_ENV_NAMES]) {
      if (line.includes(fragment)) {
        hits.push({ file, line: index + 1, fragment, text: line.trim().slice(0, 160) });
      }
    }
  }
}

function walk(dir: string, root: string, hits: Hit[], visited: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(path, root, hits, visited);
      continue;
    }
    if (!EXTENSIONS.test(entry) && !entry.startsWith(".env")) continue;
    const file = relative(root, path);
    visited.push(file);
    scanContent(file, readFileSync(path, "utf8"), hits);
  }
}

function applyAllowlist(hits: Hit[]): { open: Hit[]; dead: string[] } {
  const used = new Set<string>();
  const open = hits.filter((hit) => {
    const entry = CONSENT_ALLOWLIST.find((candidate) => hit.fragment === candidate.fragment);
    if (entry) used.add(entry.fragment);
    return !entry;
  });
  const dead = CONSENT_ALLOWLIST.filter((entry) => !used.has(entry.fragment)).map(
    (entry) => entry.fragment,
  );
  return { open, dead };
}

function formatHits(hits: Hit[]): string {
  return hits.map((h) => `${h.file}:${h.line} [${h.fragment}] ${h.text}`).join("\n");
}

describe("tripwire: analityka/czat nie wejdzie bez zgody i polityk (panel)", () => {
  it("żaden plik panelu nie zna dostawców analityki/czatu", () => {
    const hits: Hit[] = [];
    const visited: string[] = [];
    walk(APP_ROOT, APP_ROOT, hits, visited);

    const { open, dead } = applyAllowlist(hits);
    expect(open, `${INSTRUKCJA}\n\nWystąpienia:\n${formatHits(open)}`).toEqual([]);
    expect(
      dead,
      `Martwe wpisy CONSENT_ALLOWLIST (fragment bez wystąpienia w kodzie) — usuń je:\n${dead.join("\n")}`,
    ).toEqual([]);
  });

  it("skan widzi kluczowe pliki — pusty przebieg niczego nie broni", () => {
    const hits: Hit[] = [];
    const visited: string[] = [];
    walk(APP_ROOT, APP_ROOT, hits, visited);

    for (const expected of [
      "proxy.ts",
      "next.config.ts",
      "vercel.json",
      "package.json",
      join("app", "[locale]", "layout.tsx"),
      join("test", "analytics-consent-tripwire.test.ts"),
    ]) {
      expect(visited, `skan nie odwiedził ${expected}`).toContain(expected);
    }
  });

  it("matcher łapie zasiany host i env — kontrola pozytywna czujnika", () => {
    const seededHost: Hit[] = [];
    scanContent(
      "seed.tsx",
      `<script src="https://eu.${glue("post", "hog", ".com")}/x.js" />`,
      seededHost,
    );
    expect(seededHost).toHaveLength(1);

    const seededEnv: Hit[] = [];
    scanContent("seed.ts", `const k = process.env.NEXT_PUBLIC_${glue("POST", "HOG")}_KEY;`, seededEnv);
    expect(seededEnv).toHaveLength(1);
  });

  it("CSP panelu (kształt z proxy.ts, wszystkie flagi) nie zawiera hostów analityki/czatu", () => {
    // Kształt produkcyjny panelu: dev=false, supabaseUrl, turnstile — plus
    // WSZYSTKIE pozostałe flagi buildCsp, żeby żadna gałąź warunkowa nie
    // schowała hosta przed asercją (panel woła ten sam moduł co storefront).
    const policy = buildCsp("test-nonce", {
      dev: false,
      supabaseUrl: "https://projekt.supabase.co",
      turnstile: true,
      stripe: true,
      maps: true,
    });

    // Kontrola pozytywna — flagi naprawdę weszły:
    expect(policy).toContain("https://challenges.cloudflare.com");
    expect(policy).toContain("https://js.stripe.com");

    const lower = policy.toLowerCase();
    for (const host of FORBIDDEN_HOSTS) {
      expect(lower, `${INSTRUKCJA}\n\nHost w CSP: ${host}\n${policy}`).not.toContain(host);
    }
  });
});
