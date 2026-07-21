import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { statusSemantics } from "@avably/ui";
import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

/**
 * Kontrakt słownika etykiet statusów (ADR-057).
 *
 * Źródłem prawdy jest ARTEFAKT (wzorzec `panel-nav-contract.test.ts`): matryca
 * `data-status-matrix` z sekcji 04 niesie pełny słownik PL trzech osi. Test
 * pilnuje trzech rzeczy naraz:
 *   1. komplet kluczy = klucze `statusSemantics` (żadna wartość statusu nie
 *      wyświetli się jako surowy identyfikator),
 *   2. treść PL co do znaku jak w artefakcie,
 *   3. parytet EN↔PL (osobno od globalnego testu parytetu — tu chodzi o to,
 *      żeby nowa oś nie weszła tylko do jednego locale).
 */

const repositoryRoot = resolve(process.cwd(), "../..");
const artifact = readFileSync(
  resolve(repositoryRoot, "docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);

type Labels = Record<string, Record<string, string>>;

const plLabels = pl.orders.statusLabels as Labels;
const enLabels = en.orders.statusLabels as Labels;

/** Etykiety chipów z matrycy statusów artefaktu: oś → wartość → tekst. */
function parseArtifactLabels(): Labels {
  const matrix = artifact.match(/<div class="status-matrix" data-status-matrix>([\s\S]*?)<\/div>/);
  if (!matrix) throw new Error("Brak matrycy statusów w artefakcie");

  const labels: Labels = {};
  const chip = /<span[^>]*data-status-axis="([^"]+)"[^>]*data-status-value="([^"]+)"[^>]*>([^<]*)<\/span>/g;
  for (const [, axis, value, text] of matrix[1].matchAll(chip)) {
    labels[axis] ??= {};
    labels[axis][value] = text.trim();
  }
  return labels;
}

const artifactLabels = parseArtifactLabels();

describe("kontrakt etykiet statusów — artefakt Fazy 2 sekcja 04", () => {
  it("podłoga liczności: 6 + 8 + 6 wartości w artefakcie", () => {
    // Bez tego parser, który przestałby cokolwiek znajdować, dawałby zielone
    // porównania na pustych obiektach.
    expect({
      order: Object.keys(artifactLabels.order ?? {}).length,
      payment: Object.keys(artifactLabels.payment ?? {}).length,
      shipment: Object.keys(artifactLabels.shipment ?? {}).length,
    }).toEqual({ order: 6, payment: 8, shipment: 6 });
  });

  it("klucze słownika PL pokrywają się 1:1 z kluczami statusSemantics", () => {
    for (const [axis, values] of Object.entries(statusSemantics)) {
      expect([...Object.keys(plLabels[axis] ?? {})].sort(), `oś ${axis}`).toEqual(
        [...Object.keys(values)].sort(),
      );
    }
    expect(Object.keys(plLabels).sort()).toEqual(Object.keys(statusSemantics).sort());
  });

  it("etykiety PL są co do znaku takie jak w artefakcie", () => {
    expect(plLabels).toEqual(artifactLabels);
  });

  it("EN ma komplet tych samych kluczy i niepuste etykiety", () => {
    for (const axis of Object.keys(statusSemantics)) {
      expect(Object.keys(enLabels[axis] ?? {}).sort(), `oś ${axis}`).toEqual(
        Object.keys(plLabels[axis]).sort(),
      );
      for (const [value, label] of Object.entries(enLabels[axis])) {
        expect(label.trim(), `${axis}.${value}`).not.toBe("");
      }
    }
  });
});
