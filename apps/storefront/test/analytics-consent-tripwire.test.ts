/**
 * TRIPWIRE ZGODNOŚCI — analityka/czat nie wejdzie bez zgody i polityk.
 *
 * Decyzja właściciela (2026-08-11): GA/PostHog/Smartsupp wejdą KIEDYŚ, a
 * komplet zgodności cookies (baner zgody + polityki + załącznik
 * sub-procesorów) ma być domykany PRZY integracji — w tym samym PR. Do tego
 * czasu ŻADEN host, pakiet ani env analityki/czatu nie ma prawa istnieć
 * w kodzie. Inwentarz i wniosek prawny: notatka-cookies.md (repo operacyjne
 * starkit-system/docs/prawne/), warunek utrzymania wniosku #33.
 *
 * DLACZEGO CSP NIE JEST TU MECHANIZMEM BLOKUJĄCYM. `script-src` obu apek to
 * nonce + 'strict-dynamic' (packages/security) — skrypt z DOWOLNEGO hosta
 * dostałby się do strony, gdyby nasz layout nadał mu nonce albo gdyby
 * wstrzyknął go zaufany chunk. Snippet analityki blokuje więc wyłącznie
 * NIEOBECNOŚĆ kodu, który by go załadował. Ta suita pilnuje wszystkich dróg
 * wejścia naraz:
 *   1. hosty dostawców w JAKIMKOLWIEK pliku apki (layouty, komponenty,
 *      proxy, next.config, vercel.json, testy, public/ z vendorowanym
 *      szablonem) oraz w źródle CSP (packages/security) — skan plikowy;
 *   2. pełny inwentarz origins `https://` w źródle CSP — każdy NOWY origin
 *      (nie tylko znany dostawca analityki) wymaga świadomego wpisu tutaj;
 *   3. zależności npm (manifesty + lockfile) — snippet z paczki;
 *   4. nazwy env analityki — snippet „dodany env-em" wymaga konsumenta env,
 *      a konsument wymaga nazwy w źródle; nazwa pali test. Env bez
 *      konsumenta jest bezczynny (NEXT_PUBLIC_* inlinuje się tylko tam,
 *      gdzie jest czytany);
 *   5. pasywność lib/analytics.ts — moduł KONSUMUJE `window.posthog?.`
 *      opcjonalnym łańcuchem i nigdy klienta nie tworzy (dowód źródłowy
 *      i behawioralny).
 *
 * Wzorce zakazane są w tym pliku SKŁADANE Z KAWAŁKÓW (wzorzec
 * no-service-role-env.test.ts), żeby bramka nie łapała samej siebie — skan
 * obejmuje także katalog testów, bo host przemycony do oczekiwań innego
 * testu to przygotowanie gruntu, nie niewinność.
 *
 * Podział z bliźniaczą suitą panelu (apps/panel/test/…): TA suita skanuje
 * drzewo storefrontu, packages/security (wspólne źródło CSP), manifesty
 * całego workspace, lockfile, turbo.json, .github, scripts/ i
 * integrations/; suita panelu skanuje drzewo apps/panel.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCsp } from "@avably/security";

import { captureLandingEvent } from "@/lib/analytics";

const APP_ROOT = join(__dirname, "..");
const REPO_ROOT = join(APP_ROOT, "..", "..");
const SECURITY_INDEX = join(REPO_ROOT, "packages/security/src/index.ts");

/** Składanie wzorców z kawałków — bramka nie może łapać własnej definicji. */
const glue = (...parts: string[]): string => parts.join("");

/**
 * Inwentarz hostów analityki/czatu (dopasowanie case-insensitive, substring —
 * `eu-assets.i.…` łapie się na domenie bazowej). LISTA ROZSZERZALNA: nowy
 * dostawca = nowy wpis, nie nowy test.
 */
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

/** Sygnatury aktywacji snippetu w kodzie (case-sensitive). */
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

/**
 * Sygnatury nazw env analityki (case-sensitive, wielkie litery). Celowo BEZ
 * gołego „ANALYTICS" — `ALLOWED_ANALYTICS_PROPERTIES` w lib/analytics.ts to
 * pasywny kontrakt zdarzeń, nie aktywacja.
 */
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

/**
 * ŚWIADOMA allowlista integracji. Wpis dopisuje WYŁĄCZNIE PR, który
 * jednocześnie wnosi komplet zgodności (patrz INSTRUKCJA niżej). Wpis bez
 * choćby jednego wystąpienia w kodzie jest martwy i też pali test.
 */
const CONSENT_ALLOWLIST: ReadonlyArray<{ fragment: string; pr: string }> = [];

