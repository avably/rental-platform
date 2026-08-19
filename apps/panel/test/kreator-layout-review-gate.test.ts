/**
 * Powłoka grupy `(kreator)` — bramka nakładki przeglądu (naprawa pinezki
 * 494d7445, ADR-071 + ADR-083; od ADR-206 bez warunku superadmina).
 *
 * Przyczyna, dla której widget nie renderował się na `/strona/kreator` i
 * `/strona/podglad`: `(kreator)` nie miała WŁASNEGO layoutu, więc trasa nie
 * dziedziczyła `<ReviewOverlayGate>` z `(panel)` (grupa poza nią, ADR-083).
 * Ten test broni DRZEWA elementów zwróconego przez `KreatorLayout` — nie
 * skanuje źródła — bo string w pliku niczego nie gwarantuje o realnym
 * renderze (ten sam błąd, tylko przesunięty o jeden krok).
 *
 * Od ADR-206 jedyną bramką SERWEROWĄ montażu jest kill-switch
 * `REVIEW_MODE=1` — właściciel komentuje też jako zwykły user i anonim,
 * więc drzewo Z widgetem ma powstać bez żadnej sesji. Warunek kliencki
 * (`?review=1`) żyje wewnątrz samej bramki (`ReviewOverlayGate`) — poza
 * zasięgiem tego testu. Kill-switch pozostaje twardy: bez REVIEW_MODE=1
 * widgetu nie ma NIGDY.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { ReviewOverlayGate } = await import("@avably/review/overlay");
const KreatorLayout = (await import("@/app/[locale]/(kreator)/layout")).default;

/** Czy drzewo elementów zawiera węzeł DANEGO typu (identyczność referencji). */
function containsType(node: unknown, type: unknown): boolean {
  if (Array.isArray(node)) return node.some((child) => containsType(child, type));
  if (!node || typeof node !== "object") return false;
  if ((node as { type?: unknown }).type === type) return true;
  const props = (node as { props?: { children?: unknown } }).props;
  if (!props) return false;
  return containsType(props.children, type);
}

/** Zbiera wszystkie napisy z drzewa — dowód, że `{children}` nadal trafia do wyniku. */
function collectStrings(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, found);
    return found;
  }
  if (typeof node === "string") {
    found.push(node);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const props = (node as { props?: { children?: unknown } }).props;
  if (!props) return found;
  collectStrings(props.children, found);
  return found;
}

const MARKER = "PŁÓTNO_KREATORA_MARKER";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("(kreator)/layout — bramka nakładki przeglądu", () => {
  it("REVIEW_MODE=1 → widget JEST w drzewie (bez żadnej sesji — ADR-206)", async () => {
    vi.stubEnv("REVIEW_MODE", "1");

    const tree = await KreatorLayout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(true);
    expect(collectStrings(tree)).toContain(MARKER);
  });

  it("REVIEW_MODE wyłączony → widgetu NIE MA (kill-switch)", async () => {
    vi.stubEnv("REVIEW_MODE", "0");

    const tree = await KreatorLayout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(false);
    expect(collectStrings(tree)).toContain(MARKER);
  });

  it("REVIEW_MODE niezdefiniowany → widgetu NIE MA", async () => {
    vi.stubEnv("REVIEW_MODE", "");

    const tree = await KreatorLayout({ children: MARKER });

    expect(containsType(tree, ReviewOverlayGate)).toBe(false);
    expect(collectStrings(tree)).toContain(MARKER);
  });
});
