import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PANEL_NAV_GROUPS,
  PANEL_NAV_ITEMS,
  PANEL_NAV_PLACEHOLDER,
  matchNavItem,
} from "@/lib/shell/nav";

/**
 * Kontrakt struktury nawigacji panelu (ADR-056).
 *
 * Wzorzec z `tokens-contract.test.ts`: źródłem prawdy jest ARTEFAKT handoffu,
 * nie ręcznie utrzymywany rejestr w teście. Parsujemy `<nav data-panel-nav>`
 * z sekcji 04 i porównujemy 1:1 z definicją, z której renderuje się shell —
 * pozycja usunięta z artefaktu, przestawiona albo dopisana w kodzie wywraca
 * suitę.
 *
 * Kontrakt pilnuje STRUKTURY i IDENTYFIKATORÓW, nie hrefów: adresy są nasze
 * (artefakt ma atrapy `#`), a mapowanie na trasy produktu żyje w `nav.ts`.
 */

const repositoryRoot = resolve(process.cwd(), "../..");
const artifact = readFileSync(
  resolve(repositoryRoot, "docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);

type ArtifactEntry =
  | { kind: "placeholder"; id: string; future: boolean; label: string }
  | { kind: "item"; id: string; label: string }
  | { kind: "group"; label: string };

function extractNavBlocks(): string[] {
  const blocks = [
    ...artifact.matchAll(
      /<nav[^>]*data-panel-nav="true"[^>]*>([\s\S]*?)<\/nav>/g,
    ),
  ].map((match) => match[1]);
  if (blocks.length === 0) throw new Error("Brak <nav data-panel-nav> w artefakcie");
  return blocks;
}

/** Tekst węzła bez zagnieżdżonego `<span>` (badge „Wkrótce") i bez znaczników. */
function plainLabel(inner: string): string {
  return inner
    .replace(/<span[^>]*>[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNav(block: string): ArtifactEntry[] {
  const entries: ArtifactEntry[] = [];
  const node = /<(a|p)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  for (const match of block.matchAll(node)) {
    const [, tag, attributes, inner] = match;

    if (tag === "p") {
      if (!/class="[^"]*\bnav-group\b/.test(attributes)) continue;
      entries.push({ kind: "group", label: plainLabel(inner) });
      continue;
    }

    const placeholder = attributes.match(/data-nav-placeholder="([^"]+)"/)?.[1];
    if (placeholder) {
      entries.push({
        kind: "placeholder",
        id: placeholder,
        future: /data-future="true"/.test(attributes),
        label: plainLabel(inner),
      });
      continue;
    }

    const item = attributes.match(/data-nav-item="([^"]+)"/)?.[1];
    if (item) entries.push({ kind: "item", id: item, label: plainLabel(inner) });
  }
  return entries;
}

const navBlocks = extractNavBlocks();
const artifactNav = parseNav(navBlocks[0]);

describe("kontrakt struktury nawigacji panelu — artefakt Fazy 2 sekcja 04", () => {
  it("wszystkie kopie <nav> w artefakcie są identyczne", () => {
    // Artefakt powtarza shell w sekcji 09 (dark). Gdyby kopie się rozjechały,
    // kontrakt milcząco pilnowałby tylko pierwszej z nich.
    expect(navBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of navBlocks.slice(1)) {
      expect(parseNav(block)).toEqual(artifactNav);
    }
  });

  it("podłoga liczności: 1 placeholder + 15 pozycji + 3 grupy", () => {
    // Kontrola po pustym zbiorze: gdyby parser przestał cokolwiek znajdować,
    // wszystkie porównania niżej byłyby zielone na pustych tablicach.
    const counts = {
      placeholder: artifactNav.filter((e) => e.kind === "placeholder").length,
      item: artifactNav.filter((e) => e.kind === "item").length,
      group: artifactNav.filter((e) => e.kind === "group").length,
    };
    // 12 po dołożeniu „Klienci" do grupy SPRZEDAŻ (R6a); 13 po „Integracje"
    // w KANAŁACH i 14 po „Eksport danych" w ORGANIZACJI (M2, ADR-110 —
    // zgoda właściciela na zmianę artefaktu: oba ekrany były wejściami-
    // sierotami, osiągalnymi wyłącznie linkiem z Organizacji); 15 po
    // „Dokumenty prawne" w KANAŁACH (B4, ADR-129 — regulamin i polityka
    // prywatności sklepu dostały ekran, więc dostały też pozycję).
    expect(counts).toEqual({ placeholder: 1, item: 15, group: 3 });

    expect(PANEL_NAV_ITEMS).toHaveLength(15);
    expect(PANEL_NAV_GROUPS).toHaveLength(3);
  });

  it("pozycja dashboardu: id, BEZ flagi data-future (ekran istnieje — UX1, ADR-140)", () => {
    const placeholder = artifactNav.find((e) => e.kind === "placeholder");
    expect(placeholder).toBeDefined();
    expect(placeholder).toMatchObject({
      id: PANEL_NAV_PLACEHOLDER.id,
      // Zapowiedź „Wkrótce" zdjęta zgodną edycją artefaktu (UX1/ADR-140):
      // dashboard to działająca strona startowa, pozycja jest klikalna.
      future: false,
    });

    // Pozycja dashboardu NIE wchodzi na listę tras grup: prowadzi do `/`,
    // a matchNavItem (dopasowanie prefiksowe) łapałby na `/` każdą trasę.
    expect(PANEL_NAV_ITEMS.map((item) => item.id)).not.toContain(
      PANEL_NAV_PLACEHOLDER.id,
    );
  });

  it("kolejność grup i pozycji zgadza się z artefaktem co do znaku", () => {
    const expected: ArtifactEntry[] = [
      {
        kind: "placeholder",
        id: PANEL_NAV_PLACEHOLDER.id,
        future: false,
        label: artifactNav[0].kind === "placeholder" ? artifactNav[0].label : "",
      },
      ...PANEL_NAV_GROUPS.flatMap((group): ArtifactEntry[] => [
        { kind: "group", label: group.artifactLabel },
        ...group.items.map((item): ArtifactEntry => {
          const source = artifactNav.find(
            (entry) => entry.kind === "item" && entry.id === item.id,
          );
          return {
            kind: "item",
            id: item.id,
            label: source && "label" in source ? source.label : "",
          };
        }),
      ]),
    ];

    // Porównanie sekwencji: przestawiona pozycja albo przeniesiona między
    // grupami zmienia kolejność i nie przechodzi.
    expect(artifactNav).toEqual(expected);
  });

  it("każda pozycja artefaktu ma dokładnie jeden odpowiednik w kodzie", () => {
    const artifactIds = artifactNav
      .filter((entry) => entry.kind === "item")
      .map((entry) => (entry.kind === "item" ? entry.id : ""));
    const codeIds = PANEL_NAV_ITEMS.map((item) => item.id);

    expect([...codeIds].sort()).toEqual([...artifactIds].sort());
    expect(new Set(codeIds).size).toBe(codeIds.length);
  });

  it("każda pozycja prowadzi pod wewnętrzną ścieżkę bez prefiksu locale", () => {
    for (const item of PANEL_NAV_ITEMS) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.href).not.toMatch(/^\/(pl|en)(\/|$)/);
    }
  });
});

