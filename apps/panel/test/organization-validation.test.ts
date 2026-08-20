import { describe, expect, it } from "vitest";

import {
  organizationInputFromFormData,
  organizationSchema,
} from "@/app/[locale]/(panel)/organizacja/organization-validation";

/**
 * Walidacja samoobsługi organizacji (U12, ADR-225) — lustro kontraktu
 * `app.update_organization` (0093). Autorytatywna pozostaje funkcja bazy;
 * tu pilnujemy, że UI odbija dwa pola i ten sam zamknięty zbiór języków.
 */
describe("organizationSchema (lustro app.update_organization)", () => {
  it("przycina nazwę i przepuszcza poprawny język", () => {
    const r = organizationSchema.safeParse({ name: "  Wypożyczalnia  ", locale: "en" });
    expect(r.success && r.data).toEqual({ name: "Wypożyczalnia", locale: "en" });
  });

  it("pusta nazwa (same spacje) odrzucona", () => {
    expect(organizationSchema.safeParse({ name: "   ", locale: "pl" }).success).toBe(false);
  });

  it("nazwa > 200 po btrim odrzucona; == 200 przyjęta", () => {
    expect(organizationSchema.safeParse({ name: "x".repeat(201), locale: "pl" }).success).toBe(false);
    expect(organizationSchema.safeParse({ name: "x".repeat(200), locale: "pl" }).success).toBe(true);
  });

  it("język spoza {pl,en} odrzucony", () => {
    expect(organizationSchema.safeParse({ name: "Demo", locale: "de" }).success).toBe(false);
    expect(organizationSchema.safeParse({ name: "Demo", locale: "" }).success).toBe(false);
  });

  it("oba dozwolone języki przechodzą", () => {
    expect(organizationSchema.safeParse({ name: "Demo", locale: "pl" }).success).toBe(true);
    expect(organizationSchema.safeParse({ name: "Demo", locale: "en" }).success).toBe(true);
  });
});

describe("organizationInputFromFormData", () => {
  it("czyta OBA pola (lekcja 8b: pole w schemacie ≠ pole odczytane z FormData)", () => {
    const fd = new FormData();
    fd.set("name", "Wypożyczalnia");
    fd.set("locale", "en");
    expect(organizationInputFromFormData(fd)).toEqual({ name: "Wypożyczalnia", locale: "en" });
  });

  it("brakujące pola dają puste stringi (nie undefined)", () => {
    expect(organizationInputFromFormData(new FormData())).toEqual({ name: "", locale: "" });
  });
});
