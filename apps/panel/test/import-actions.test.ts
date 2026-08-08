/**
 * Akcja ekranu importu katalogu (C3, ADR-112) — warstwa HTTP na atrapach
 * (wzorzec export-routes.test.ts / api-keys-actions.test.ts):
 *
 *  (a) ANON: odmowa 401 PRZED JAKĄKOLWIEK PRACĄ — formData nie jest czytane,
 *      plik nie jest otwierany (sonda §3 briefu od strony akcji; odmowę
 *      z bazy przy pominięciu warstwy akcji dowodzi import-csv.test.ts).
 *  (b) bramki pliku: brak/zły typ/za duży — przed parsowaniem treści.
 *  (c) DWUFAZOWOŚĆ: krok preview zwraca podsumowanie i NIE dotyka bazy
 *      (klient Supabase jest miną — każde dotknięcie wybucha); zapis robi
 *      wyłącznie krok confirm przez app.import_catalog.
 *  (d) payload RPC nie niesie ŻADNEGO tenant_id — najemca wyłącznie z sesji
 *      (sonda §2 briefu od strony payloadu).
 *  (e) limit wierszy i błąd zapisu wracają jako jawne komunikaty.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { IMPORT_ROW_LIMIT } from "@/lib/import/catalog-csv";
import { CATALOG_IMPORT_INITIAL_STATE } from "@/lib/import/action-state";

class FakeAuthError extends Error {
  status = 401;
  code = "unauthorized";
}

const harness: {
  authorized: boolean;
  requireMemberCalls: number;
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
  rpcResult: { data: unknown; error: { code?: string; message: string } | null };
} = {
  authorized: true,
  requireMemberCalls: 0,
  rpcCalls: [],
  rpcResult: { data: { created: 1, updated: 0, tiers: 0 }, error: null },
};

/** Mina: preview nie ma prawa dotknąć PostgREST-a (from/select/insert/...). */
const supabaseMine = new Proxy(
  {
    schema(name: string) {
      if (name !== "app") throw new Error(`nieoczekiwany schemat: ${name}`);
      return {
        rpc: (fn: string, args: Record<string, unknown>) => {
          harness.rpcCalls.push({ fn, args });
          return Promise.resolve(harness.rpcResult);
        },
      };
    },
    from() {
      throw new Error("akcja dotknęła PostgREST poza RPC — preview ma być bez odczytu tabel");
    },
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      throw new Error(`akcja dotknęła supabase.${String(prop)}`);
    },
  },
);

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock("@/lib/auth", () => ({ AuthError: FakeAuthError }));
vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => {
    harness.requireMemberCalls += 1;
    if (!harness.authorized) throw new FakeAuthError("Wymagane zalogowanie.");
    return {
      supabase: supabaseMine,
      tenantId: "00000000-0000-4000-8000-00000000000a",
      role: "staff",
    };
  },
}));

/** FormData licząca odczyty — dowód „auth PRZED dotknięciem formularza". */
class TrackedFormData extends FormData {
  reads = 0;
  override get(name: string) {
    this.reads += 1;
    return super.get(name);
  }
}

const HEADER =
  "product_id;name;description;base_price_day_grosze;deposit_grosze;auto_increment_multiplier;buffer_before_days;buffer_after_days;active;tier_days;tier_multiplier;tier_label;tier_sort_order";

function csvFile(lines: string[], name = "katalog.csv", type = "text/csv"): File {
  return new File([[HEADER, ...lines].join("\r\n")], name, { type });
}

function form(file: File | null, step: "preview" | "confirm"): TrackedFormData {
  const data = new TrackedFormData();
  if (file) data.set("file", file);
  data.set("step", step);
  return data;
}

const NEW_PRODUCT_LINE = ";Nowy produkt;;10000;5000;1.0;1;1;true;;;;";

async function action() {
  const { catalogImportAction } = await import(
    "@/app/[locale]/(panel)/katalog/import/actions"
  );
  return catalogImportAction;
}

beforeEach(() => {
  harness.authorized = true;
  harness.requireMemberCalls = 0;
  harness.rpcCalls = [];
  harness.rpcResult = { data: { created: 1, updated: 0, tiers: 0 }, error: null };
});