const INSTRUKCJA = [
  "TRIPWIRE ZGODNOŚCI (decyzja właściciela 2026-08-11, notatka-cookies.md",
  "w starkit-system/docs/prawne/, warunek #33): wykryto ślad analityki/czatu.",
  "Jeżeli INTEGRUJESZ analitykę lub czat — to jest właściwy moment, ale",
  "komplet wchodzi w TYM SAMYM PR:",
  "  1. baner zgody (opt-in PRZED załadowaniem jakiegokolwiek skryptu dostawcy),",
  "  2. aktualizacja polityki cookies i polityki prywatności,",
  "  3. aktualizacja załącznika sub-procesorów",
  "     (starkit-system/docs/prawne/zalacznik-subprocesorzy.md),",
  "  4. świadomy wpis do CONSENT_ALLOWLIST w tym teście (fragment + nr PR).",
  "Bez kompletu każde wystąpienie hosta/pakietu/env-a dostawcy jest defektem",
  "zgodności. Nie wyłączaj testu i nie zwężaj wzorców — rozszerz allowlistę.",
].join("\n");

const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", ".git", "fonts", "images"]);
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

/** Wynik skanu po odjęciu świadomej allowlisty + kontrola martwych wpisów. */
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

/** Jeden przebieg skanu na moduł — te same dane dla kilku asercji. */
function runScan(): { hits: Hit[]; visited: string[] } {
  const hits: Hit[] = [];
  const visited: string[] = [];
  // Drzewo storefrontu (Z public/ — vendorowany szablon TEŻ potrafi
  // przynieść snippet przy aktualizacji) i wspólne źródło CSP.
  walk(APP_ROOT, APP_ROOT, hits, visited);
  walk(join(REPO_ROOT, "packages/security"), REPO_ROOT, hits, visited);
  // Powierzchnie wspólne repo: manifesty, lockfile, CI, skrypty, integracje.
  for (const rootFile of ["package.json", "pnpm-workspace.yaml", "turbo.json", "pnpm-lock.yaml"]) {
    visited.push(rootFile);
    scanContent(rootFile, readFileSync(join(REPO_ROOT, rootFile), "utf8"), hits);
  }
  for (const rootDir of [".github", "scripts", "integrations"]) {
    walk(join(REPO_ROOT, rootDir), REPO_ROOT, hits, visited);
  }
  return { hits, visited };
}

