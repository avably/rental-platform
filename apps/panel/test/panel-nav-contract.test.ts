import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  branchSelfItem,
  matchNavItem,
  panelTitleKey,
  PANEL_NAV_ITEMS,
  PANEL_NAV_LAUNCH,
  PANEL_NAV_PLACEHOLDER,
  PANEL_NAV_TREE,
} from "@/lib/shell/nav";

/**
 * Kontrakt struktury nawigacji panelu (ADR-056, przebudowa na DRZEWO w ADR-231).
 *
 * Źródłem prawdy jest ARTEFAKT handoffu Fazy 2, nie ręcznie utrzymywany rejestr
 * w teście (wzorzec z `tokens-contract.test.ts`). ADR-231 ŚWIADOMIE przepisał
 * artefakt i ten kontrakt z płaskich trzech grup na DRZEWO zagnieżdżone — to
 * jedyne zadanie w projekcie, które ten kontrakt rusza.
 *
 * Artefakt trzyma drzewo w postaci FLAT-ANOTOWANEJ: każdy liść stoi jako
 * bezpośredni `<a data-nav-item>` (żeby `verify-branding-phase2` dalej widział
 * płaską listę pozycji), a przynależność do gałęzi niesie `data-nav-parent`;
 * nagłówki gałęzi mają `data-nav-branch` (+ `data-nav-branch-kind`). Parser
 * niżej rekonstruuje z tego drzewo i porównuje 1:1 z `PANEL_NAV_TREE` — czyli
 * ze strukturą, z której renderuje się shell.
 *
 * Kontrakt pilnuje STRUKTURY i IDENTYFIKATORÓW, nie hrefów: adresy są nasze
 * (artefakt ma atrapy `#`), a mapowanie na trasy produktu żyje w `nav.ts`.
 */

