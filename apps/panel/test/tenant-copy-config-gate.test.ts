import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  COURIER_CONFIG_KEYS,
  DELIVERY_PRICING_KEY,
  EMAIL_SENDER_KEY,
  GLOBKURIER_PASSWORD_SECRET_KEY,
} from "@avably/core";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

/**
 * Bramka U1 (audyt UX 2026-08-08, wniosek W3): komunikaty widoczne dla
 * NAJEMCY nie mają prawa zawierać nazw zmiennych środowiskowych ani nazw
 * kluczy ustawień. Nazwa zmiennej w interfejsie to dla operatora
 * wypożyczalni szum, którego nie umie zinterpretować — a dla napastnika
 * mapa infrastruktury platformy.
 *
 * CO SKANUJEMY (dwie powierzchnie):
 *   1. WSZYSTKIE wartości słowników messages/{pl,en}.json.
 *   2. Literały stringów i teksty JSX w kodzie ekranów najemcy —
 *      katalog `app/[locale]/(panel)`, bez plików testowych.
 *
 * JAK SKANUJEMY KOD: przez AST TypeScriptu, nie po surowym tekście pliku.
 * Komentarze LEGALNIE wspominają zmienne środowiskowe (dokumentują
 * architekturę) — skan surowego tekstu paliłby się na dokumentacji zamiast
 * na treści. Do klienta schodzą literały, nie komentarze.
 *
 * CO POMIJAMY ŚWIADOMIE:
 *   - Ekrany superadmina (`(superadmin)`) — tam nazwy techniczne są OK,
 *     czyta je operator platformy, nie najemca.
 *   - Literały BEZ białych znaków w kodzie — to identyfikatory warstwy
 *     danych (klucze tabel/ustawień w zapytaniach, atrybuty data-*, klasy
 *     CSS), nie zdania dla człowieka. Komunikat dla najemcy zawsze zawiera
 *     spację; goły token nigdy nie jest treścią ekranu. Wartości messages
 *     i tekst JSX skanujemy w CAŁOŚCI, bez tej ulgi.
 *
 * GRANICA BRAMKI: statyczna — nie złapie wartości doklejanej w runtime
 * (np. `{availability.reason}`). Te ścieżki zdejmują testy kontraktowe
 * ekranów (secondary-screens-contract) i to, że U1 usunął takie doklejki.
 */

const panelRoot = process.cwd();
const screensDir = resolve(panelRoot, "app/[locale]/(panel)");

/**
 * Wzorzec nazwy zmiennej środowiskowej: ciąg WERSALIKÓW (z cyframi
 * i podkreśleniami) długości ≥ 5, stojący jako osobny token. Krótsze skróty
 * (PLN, NIP, CSV, API, URL, PDF, DNS…) nie łapią się z konstrukcji —
 * limit długości jest częścią kontraktu, nie przypadkiem.
 *
 * Charset OBEJMUJE polskie wersaliki, choć nazwy zmiennych ich nie mają:
 * bez tego „WYŁĄCZNIE” rozpada się na tokeny „CZNIE”/„WYŁ” i lista wyjątków
 * musiałaby trzymać ogryzki słów zamiast słów. Token łapiemy w całości,
 * wyjątki są czytelne — a każdy prawdziwy env i tak jest czystym ASCII.
 */
const CAPS = "A-ZĄĆĘŁŃÓŚŹŻ";
const ENV_NAME_PATTERN = new RegExp(
  `(?<![${CAPS}a-ząćęłńóśźż0-9_])[${CAPS}][${CAPS}0-9_]{4,}(?![${CAPS}a-ząćęłńóśźż0-9_])`,
  "g",
);

/**
 * JAWNA lista wyjątków od wzorca wersalików — wyłącznie treść dla
 * CZŁOWIEKA, nigdy nazwa z konfiguracji. Nowy wersalikowy token w treści
 * najemcy MA tu trafić świadomie, z powodem — to jest koszt zaprojektowany,
 * nie usterka bramki. Grupy:
 *
 * Skróty domenowe (tak je nazywa świat najemcy):
 *   - CNAME — typ rekordu DNS; instrukcja u rejestratora musi go nazwać.
 *   - CAPTCHA — nazwa mechanizmu, którą zna człowiek przy formularzu.
 *   - DOCTYPE — znacznik `<!DOCTYPE html>` w szablonie e-maila (niewidoczny
 *     dla czytelnika, ale jest literałem szablonu, nie konfiguracją).
 *   - POZ08M — PRZYKŁADOWY kod punktu odbioru w placeholderze pola.
 *
 * WERSALIKI stylistyczne (akcent w zdaniu — pisane tak celowo w copy):
 *   - PL: SPRZEDAŻ, KANAŁY, ORGANIZACJA (nagłówki grup nawigacji),
 *     CAŁKOWITA, WYŁĄCZNIE, ŁĄCZNIE (akcenty w podpowiedziach).
 *   - EN: SALES, CHANNELS, ORGANIZATION, TOTAL, WITHOUT, INTENDED (j.w.).
 */