describe("catalogImportAction (C3, ADR-112)", () => {
  it("ANON: odmowa PRZED czytaniem formularza i pliku — zero pracy na treści", async () => {
    harness.authorized = false;
    const textSpy = vi.fn();
    const file = csvFile([NEW_PRODUCT_LINE]);
    (file as unknown as { text: () => Promise<string> }).text = textSpy;
    const data = form(file, "confirm");

    const state = await (await action())(CATALOG_IMPORT_INITIAL_STATE, data);

    expect(state.formError).toBeTruthy();
    expect(harness.requireMemberCalls).toBe(1);
    // Formularz NIETKNIĘTY, plik NIEOTWARTY, zero RPC.
    expect(data.reads).toBe(0);
    expect(textSpy).not.toHaveBeenCalled();
    expect(harness.rpcCalls).toEqual([]);
  });

  it("brak pliku → jawny komunikat, zero RPC", async () => {
    const state = await (await action())(CATALOG_IMPORT_INITIAL_STATE, form(null, "preview"));
    expect(state.formError).toBe("catalogImport.errors.noFile");
    expect(harness.rpcCalls).toEqual([]);
  });

  it("zły typ pliku → odmowa przed parsowaniem", async () => {
    const file = new File(["%PDF-1.4"], "faktura.pdf", { type: "application/pdf" });
    const state = await (await action())(CATALOG_IMPORT_INITIAL_STATE, form(file, "preview"));
    expect(state.formError).toBe("catalogImport.errors.badType");
  });

  it("plik ponad limit rozmiaru → odmowa przed parsowaniem", async () => {
    const file = new File([new Uint8Array(6 * 1024 * 1024)], "katalog.csv", {
      type: "text/csv",
    });
    const state = await (await action())(CATALOG_IMPORT_INITIAL_STATE, form(file, "preview"));
    expect(state.formError).toBe("catalogImport.errors.tooLarge");
  });

  it("PREVIEW: podsumowanie bez dotykania bazy (nowe produkty nie wymagają odczytu)", async () => {
    const state = await (await action())(
      CATALOG_IMPORT_INITIAL_STATE,
      form(csvFile([NEW_PRODUCT_LINE]), "preview"),
    );
    expect(state.formError).toBeUndefined();
    expect(state.phase).toBe("preview");
    expect(state.preview).toMatchObject({ created: 1, updated: 0, tiers: 0, rowCount: 1 });
    expect(harness.rpcCalls).toEqual([]);
  });

  it("PREVIEW z błędami wiersza: lista błędów z numerami, bez podsumowania do zatwierdzenia", async () => {
    const state = await (await action())(
      CATALOG_IMPORT_INITIAL_STATE,
      form(csvFile([";Zepsuty;;12.50;0;1.0;1;1;true;;;;"]), "preview"),
    );
    expect(state.phase).toBe("preview");
    expect(state.issues).toEqual([
      { row: 2, code: "badInteger", column: "base_price_day_grosze", value: "12.50" },
    ]);
    expect(state.preview).toBeUndefined();
    expect(harness.rpcCalls).toEqual([]);
  });

  it("CONFIRM: zapis JEDNYM wywołaniem app.import_catalog; payload BEZ tenant_id (najemca z sesji)", async () => {
    const state = await (await action())(
      CATALOG_IMPORT_INITIAL_STATE,
      form(csvFile([NEW_PRODUCT_LINE]), "confirm"),
    );
    expect(state.phase).toBe("done");
    expect(state.result).toEqual({ created: 1, updated: 0, tiers: 0 });
    expect(harness.rpcCalls).toHaveLength(1);
    expect(harness.rpcCalls[0].fn).toBe("import_catalog");

    const rows = harness.rpcCalls[0].args.p_rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    // Sonda §2 od strony payloadu: ŻADEN wiersz nie niesie tenant_id.
    for (const row of rows) expect(Object.keys(row)).not.toContain("tenant_id");
  });

  it("CONFIRM z błędem zapisu → jawny komunikat, katalog bez zmian po stronie stanu", async () => {
    harness.rpcResult = { data: null, error: { code: "22023", message: "odmowa" } };
    const state = await (await action())(
      CATALOG_IMPORT_INITIAL_STATE,
      form(csvFile([NEW_PRODUCT_LINE]), "confirm"),
    );
    expect(state.phase).toBe("idle");
    expect(state.formError).toBe("catalogImport.errors.server");
  });

  it(`ponad ${IMPORT_ROW_LIMIT} wierszy → jawny komunikat o limicie, zero RPC`, async () => {
    const lines = Array.from({ length: IMPORT_ROW_LIMIT + 1 }, () => NEW_PRODUCT_LINE);
    const state = await (await action())(
      CATALOG_IMPORT_INITIAL_STATE,
      form(csvFile(lines), "preview"),
    );
    expect(state.formError).toBe("catalogImport.errors.limit");
    expect(harness.rpcCalls).toEqual([]);
  });

  it("pusty plik danych (sam nagłówek) → jawny komunikat", async () => {
    const state = await (await action())(
      CATALOG_IMPORT_INITIAL_STATE,
      form(csvFile([]), "preview"),
    );
    expect(state.formError).toBe("catalogImport.errors.empty");
  });
});
