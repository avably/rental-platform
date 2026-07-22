import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import messages from "../messages/pl.json";
import {
  SECONDARY_LABELLED_AXES,
  secondaryStatusSemantics,
} from "../lib/secondary-status";

/**
 * Kontrakt statusów ekranów drugorzędnych (P8 — powierzchnia
 * `secondary-status-map` artefaktu Fazy 2).
 *
 * Trzy bramki, bo trzy różne rzeczy mogą się rozjechać:
 *   1. MAPA — kopia 1:1 powierzchni artefaktu (wzorzec `status-contract`).
 *   2. ZAPIS — żaden ekran nie przypisuje tonu literałem; jedyną drogą do
 *      chipa jest helper nad mapą. Bez tego najtańszą poprawką „ten chip ma zły
 *      kolor" jest wpisanie koloru z palca i po trzech takich poprawkach mapa
 *      przestaje cokolwiek znaczyć.
 *   3. TREŚĆ — etykieta każdego stanu jest kopią copy z mockupu. Chip bez
 *      tekstu albo z inną treścią niż zaakceptowana to ten sam rozjazd, tylko
 *      widoczny dla użytkownika, a nie dla programisty.
 */

const panelRoot = process.cwd();
const artifact = readFileSync(
  resolve(panelRoot, "../..", "docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

const surface = JSON.parse(
  decodeHtmlEntities(
    artifact.match(
      /<pre[^>]*data-code-surface="secondary-status-map"[^>]*><code>([\s\S]*?)<\/code><\/pre>/,
    )?.[1] ?? "",
  ),
) as Record<string, Record<string, string>>;

/** Chipy z sekcji mockupów: oś, wartość, ton i WIDOCZNY tekst etykiety. */
function artifactChips(): { axis: string; value: string; tone: string; label: string }[] {
  const pattern =
    /<span class="chip chip-(\w+)" data-secondary-status-axis="([\w-]+)" data-secondary-status-value="(\w+)" data-tone="(\w+)">([^<]+)<\/span>/g;
  return [...artifact.matchAll(pattern)].map(([, chipTone, axis, value, tone, label]) => {
    expect(chipTone, `klasa chipa ≠ data-tone przy ${axis}/${value}`).toBe(tone);
    return { axis: axis!, value: value!, tone: tone!, label: decodeHtmlEntities(label!).trim() };
  });
}

const chips = artifactChips();

describe("mapa statusów drugorzędnych (secondary-status-map → kod)", () => {
  it("powierzchnia artefaktu obejmuje komplet osi", () => {
    // Podłoga liczności: bez niej usunięcie osi z artefaktu kurczyłoby kontrakt
    // po cichu (lekcja ADR-053 D2).
    expect(Object.keys(surface).sort()).toEqual([
      "delivery-secret",
      "domain",
      "domain-provider",
      "email-log",
      "email-sender",
      "email-transport",
      "invitation",
      "organization",
      "security",
      "site-publish",
      "site-section",
    ]);
  });

  it("secondaryStatusSemantics jest identyczna 1:1 z powierzchnią artefaktu", () => {
    expect(secondaryStatusSemantics).toEqual(surface);
  });

  it("mapa NIE dubluje osi zamówień, płatności i wysyłek", () => {
    // Artefakt zapisał to wprost: to osobny kontrakt. Gdyby oś `order` weszła
    // tu bokiem, mielibyśmy dwa źródła prawdy o tym samym statusie.
    for (const axis of ["order", "payment", "shipment"]) {
      expect(Object.keys(secondaryStatusSemantics)).not.toContain(axis);
    }
  });

  it("każdy chip mockupu ma w mapie ten sam ton co w artefakcie", () => {
    expect(chips.length).toBeGreaterThanOrEqual(18);
    for (const chip of chips) {
      const axis = surface[chip.axis];
      expect(axis, `oś ${chip.axis} spoza mapy`).toBeDefined();
      expect(axis![chip.value], `${chip.axis}/${chip.value}`).toBe(chip.tone);
    }
  });
});

describe("etykiety stanów = copy z mockupu", () => {
  const labels = messages.secondaryStatus as unknown as Record<string, Record<string, string>>;

  it("słownik pokrywa DOKŁADNIE osie z własnym ekranem", () => {
    // `site-section` i `site-publish` należą do edytora strony sklepu (osobna
    // paczka) — mapa musi je znać, etykiet za tamtą paczkę tu nie piszemy.
    expect(Object.keys(labels).sort()).toEqual([...SECONDARY_LABELLED_AXES].sort());
  });

  it("każdy stan osi z ekranem ma etykietę", () => {
    for (const axis of SECONDARY_LABELLED_AXES) {
      for (const value of Object.keys(secondaryStatusSemantics[axis])) {
        expect(labels[axis]?.[value], `brak etykiety ${axis}/${value}`).toBeTruthy();
      }
    }
  });

  it("etykieta jest kopią tekstu chipa z mockupu", () => {
    const covered = chips.filter((chip) =>
      (SECONDARY_LABELLED_AXES as readonly string[]).includes(chip.axis),
    );
    expect(covered.length).toBeGreaterThanOrEqual(15);
    for (const chip of covered) {
      expect(labels[chip.axis]?.[chip.value], `${chip.axis}/${chip.value}`).toBe(chip.label);
    }
  });
});

describe("zakaz literałów tonu na ekranach drugorzędnych", () => {
  const screensDir = resolve(panelRoot, "app/[locale]/(panel)");
  const SECONDARY_SCREEN_DIRS = [
    "ustawienia-domen",
    "ustawienia-emaili",
    "historia-emaili",
    "ustawienia-dostaw",
    "ustawienia-umow",
    "zaproszenia",
    "organizacja",
    "bezpieczenstwo",
  ];

  function collect(dir: string): { path: string; source: string }[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) return collect(path);
      if (!/\.tsx?$/.test(entry.name)) return [];
      return [{ path, source: readFileSync(path, "utf8") }];
    });
  }

  const sources = SECONDARY_SCREEN_DIRS.flatMap((dir) => collect(resolve(screensDir, dir)));

  it("skan obejmuje realny zbiór plików", () => {
    expect(sources.length).toBeGreaterThanOrEqual(20);
    expect(sources.some((file) => file.path.endsWith("domains-panel.tsx"))).toBe(true);
  });

  it("żaden plik ekranu nie przypisuje tonu literałem", () => {
    const offenders = sources
      .filter((file) => /\btone\s*=\s*["'{]\s*["']/.test(file.source) || /\btone=["']/.test(file.source))
      .map((file) => file.path.replace(`${screensDir}/`, ""));

    expect(offenders, `ton wpisany z palca zamiast z mapy: ${offenders.join(", ")}`).toEqual([]);
  });

  it("wykrywa oba zapisy literału (kontrola pozytywna)", () => {
    expect(/\btone=["']/.test('<StatusBadge tone="positive">')).toBe(true);
    expect(/\btone\s*=\s*["'{]\s*["']/.test("<StatusBadge tone={'problem'}>")).toBe(true);
    expect(/\btone=["']/.test("<StatusBadge {...secondaryStatusProps(axis, value)}>")).toBe(false);
  });

  it("jedynym źródłem tonu jest helper nad mapą — i ekrany naprawdę go używają", () => {
    const helper = readFileSync(resolve(panelRoot, "lib/secondary-status.tsx"), "utf8");
    expect(helper).toContain("secondaryStatusSemantics[axis][value]");

    const users = sources.filter((file) => /SecondaryStatusChip/.test(file.source));
    expect(users.length, "chipy stanu zniknęły z ekranów").toBeGreaterThanOrEqual(6);
  });
});
