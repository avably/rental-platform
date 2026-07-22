import { describe, expect, it } from "vitest";

import {
  ContractSettingsError,
  contractDocumentSettingsFromRows,
  contractDocumentSettingsInputFromFormData,
  contractDocumentSettingsSchema,
} from "@/lib/contract-settings";

const valid = {
  address: "ul. Długa 1, 00-001 Warszawa",
  nip: "5250000000",
  email: "umowy@example.pl",
  terms_version: "2026-07",
  terms_body: "Warunki najmu.",
};

describe("contractDocumentSettingsSchema", () => {
  it("przycina pola i zamienia pusty NIP na null", () => {
    expect(
      contractDocumentSettingsSchema.parse({
        ...valid,
        address: `  ${valid.address}  `,
        nip: "   ",
        email: ` ${valid.email} `,
        terms_version: " 2026-07 ",
        terms_body: " Warunki najmu. ",
      }),
    ).toEqual({ ...valid, nip: null });
  });

  it.each([
    ["address", ""],
    ["address", "x".repeat(501)],
    ["nip", "x".repeat(31)],
    ["email", "nie-email"],
    ["email", `${"x".repeat(310)}@example.pl`],
    ["terms_version", ""],
    ["terms_version", "x".repeat(101)],
    ["terms_body", ""],
    ["terms_body", "x".repeat(50_001)],
  ])("odrzuca niepoprawne %s", (field, value) => {
    expect(contractDocumentSettingsSchema.safeParse({ ...valid, [field]: value }).success).toBe(
      false,
    );
  });

  it("odrzuca dodatkowe klucze", () => {
    expect(contractDocumentSettingsSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });
});

describe("contractDocumentSettingsFromRows", () => {
  it("czyta ustawienia z właściwego wiersza", () => {
    expect(
      contractDocumentSettingsFromRows([
        { key: "inne", value: {} },
        { key: "contract_document", value: valid },
      ]),
    ).toEqual(valid);
  });

  it("rzuca błąd domenowy dla braku lub złego kształtu", () => {
    expect(() => contractDocumentSettingsFromRows([])).toThrow(ContractSettingsError);
    expect(() =>
      contractDocumentSettingsFromRows([{ key: "contract_document", value: { address: "x" } }]),
    ).toThrow(ContractSettingsError);
  });
});

describe("contractDocumentSettingsInputFromFormData", () => {
  it("czyta wszystkie pola formularza", () => {
    const data = new FormData();
    for (const [key, value] of Object.entries(valid)) data.set(key, value);
    expect(contractDocumentSettingsInputFromFormData(data)).toEqual(valid);
  });
});
