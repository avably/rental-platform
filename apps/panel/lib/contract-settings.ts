import { z } from "zod";

export const CONTRACT_DOCUMENT_SETTINGS_KEY = "contract_document";

const optionalNip = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().max(30, "NIP jest za długi (maks. 30 znaków).").nullable(),
);

/** Lustro CHECK-a `tenant_settings_contract_document_valid` z migracji 0026. */
export const contractDocumentSettingsSchema = z
  .object({
    address: z
      .string()
      .trim()
      .min(1, "Podaj adres firmy.")
      .max(500, "Adres jest za długi (maks. 500 znaków)."),
    nip: optionalNip,
    email: z
      .string()
      .trim()
      .email("Podaj poprawny adres e-mail.")
      .max(320, "Adres e-mail jest za długi (maks. 320 znaków)."),
    terms_version: z
      .string()
      .trim()
      .min(1, "Podaj wersję warunków.")
      .max(100, "Wersja warunków jest za długa (maks. 100 znaków)."),
    terms_body: z
      .string()
      .trim()
      .min(1, "Podaj treść warunków.")
      .max(50_000, "Treść warunków jest za długa (maks. 50 000 znaków)."),
  })
  .strict();

export type ContractDocumentSettings = z.infer<typeof contractDocumentSettingsSchema>;

export class ContractSettingsError extends Error {
  constructor(message = "Brak poprawnych ustawień dokumentu umowy.") {
    super(message);
    this.name = "ContractSettingsError";
  }
}

export function contractDocumentSettingsFromRows(
  rows: ReadonlyArray<{ key: string; value: unknown }>,
): ContractDocumentSettings {
  const row = rows.find((candidate) => candidate.key === CONTRACT_DOCUMENT_SETTINGS_KEY);
  const parsed = contractDocumentSettingsSchema.safeParse(row?.value);
  if (!parsed.success) throw new ContractSettingsError();
  return parsed.data;
}

const stringValue = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value : "";

export function contractDocumentSettingsInputFromFormData(formData: FormData) {
  return {
    address: stringValue(formData.get("address")),
    nip: stringValue(formData.get("nip")),
    email: stringValue(formData.get("email")),
    terms_version: stringValue(formData.get("terms_version")),
    terms_body: stringValue(formData.get("terms_body")),
  };
}