describe("tripwire: analityka/czat nie wejdzie bez zgody i polityk (storefront + wspólne)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("żaden plik storefrontu, źródła CSP ani powierzchni wspólnych nie zna dostawców analityki/czatu", () => {
    const { hits } = runScan();
    const { open, dead } = applyAllowlist(hits);

    expect(open, `${INSTRUKCJA}\n\nWystąpienia:\n${formatHits(open)}`).toEqual([]);
    expect(
      dead,
      `Martwe wpisy CONSENT_ALLOWLIST (fragment bez wystąpienia w kodzie) — usuń je:\n${dead.join("\n")}`,
    ).toEqual([]);
  });

  it("skan widzi kluczowe pliki — pusty przebieg niczego nie broni", () => {
    const { visited } = runScan();
    for (const expected of [
      "proxy.ts",
      "next.config.ts",
      join("app", "[locale]", "layout.tsx"),
      join("lib", "analytics.ts"),
      join("test", "analytics-consent-tripwire.test.ts"),
      join("public", "forerunner", "js", "webflow.js"),
      join("packages", "security", "src", "index.ts"),
      "pnpm-lock.yaml",
      join(".github", "workflows", "ci.yml"),
    ]) {
      expect(visited, `skan nie odwiedził ${expected}`).toContain(expected);
    }
  });

  it("matcher łapie zasiany host i env — kontrola pozytywna czujnika", () => {
    // Zasiew przez TĘ SAMĄ funkcję dopasowania, którą skanujemy repo —
    // zielony skan po ślepym matcherze byłby fałszywie zielony.
    const seededHost: Hit[] = [];
    scanContent("seed.tsx", `<script src="https://eu.${glue("post", "hog", ".com")}/x.js" />`, seededHost);
    expect(seededHost).toHaveLength(1);

    const seededEnv: Hit[] = [];
    scanContent("seed.ts", `const k = process.env.NEXT_PUBLIC_${glue("POST", "HOG")}_KEY;`, seededEnv);
    expect(seededEnv).toHaveLength(1);
  });

  it("produkcyjna CSP z KOMPLETEM integracji nie zawiera hostów analityki/czatu", () => {
    // Wołane tak, jak woła produkcja (proxy.ts): wszystkie flagi włączone,
    // żeby żadna gałąź warunkowa nie schowała hosta przed asercją.
    const policy = buildCsp("test-nonce", {
      dev: false,
      supabaseUrl: "https://projekt.supabase.co",
      turnstile: true,
      stripe: true,
      maps: true,
      frameAncestors: ["'self'", "https:"],
    });

    // Kontrola pozytywna: flagi NAPRAWDĘ weszły — asercja o nieobecności
    // hostów analityki nie jest pusta.
    expect(policy).toContain("https://js.stripe.com");
    expect(policy).toContain("https://challenges.cloudflare.com");
    expect(policy).toContain("https://www.google.com");

    const lower = policy.toLowerCase();
    for (const host of FORBIDDEN_HOSTS) {
      expect(lower, `${INSTRUKCJA}\n\nHost w CSP: ${host}\n${policy}`).not.toContain(host);
    }
  });

  it("pełny inwentarz origins https:// w źródle CSP — nowy origin wymaga świadomej decyzji", () => {
    const source = readFileSync(SECURITY_INDEX, "utf8");
    const origins = [...new Set(source.match(/https:\/\/[a-z0-9.-]+/g) ?? [])].sort();

    expect(
      origins,
      `${INSTRUKCJA}\n\nZmienił się inwentarz origins w packages/security/src/index.ts — ` +
        `każdy nowy origin to świadoma decyzja (dla analityki/czatu: komplet zgodności j.w.).`,
    ).toEqual(
      [
        "https://api.stripe.com",
        "https://challenges.cloudflare.com",
        "https://hooks.stripe.com",
        "https://images.unsplash.com",
        "https://js.stripe.com",
        "https://www.google.com",
      ].sort(),
    );

    // Hosty CSP pochodzą WYŁĄCZNIE z literałów + jawnych opcji — moduł nie
    // czyta env, więc env nie doda origin bez zmiany źródła (którą łapie
    // inwentarz powyżej).
    expect(source).not.toContain("process.env");
  });

  it("lib/analytics.ts pozostaje pasywnym hakiem: konsumuje window.posthog, nigdy go nie tworzy", () => {
    const source = readFileSync(join(APP_ROOT, "lib", "analytics.ts"), "utf8");

    // DOKŁADNY mechanizm nieładowania: jedyny punkt styku z klientem to
    // opcjonalne wywołanie na obiekcie, który musiałby istnieć wcześniej.
    expect(source).toContain("window.posthog?.capture(");

    // Zamknięte drogi aktywacji wewnątrz modułu:
    expect(source, "analytics.ts nie ma prawa czytać env — to zamyka drogę „snippet env-em”").not.toContain(
      "process.env",
    );
    expect(source, "analytics.ts nie ma prawa TWORZYĆ klienta").not.toMatch(/window\.posthog\s*=/);
    expect(source, "analytics.ts nie ma prawa inicjalizować SDK").not.toMatch(/\.init\s*\(/);
    expect(source, "analytics.ts nie ma prawa wstrzykiwać skryptów").not.toContain("createElement");
    expect(source.toLowerCase()).not.toContain("<script");

    // Jedyny import: typy kontraktu waitlisty — pojawienie się importu SDK
    // zmienia moduł z konsumenta w ładowacz i MUSI tu zapłonąć.
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/waitlist/contract"]);
  });

  it("wywołanie eventu bez snippetu niczego nie instaluje (dowód behawioralny pasywności)", () => {
    const bareWindow: Record<string, unknown> = {};
    vi.stubGlobal("window", bareWindow);

    expect(() => captureLandingEvent("waitlist_page_view", { language: "pl" })).not.toThrow();
    // Po wywołaniu klient NADAL nie istnieje — moduł go nie dorobił.
    expect(bareWindow["posthog"]).toBeUndefined();
    expect(Object.keys(bareWindow)).toEqual([]);

    // Kontrola pozytywna haka: z klientem zdarzenie faktycznie przechodzi —
    // pasywność to „nie tworzy", nie „nie działa".
    const capture = vi.fn();
    vi.stubGlobal("window", { posthog: { capture } });
    captureLandingEvent("waitlist_page_view", { language: "pl" });
    expect(capture).toHaveBeenCalledWith("waitlist_page_view", { language: "pl" });
  });

  it("żaden manifest workspace ani lockfile nie deklaruje zależności analityki/czatu", () => {
    const manifests: string[] = [join(REPO_ROOT, "package.json"), join(REPO_ROOT, "pnpm-lock.yaml")];
    for (const group of ["apps", "packages"]) {
      for (const entry of readdirSync(join(REPO_ROOT, group))) {
        const manifest = join(REPO_ROOT, group, entry, "package.json");
        try {
          statSync(manifest);
          manifests.push(manifest);
        } catch {
          // katalog bez manifestu — pomijamy
        }
      }
    }
    // Kontrola pozytywna zbioru: manifesty obu apek muszą być na liście.
    expect(manifests.some((m) => m.includes(join("apps", "storefront")))).toBe(true);
    expect(manifests.some((m) => m.includes(join("apps", "panel")))).toBe(true);

    const hits: Hit[] = [];
    for (const manifest of manifests) {
      scanContent(relative(REPO_ROOT, manifest), readFileSync(manifest, "utf8"), hits);
    }
    const { open } = applyAllowlist(hits);
    expect(open, `${INSTRUKCJA}\n\nWystąpienia:\n${formatHits(open)}`).toEqual([]);
  });
});
