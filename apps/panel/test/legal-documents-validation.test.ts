/**
 * Walidacja wejścia dokumentów prawnych (B4, ADR-129) — LUSTRO CHECK-ów 0063.
 *
 * Wartość tych asercji nie jest w tym, że zod działa, tylko w tym, że LICZBY
 * są te same po obu stronach: tytuł 1..120 i treść 1..50 000 mierzone PO
 * przycięciu (baza liczy `char_length(btrim(...))`). Rozjazd o jeden znak
 * daje ekran, który przyjmuje tekst i dostaje 23514 z bazy — czyli komunikat
 * bez pola i bez rady.
 */
import { describe, expect, it } from "vitest";

import {
  LEGAL_BODY_MAX_LENGTH,
  LEGAL_TITLE_MAX_LENGTH,
  legalDocumentDraftInputFromFormData,
  legalDocumentDraftSchema,
  shortChecksum,
  withMirroredTermsBody,
} from "@/lib/legal-documents";

const valid = {
  kind: "terms",
  title: "Regulamin",
  body_draft: "Fikcyjna treść regulaminu.",
  locale: "pl",
};

describe("legalDocumentDraftSchema — lustro CHECK-ów 0063", () => {
  it("przycina tytuł i treść, zachowując rodzaj i język", () => {
    expect(
      legalDocumentDraftSchema.parse({
        ...valid,
        title: "  Regulamin  ",
        body_draft: "  Fikcyjna treść regulaminu.  ",
      }),
    ).toEqual(valid);
  });

  it("granice długości są DOKŁADNIE takie jak w bazie", () => {
    expect(
      legalDocumentDraftSchema.safeParse({ ...valid, title: "x".repeat(LEGAL_TITLE_MAX_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      legalDocumentDraftSchema.safeParse({
        ...valid,
        title: "x".repeat(LEGAL_TITLE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      legalDocumentDraftSchema.safeParse({
        ...valid,
        body_draft: "x".repeat(LEGAL_BODY_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      legalDocumentDraftSchema.safeParse({
        ...valid,
        body_draft: "x".repeat(LEGAL_BODY_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it.each([
    ["title", ""],
    ["title", "   "],
    ["body_draft", ""],
    ["body_draft", "   "],
    ["kind", "cookies"],
    ["locale", "de"],
  ])("odrzuca niepoprawne %s", (field, value) => {
    expect(legalDocumentDraftSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it("odrzuca dodatkowe klucze — wołający nie dopisze `current_version_id`", () => {
    expect(
      legalDocumentDraftSchema.safeParse({ ...valid, current_version_id: "podstawione" }).success,
    ).toBe(false);
  });
});

describe("legalDocumentDraftInputFromFormData", () => {
  it("czyta komplet pól formularza", () => {
    const data = new FormData();
    for (const [key, value] of Object.entries(valid)) data.set(key, value);
    expect(legalDocumentDraftInputFromFormData(data)).toEqual(valid);
  });

  it("brak pola daje pusty string, a nie `undefined` (odmowa z komunikatem)", () => {
    expect(legalDocumentDraftInputFromFormData(new FormData())).toEqual({
      kind: "",
      title: "",
      body_draft: "",
      locale: "",
    });
  });
});

describe("withMirroredTermsBody — lustro do tenant_settings.contract_document", () => {
  const settings = {
    address: "ul. Przykładowa 10",
    nip: "0000000000",
    email: "umowy@example.invalid",
    terms_version: "DEMO-2026-07",
    terms_body: "Stara treść.",
  };

  it("podmienia WYŁĄCZNIE terms_body, resztę kluczy zostawia nietkniętą", () => {
    expect(withMirroredTermsBody(settings, "Nowa treść.")).toEqual({
      ...settings,
      terms_body: "Nowa treść.",
    });
  });

  it("nie tworzy wiersza od zera — brak wartości znaczy „lustro nie dotyczy”", () => {
    // CHECK z 0026 wymaga kompletu pięciu kluczy, a ten ekran zna jeden.
    // `null` mówi wołającemu: nie zapisuj niczego.
    for (const value of [undefined, null, "tekst", 42, ["a"]]) {
      expect(withMirroredTermsBody(value, "Nowa treść.")).toBeNull();
    }
  });

  it("wiersz bez terms_body nie jest wierszem umowy — lustro odpuszcza", () => {
    expect(withMirroredTermsBody({ address: "ul. Przykładowa 10" }, "Nowa treść.")).toBeNull();
  });
});

describe("shortChecksum", () => {
  it("skraca sha256 do 12 znaków (porównanie na oko, nie dowód)", () => {
    expect(shortChecksum("a".repeat(64))).toBe("a".repeat(12));
  });
});