describe("dopasowanie trasy aktywnej", () => {
  it("wskazuje pozycję dla dokładnej ścieżki", () => {
    expect(matchNavItem("/zamowienia")?.id).toBe("orders");
    expect(matchNavItem("/katalog")?.id).toBe("catalog");
  });

  it("ekran zagnieżdżony podświetla swoją sekcję", () => {
    expect(matchNavItem("/zamowienia/ZAM-1")?.id).toBe("orders");
    expect(matchNavItem("/katalog/nowy")?.id).toBe("catalog");
    // Punkty odbioru przeprowadziły się spod Katalogu do Dostaw (2026-08-04),
    // więc dwupoziomowe zagnieżdżenie sprawdzamy tam, gdzie teraz stoi — i to
    // ono jest tu istotne: `/ustawienia-dostaw` musi wygrać dopasowanie mimo
    // dwóch segmentów pod spodem.
    expect(matchNavItem("/ustawienia-dostaw/punkty-odbioru/nowy")?.id).toBe("delivery");
  });

  it("trasa spoza nawigacji nie podświetla niczego", () => {
    expect(matchNavItem("/historia-emaili")).toBeUndefined();
    expect(matchNavItem("/design-system")).toBeUndefined();
  });

  it("nie łapie prefiksu przypadkowego", () => {
    // `/katalogowanie` nie jest podstroną `/katalog`.
    expect(matchNavItem("/katalogowanie")).toBeUndefined();
  });
});