const repositoryRoot = resolve(process.cwd(), "../..");
const artifact = readFileSync(
  resolve(repositoryRoot, "docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);

type ArtifactNode =
  | { kind: "item"; id: string; label: string }
  | {
      kind: "branch";
      id: string;
      navigable: boolean;
      selfId: string | null;
      label: string;
      children: { id: string; label: string }[];
    };

type ArtifactTree = {
  placeholder: { id: string; future: boolean; label: string } | null;
  nodes: ArtifactNode[];
};

function extractNavBlocks(): string[] {
  const blocks = [
    ...artifact.matchAll(/<nav[^>]*data-panel-nav="true"[^>]*>([\s\S]*?)<\/nav>/g),
  ].map((match) => match[1]);
  if (blocks.length === 0) throw new Error("Brak <nav data-panel-nav> w artefakcie");
  return blocks;
}

/** Tekst węzła bez zagnieżdżonego `<span>` (badge) i bez znaczników. */
function plainLabel(inner: string): string {
  return inner
    .replace(/<span[^>]*>[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`${name}="([^"]+)"`))?.[1];
}

/** Rekonstruuje drzewo z flat-anotowanego bloku `<nav>`. */
function parseNav(rawBlock: string): ArtifactTree {
  // Komentarze potrafią nieść tekst przypominający znaczniki (`<a data-nav-item>`
  // w opisie) — zdejmujemy je, żeby regex parsował wyłącznie realne elementy.
  const block = rawBlock.replace(/<!--[\s\S]*?-->/g, "");
  const tree: ArtifactTree = { placeholder: null, nodes: [] };
  const branchById = new Map<string, Extract<ArtifactNode, { kind: "branch" }>>();
  const node = /<(a|button|p)\b([^>]*)>([\s\S]*?)<\/\1>/g;

  for (const match of block.matchAll(node)) {
    const [, , attributes, inner] = match;
    const label = plainLabel(inner);

    const placeholder = attr(attributes, "data-nav-placeholder");
    if (placeholder) {
      tree.placeholder = {
        id: placeholder,
        future: /data-future="true"/.test(attributes),
        label,
      };
      continue;
    }

    const branchId = attr(attributes, "data-nav-branch");
    if (branchId) {
      const branch: Extract<ArtifactNode, { kind: "branch" }> = {
        kind: "branch",
        id: branchId,
        navigable: attr(attributes, "data-nav-branch-kind") === "link",
        selfId: attr(attributes, "data-nav-item") ?? null,
        label,
        children: [],
      };
      branchById.set(branchId, branch);
      tree.nodes.push(branch);
      continue;
    }

    const itemId = attr(attributes, "data-nav-item");
    if (!itemId) continue;

    const parent = attr(attributes, "data-nav-parent");
    if (parent) {
      const branch = branchById.get(parent);
      if (!branch) throw new Error(`Dziecko ${itemId} wskazuje nieznaną gałąź ${parent}`);
      branch.children.push({ id: itemId, label });
      continue;
    }

    tree.nodes.push({ kind: "item", id: itemId, label });
  }

  return tree;
}

const navBlocks = extractNavBlocks();
const artifactTree = parseNav(navBlocks[0]);

/** Oczekiwane drzewo z KODU (struktura, z której renderuje się shell). */
const expectedFromCode = PANEL_NAV_TREE.map((node) =>
  node.kind === "item"
    ? { kind: "item" as const, id: node.item.id }
    : {
        kind: "branch" as const,
        id: node.branch.id,
        navigable: Boolean(node.branch.href),
        selfId: branchSelfItem(node.branch)?.id ?? null,
        children: node.branch.children.map((child) => child.id),
      },
);

/** To samo drzewo z ARTEFAKTU, zredukowane do identyfikatorów i kształtu. */
const artifactShape = artifactTree.nodes.map((node) =>
  node.kind === "item"
    ? { kind: "item" as const, id: node.id }
    : {
        kind: "branch" as const,
        id: node.id,
        navigable: node.navigable,
        selfId: node.selfId,
        children: node.children.map((child) => child.id),
      },
);

const artifactLeafIds = artifactTree.nodes.flatMap((node) =>
  node.kind === "item"
    ? [node.id]
    : [...(node.selfId ? [node.selfId] : []), ...node.children.map((child) => child.id)],
);

describe("kontrakt struktury nawigacji panelu — artefakt Fazy 2 sekcja 04 (drzewo, ADR-231)", () => {
  it("wszystkie kopie <nav> w artefakcie są identyczne", () => {
    // Artefakt powtarza shell w sekcji 09 (dark). Gdyby kopie się rozjechały,
    // kontrakt milcząco pilnowałby tylko pierwszej z nich.
    expect(navBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of navBlocks.slice(1)) {
      expect(parseNav(block)).toEqual(artifactTree);
    }
  });

  it("podłoga liczności: 1 placeholder + 3 węzły najwyższego poziomu z gałęziami", () => {
    // Kontrola po pustym zbiorze: gdyby parser przestał cokolwiek znajdować,
    // porównania niżej byłyby zielone na pustych tablicach.
    const branches = artifactTree.nodes.filter((node) => node.kind === "branch");
    const topLeaves = artifactTree.nodes.filter((node) => node.kind === "item");

    expect(artifactTree.placeholder).not.toBeNull();
    // Trzy top-level liście (Zamówienia, Klienci, Katalog) + trzy gałęzie
    // (Strona sklepu, Ustawienia, Organizacja) — drzewo ADR-231.
    expect(topLeaves).toHaveLength(3);
    expect(branches).toHaveLength(3);
    // Wszystkie liście łącznie pokrywają PANEL_NAV_ITEMS (płaska lista matchNav).
    expect(artifactLeafIds.length).toBe(PANEL_NAV_ITEMS.length);
    expect(PANEL_NAV_ITEMS).toHaveLength(16);
  });

  it("pozycja dashboardu: id, BEZ flagi data-future (ekran istnieje — UX1, ADR-140)", () => {
    expect(artifactTree.placeholder).toMatchObject({
      id: PANEL_NAV_PLACEHOLDER.id,
      future: false,
    });
    // Dashboard prowadzi do `/`, a matchNavItem (prefiks) łapałby tam każdą
    // trasę — dlatego NIE wchodzi na płaską listę pozycji.
    expect(PANEL_NAV_ITEMS.map((item) => item.id)).not.toContain(PANEL_NAV_PLACEHOLDER.id);
  });

  it("drzewo artefaktu zgadza się z PANEL_NAV_TREE co do znaku: kolejność, gałęzie, dzieci", () => {
    // Przestawiona pozycja, przeniesione dziecko albo zmieniony rodzaj gałęzi
    // (nawigowalna vs toggle) zmienia kształt i nie przechodzi.
    expect(artifactShape).toEqual(expectedFromCode);
  });

  it("gałęzie: „Strona sklepu” i „Organizacja” nawigowalne, „Ustawienia” to toggle bez ekranu", () => {
    const byId = new Map(
      artifactTree.nodes
        .filter((node): node is Extract<ArtifactNode, { kind: "branch" }> => node.kind === "branch")
        .map((branch) => [branch.id, branch]),
    );

    // Strona sklepu → /strona: nawigowalna, ale jej trasę pokrywa dziecko
    // „Strony", więc wiersz-rodzic NIE jest osobną pozycją matchNavItem.
    expect(byId.get("storeSection")).toMatchObject({ navigable: true, selfId: null });
    // Ustawienia: sama gałąź, bez ekranu — klik toggluje.
    expect(byId.get("settings")).toMatchObject({ navigable: false, selfId: null });
    // Organizacja → /organizacja: nawigowalna, a jej trasy nie pokrywa żadne
    // dziecko, więc wiersz-rodzic JEST pozycją matchNavItem (selfId=organization).
    expect(byId.get("organization")).toMatchObject({ navigable: true, selfId: "organization" });
  });

  it("Bezpieczeństwo ZOSTAJE pod Organizacją (konto, nie sklep — decyzja właściciela)", () => {
    const organization = artifactTree.nodes.find(
      (node): node is Extract<ArtifactNode, { kind: "branch" }> =>
        node.kind === "branch" && node.id === "organization",
    );
    expect(organization?.children.map((child) => child.id)).toContain("security");
  });

  it("każda pozycja artefaktu ma dokładnie jeden odpowiednik w kodzie", () => {
    const codeIds = PANEL_NAV_ITEMS.map((item) => item.id);

    expect([...artifactLeafIds].sort()).toEqual([...codeIds].sort());
    expect(new Set(codeIds).size).toBe(codeIds.length);
    // Każda gałąź i każdy liść niosą widoczną etykietę (podłoga: pusty label
    // przeszedłby porównanie identyfikatorów).
    for (const node of artifactTree.nodes) {
      expect(node.label.length, `gałąź/pozycja bez etykiety: ${node.id}`).toBeGreaterThan(0);
      if (node.kind === "branch") {
        for (const child of node.children) {
          expect(child.label.length, `dziecko bez etykiety: ${child.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("każda pozycja prowadzi pod wewnętrzną ścieżkę bez prefiksu locale", () => {
    for (const item of PANEL_NAV_ITEMS) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.href).not.toMatch(/^\/(pl|en)(\/|$)/);
    }
  });
});

describe("pozycja WARUNKOWA Uruchomienie (config-first hub, ADR-228)", () => {
  /*
   * „Uruchomienie" NIE jest pozycją kontraktu struktury: artefakt Fazy 2 jej
   * nie zna, a kontrakt wyżej pilnuje drzewa 1:1 z artefaktem. To pozycja STANU
   * KONTA — shell renderuje ją warunkowo (badge postępu) na górze drzewa,
   * dopóki onboarding nieukończony. Dlatego stoi POZA `PANEL_NAV_TREE`/
   * `PANEL_NAV_ITEMS`, a jej obecność w kodzie nie może ruszyć liczności.
   */
  it("stoi poza kontraktem drzewa — nie wchodzi do PANEL_NAV_ITEMS", () => {
    expect(PANEL_NAV_ITEMS.map((item) => item.id)).not.toContain(PANEL_NAV_LAUNCH.id);
    expect(PANEL_NAV_ITEMS).toHaveLength(16);
    expect(PANEL_NAV_LAUNCH.href).toBe("/uruchomienie");
  });

  it("nie kradnie podświetlenia — matchNavItem nie zna jej trasy", () => {
    expect(matchNavItem(PANEL_NAV_LAUNCH.href)).toBeUndefined();
  });

  it("tytuł belki dla /uruchomienie bierze się z override'u (poza drzewem)", () => {
    expect(panelTitleKey("/uruchomienie")).toBe(PANEL_NAV_LAUNCH.labelKey);
  });
});

describe("dopasowanie trasy aktywnej", () => {
  it("wskazuje pozycję dla dokładnej ścieżki", () => {
    expect(matchNavItem("/zamowienia")?.id).toBe("orders");
    expect(matchNavItem("/katalog")?.id).toBe("catalog");
    // Wiersz-rodzic Organizacja jest zarazem pozycją matchNavItem.
    expect(matchNavItem("/organizacja")?.id).toBe("organization");
  });

  it("ekran zagnieżdżony podświetla swoją sekcję", () => {
    expect(matchNavItem("/zamowienia/ZAM-1")?.id).toBe("orders");
    expect(matchNavItem("/katalog/nowy")?.id).toBe("catalog");
    // Punkty odbioru pod Dostawami (2026-08-04): dwupoziomowe zagnieżdżenie
    // musi wygrać dopasowanie mimo dwóch segmentów pod spodem.
    expect(matchNavItem("/ustawienia-dostaw/punkty-odbioru/nowy")?.id).toBe("delivery");
  });

  it("Strona sklepu i Wygląd sklepu to dwie pozycje drzewa (ADR-231)", () => {
    // „Strony" (lista wersji, /strona) trzyma ISTNIEJĄCY id `store`, więc
    // matchNavItem /strona zostaje bez zmiany.
    expect(matchNavItem("/strona")?.id).toBe("store");
    // „Wygląd sklepu" (/strona/wyglad, ADR-230) od ADR-231 ma WŁASNĄ pozycję
    // (dziecko akordeonu) — dopasowanie najdłuższe daje jej `storeAppearance`
    // (wcześniej podtrasa podświetlała „store"). Świadoma zmiana kontraktu.
    expect(matchNavItem("/strona/wyglad")?.id).toBe("storeAppearance");
    // Belka i tak pokazuje „Wygląd sklepu" — teraz przez samą pozycję.
    expect(panelTitleKey("/strona/wyglad")).toBe("storeAppearance");
    expect(PANEL_NAV_ITEMS.find((item) => item.id === "store")?.href).toBe("/strona");
    expect(PANEL_NAV_ITEMS.find((item) => item.id === "storeAppearance")?.href).toBe(
      "/strona/wyglad",
    );
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

describe("tytuły belki spoza głównej nawigacji (override'y ADR-231 zachowane)", () => {
  it("override'y niezależne od struktury działają dalej", () => {
    expect(panelTitleKey("/historia-emaili")).toBe("emailHistory");
    expect(panelTitleKey("/organizacja/nowa")).toBe("newOrganization");
    expect(panelTitleKey("/organizacja/nowa/gotowe")).toBe("organizationCreated");
    expect(panelTitleKey("/bezpieczenstwo/wyzwanie")).toBe("securityChallenge");
    expect(panelTitleKey("/zamowienia/nowe")).toBe("newOrder");
  });
});
