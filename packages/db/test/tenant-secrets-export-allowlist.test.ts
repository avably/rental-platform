import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import {
  assertKnownSecretColumns,
  SECRET_COLUMNS,
  TenantExportIsolationError,
} from "../../../apps/panel/lib/export/tenant-full";

/**
 * ALLOWLISTA KOLUMN tenant_secrets W EKSPORCIE (ADR-264) — fail-closed strażnik
 * „nieoczekiwana kolumna" w apps/panel/lib/export/tenant-full.ts.
 *
 * buildSecretsEntry walidował tylko kształt KOPERTY (ciphertext). Przyszła
 * kolumna dołożona do tenant_secrets — być może niosąca materiał wrażliwy —
 * wyszłaby do zrzutu NIEOPATRZONA. assertKnownSecretColumns zamyka to: każdy
 * klucz każdego wiersza musi należeć do allowlisty, inaczej twarda odmowa.
 *
 * Część JEDNOSTKOWA (bez bazy): dodanie fikcyjnej kolumny → błąd; komplet
 * znanych kolumn → przejście. Część INTEGRACYJNA (skipIf bez env): allowlista
 * pokrywa RZECZYWISTE kolumny tabeli co do jednej — inaczej lista odjechała od
 * źródła i strażnik zacząłby palić na legalnym zrzucie (albo, gdyby była za
 * szeroka, przepuszczać kolumnę, której nikt nie ocenił).
 */

// Komplet kolumn tenant_secrets (0024) — lustro allowlisty w module eksportu.
const KNOWN_SECRET_ROW: Record<string, unknown> = {
  tenant_id: "00000000-0000-4000-8000-000000000000",
  key: "globkurier_password",
  ciphertext: "v1:1:aaaa:bbbb:cccc",
  key_version: 1,
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z",
};

describe("allowlista kolumn tenant_secrets w eksporcie (ADR-264) — jednostkowo", () => {
  it("komplet znanych kolumn (0024) przechodzi bez błędu", () => {
    expect(() => assertKnownSecretColumns([KNOWN_SECRET_ROW])).not.toThrow();
  });

  it("pusta lista wierszy przechodzi (brak sekretów to nie naruszenie)", () => {
    expect(() => assertKnownSecretColumns([])).not.toThrow();
  });

  it("FIKCYJNA kolumna spoza allowlisty → TenantExportIsolationError (fail-closed)", () => {
    const drifted = { ...KNOWN_SECRET_ROW, plaintext_password: "hunter2" };
    expect(() => assertKnownSecretColumns([drifted])).toThrow(TenantExportIsolationError);
    expect(() => assertKnownSecretColumns([drifted])).toThrow(/plaintext_password/);
  });

  it("kolumna dryfu pusta w 1. wierszu, obecna w 2. → i tak pali (skan wszystkich wierszy)", () => {
    // Kolumna dołożona z defaultem NULL bywa pusta w części wierszy — strażnik
    // patrzący tylko na pierwszy wiersz by ją przepuścił.
    const rows = [KNOWN_SECRET_ROW, { ...KNOWN_SECRET_ROW, future_column: "x" }];
    expect(() => assertKnownSecretColumns(rows)).toThrow(TenantExportIsolationError);
    expect(() => assertKnownSecretColumns(rows)).toThrow(/future_column/);
  });
});

const REQUIRED_ENV = ["SUPABASE_LOCAL_URL"] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);
const sql = process.env.SUPABASE_LOCAL_URL
  ? postgres(process.env.SUPABASE_LOCAL_URL, { max: 1 })
  : null;

describe.skipIf(!hasEnv)("allowlista kolumn tenant_secrets — zgodność ze źródłem (żywa baza)", () => {
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("allowlista SECRET_COLUMNS == rzeczywiste kolumny public.tenant_secrets", async () => {
    const rows = await sql!<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_secrets'
      order by column_name
    `;
    const actual = rows.map((r) => r.column_name).sort();

    // Równość ZBIORÓW w obie strony: żadna kolumna tabeli poza allowlistą
    // (inaczej strażnik paliłby na legalnym zrzucie), i żaden martwy wpis
    // w allowliście (inaczej po powrocie tej nazwy przeszłaby bez oceny).
    expect([...SECRET_COLUMNS].sort()).toEqual(actual);

    // Kontrola pozytywna: komplet kolumn ze źródła przechodzi przez strażnika.
    const sampleRow = Object.fromEntries(actual.map((c) => [c, null]));
    expect(() => assertKnownSecretColumns([sampleRow])).not.toThrow();
  });
});