const ALLOWED_UPPERCASE_TOKENS = new Set([
  "CNAME",
  "CAPTCHA",
  "DOCTYPE",
  "POZ08M",
  "SPRZEDAŻ",
  "KANAŁY",
  "ORGANIZACJA",
  "CAŁKOWITA",
  "WYŁĄCZNIE",
  "ŁĄCZNIE",
  "SALES",
  "CHANNELS",
  "ORGANIZATION",
  "TOTAL",
  "WITHOUT",
  "INTENDED",
]);

/**
 * Nazwy kluczy ustawień/sekretów tenanta — importowane z @avably/core,
 * żeby lista śledziła repo, a nie pamięć autora testu. Do tego nazwy tabel,
 * które nie mają stałych w core.
 */
const FORBIDDEN_SETTING_NAMES = [
  ...COURIER_CONFIG_KEYS,
  DELIVERY_PRICING_KEY,
  EMAIL_SENDER_KEY,
  GLOBKURIER_PASSWORD_SECRET_KEY,
  "tenant_settings",
  "tenant_secrets",
] as const;

interface Finding {
  where: string;
  text: string;
  hit: string;
}

function envNameHits(text: string): string[] {
  const hits = [...text.matchAll(ENV_NAME_PATTERN)].map((m) => m[0]);
  return hits.filter((hit) => !ALLOWED_UPPERCASE_TOKENS.has(hit));
}

function settingNameHits(text: string): string[] {
  return FORBIDDEN_SETTING_NAMES.filter((name) => text.includes(name));
}

function scan(where: string, text: string, findings: Finding[]): void {
  for (const hit of [...envNameHits(text), ...settingNameHits(text)]) {
    findings.push({ where, text: text.length > 120 ? `${text.slice(0, 120)}…` : text, hit });
  }
}

// ===== powierzchnia 1: słowniki messages =====

function walkMessages(
  node: unknown,
  path: string,
  visit: (path: string, value: string) => void,
): void {
  if (typeof node === "string") return visit(path, node);
  if (typeof node !== "object" || node === null) return;
  for (const [key, value] of Object.entries(node)) {
    walkMessages(value, path ? `${path}.${key}` : key, visit);
  }
}

// ===== powierzchnia 2: literały w kodzie ekranów najemcy =====

function collectSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return collectSources(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

/** Literał jest zdaniem dla człowieka dopiero, gdy ma biały znak. */
function looksLikeCopy(text: string): boolean {
  return /\s/.test(text.trim()) && text.trim().length > 0;
}

function scanSourceFile(path: string, findings: Finding[]): void {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const where = path.replace(`${screensDir}/`, "(panel)/");

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (looksLikeCopy(node.text)) scan(where, node.text, findings);
    } else if (ts.isTemplateExpression(node)) {
      if (looksLikeCopy(node.head.text)) scan(where, node.head.text, findings);
      for (const span of node.templateSpans) {
        if (looksLikeCopy(span.literal.text)) scan(where, span.literal.text, findings);
      }
    } else if (ts.isJsxText(node)) {
      // Tekst JSX to ZAWSZE treść ekranu — bez ulgi na pojedynczy token.
      if (node.text.trim().length > 0) scan(where, node.text, findings);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

describe("bramka U1: zero nazw zmiennych i kluczy ustawień w treściach najemcy", () => {
  it("skan obejmuje realny zbiór plików i słowników", () => {
    // Kontrola po pustym zbiorze (lekcja „dowód bywa fałszywie zielony"):
    // bez podłogi liczności usunięcie katalogu wygaszałoby bramkę po cichu.
    const files = collectSources(screensDir);
    expect(files.length).toBeGreaterThanOrEqual(100);
    expect(files.some((f) => f.endsWith("domains-panel.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("delivery-section.tsx"))).toBe(true);

    let messageCount = 0;
    walkMessages(pl, "pl", () => messageCount++);
    walkMessages(en, "en", () => messageCount++);
    expect(messageCount).toBeGreaterThanOrEqual(1000);
  });

  it("wzorzec łapie kanoniczny przykład z audytu (samotest bramki)", () => {
    // Gdyby regex się rozjechał, bramka świeciłaby na zielono nad dziurą —
    // ten test przybija, że dokładnie treść z audytu W3 się pali.
    expect(envNameHits("Wysyłka e-maili nie jest skonfigurowana (brak RESEND_API_KEY).")).toEqual([
      "RESEND_API_KEY",
    ]);
    expect(settingNameHits("brak ustawienia courier_sender")).toEqual(["courier_sender"]);
  });

  it("słowniki messages (pl+en) są czyste", () => {
    const findings: Finding[] = [];
    walkMessages(pl, "pl", (path, value) => scan(path, value, findings));
    walkMessages(en, "en", (path, value) => scan(path, value, findings));
    expect(
      findings.map((f) => `${f.where}: „${f.text}” → ${f.hit}`),
      "nazwy techniczne w słownikach najemcy",
    ).toEqual([]);
  });

  it("literały ekranów najemcy są czyste", () => {
    const findings: Finding[] = [];
    for (const path of collectSources(screensDir)) scanSourceFile(path, findings);
    expect(
      findings.map((f) => `${f.where}: „${f.text}” → ${f.hit}`),
      "nazwy techniczne w treściach ekranów najemcy",
    ).toEqual([]);
  });
});
