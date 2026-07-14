/**
 * Testy jednostkowe sanityzacji `next` (open-redirect) — nie wymagają
 * Supabase, więc biegną zawsze (bez describe.skipIf).
 */
import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/validation";

describe("safeNextPath — ochrona przed open-redirect", () => {
  it("przepuszcza ścieżki wewnętrzne", () => {
    expect(safeNextPath("/zaproszenie/abc123")).toBe("/zaproszenie/abc123");
    expect(safeNextPath("/organizacja/nowa")).toBe("/organizacja/nowa");
    expect(safeNextPath("/")).toBe("/");
  });

  it("odrzuca absolutne URL-e i protocol-relative", () => {
    expect(safeNextPath("https://zły.example/phish")).toBeNull();
    expect(safeNextPath("http://zły.example")).toBeNull();
    expect(safeNextPath("//zły.example")).toBeNull();
  });

  it("odrzuca ścieżki z backslashem (część przeglądarek normalizuje \\ do /)", () => {
    expect(safeNextPath("/\\zły.example")).toBeNull();
    expect(safeNextPath("\\\\zły.example")).toBeNull();
  });

  it("odrzuca wartości puste i nie-stringowe", () => {
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(42)).toBeNull();
    expect(safeNextPath("relatywna/bez/slasha")).toBeNull();
  });
});
