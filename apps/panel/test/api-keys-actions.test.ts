/**
 * Akcje ekranu kluczy API (M1, ADR-108) — dowody, których nie widać w typach:
 *
 *   (a) DO BAZY IDZIE WYŁĄCZNIE sha256 + prefiks — surowy klucz nie występuje
 *       w payloadzie INSERT-u (dowód §6.4 od strony GENERATORA; strona bazy
 *       ma własny dowód: CHECK 64-hex w packages/db/test/api-keys.test.ts).
 *       Hash liczony jest z PEŁNEGO klucza (para do dowodu mutacyjnego M1 po
 *       stronie weryfikacji — generator i weryfikator muszą liczyć to samo).
 *   (b) SUROWY KLUCZ wraca dokładnie RAZ (stan akcji) i ma zadeklarowany
 *       format avbl_ + 64 hex.
 *   (c) tenant_id pochodzi z SESJI — formData nie ma jak go podstawić.
 *   (d) odwołanie jest tenant-scoped i jednorazowe (revoked_at nie „świeżeje").
 *
 * Wzorzec: domains-retry.test.ts (minimalny klient PostgREST bez symulacji
 * RLS — filtry nakładane przez akcję są jedyną barierą, więc ich zdjęcie
 * widać w wyniku natychmiast).
 */
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";

interface ApiKeyRecord extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  revoked_at: string | null;
}

let apiKeys: ApiKeyRecord[] = [];
let insertPayloads: Record<string, unknown>[] = [];
let sessionTenantId: string | null = TENANT_A;

type Row = Record<string, unknown>;

class Query {
  private filters: [string, unknown][] = [];
  private isFilters: [string, unknown][] = [];

  constructor(
    private readonly op: "select" | "update" | "insert",
    private readonly payload?: Row,
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  is(column: string, value: unknown): this {
    this.isFilters.push([column, value]);
    return this;
  }

  private rows(): ApiKeyRecord[] {
    return apiKeys.filter(
      (row) =>
        this.filters.every(([col, val]) => row[col] === val) &&
        this.isFilters.every(([col, val]) => row[col] === val),
    );
  }

  private run(): { data: Row[] | null; error: { code?: string; message: string } | null } {
    if (this.op === "select") return { data: this.rows(), error: null };
    if (this.op === "update") {
      const matched = this.rows();
      for (const row of matched) Object.assign(row, this.payload);
      return { data: matched, error: null };
    }
    const inserted = this.payload as Partial<ApiKeyRecord>;
    insertPayloads.push({ ...inserted });
    const row: ApiKeyRecord = {
      id: `key-${apiKeys.length + 1}`,
      tenant_id: String(inserted.tenant_id),
      name: String(inserted.name),
      key_hash: String(inserted.key_hash),
      key_prefix: String(inserted.key_prefix),
      revoked_at: null,
    };
    apiKeys.push(row);
    return { data: [row], error: null };
  }

  then<T>(resolve: (value: ReturnType<Query["run"]>) => T) {
    return Promise.resolve(this.run()).then(resolve);
  }
}

const supabase = {
  from(table: string) {
    if (table !== "api_keys") throw new Error(`nieoczekiwana tabela: ${table}`);
    return {
      select: () => new Query("select"),
      update: (payload: Row) => new Query("update", payload),
      insert: (payload: Row) => new Query("insert", payload),
    };
  },
};

class FakeAuthError extends Error {}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({ AuthError: FakeAuthError }));
vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => {
    if (!sessionTenantId) throw new FakeAuthError("Wymagane zalogowanie.");
    return { supabase, tenantId: sessionTenantId };
  },
}));

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

beforeEach(() => {
  apiKeys = [];
  insertPayloads = [];
  sessionTenantId = TENANT_A;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateApiKeyAction (M1, ADR-108)", () => {
  it("payload INSERT-u niesie WYŁĄCZNIE hash i prefiks — surowy klucz nigdy (§6.4)", async () => {
    const { generateApiKeyAction } = await import(
      "@/app/[locale]/(panel)/ustawienia-api/api-keys-actions"
    );
    const state = await generateApiKeyAction({}, form({ name: "WordPress firmowy" }));

    expect(state.formError).toBeUndefined();
    expect(state.generatedKey).toMatch(/^avbl_[0-9a-f]{64}$/);
    expect(insertPayloads).toHaveLength(1);

    const payload = insertPayloads[0]!;
    // Hash z PEŁNEGO klucza (lustro weryfikacji — dowód M1 od generatora).
    expect(payload.key_hash).toBe(sha256(state.generatedKey!));
    expect(payload.key_prefix).toBe(state.generatedKey!.slice(0, 13));
    // Surowy klucz (jego entropia poza prefiksem) NIE występuje w payloadzie.
    expect(JSON.stringify(payload)).not.toContain(state.generatedKey!.slice(13));
    // tenant_id z SESJI, nie z formularza.
    expect(payload.tenant_id).toBe(TENANT_A);
  });

  it("tenant_id w formData jest ignorowany — źródłem jest sesja (§6.3)", async () => {
    const { generateApiKeyAction } = await import(
      "@/app/[locale]/(panel)/ustawienia-api/api-keys-actions"
    );
    await generateApiKeyAction({}, form({ name: "Podstawiony tenant", tenant_id: TENANT_B, tenantId: TENANT_B }));
    expect(insertPayloads[0]!.tenant_id).toBe(TENANT_A);
  });

  it("pusta / za długa nazwa → błąd pola, ZERO INSERT-u", async () => {
    const { generateApiKeyAction } = await import(
      "@/app/[locale]/(panel)/ustawienia-api/api-keys-actions"
    );
    const empty = await generateApiKeyAction({}, form({ name: "   " }));
    expect(empty.fieldErrors?.name).toBeDefined();
    const long = await generateApiKeyAction({}, form({ name: "x".repeat(81) }));
    expect(long.fieldErrors?.name).toBeDefined();
    expect(insertPayloads).toEqual([]);
  });

  it("dwa wygenerowane klucze są różne (entropia, nie licznik)", async () => {
    const { generateApiKeyAction } = await import(
      "@/app/[locale]/(panel)/ustawienia-api/api-keys-actions"
    );
    const first = await generateApiKeyAction({}, form({ name: "Pierwszy" }));
    const second = await generateApiKeyAction({}, form({ name: "Drugi" }));
    expect(first.generatedKey).not.toBe(second.generatedKey);
  });
});

describe("revokeApiKeyAction (M1, ADR-108)", () => {
  const seeded = (): ApiKeyRecord => ({
    id: "key-a",
    tenant_id: TENANT_A,
    name: "Klucz A",
    key_hash: "a".repeat(64),
    key_prefix: "avbl_aaaaaaaa",
    revoked_at: null,
  });

  it("odwołuje własny klucz raz; drugie odwołanie NIE świeżeje daty", async () => {
    apiKeys = [seeded()];
    const { revokeApiKeyAction } = await import(
      "@/app/[locale]/(panel)/ustawienia-api/api-keys-actions"
    );
    const first = await revokeApiKeyAction({}, form({ keyId: "key-a" }));
    expect(first.success).toBe("key-a");
    const stamped = apiKeys[0]!.revoked_at;
    expect(stamped).not.toBeNull();

    const second = await revokeApiKeyAction({}, form({ keyId: "key-a" }));
    expect(second.formError).toBeDefined();
    expect(apiKeys[0]!.revoked_at).toBe(stamped);
  });

  it("klucz CUDZEGO tenanta nietknięty — filtr tenant-scoped na wierzchu RLS", async () => {
    apiKeys = [{ ...seeded(), id: "key-b", tenant_id: TENANT_B }];
    const { revokeApiKeyAction } = await import(
      "@/app/[locale]/(panel)/ustawienia-api/api-keys-actions"
    );
    const state = await revokeApiKeyAction({}, form({ keyId: "key-b" }));
    expect(state.formError).toBeDefined();
    expect(apiKeys[0]!.revoked_at).toBeNull();
  });

  it("brak keyId → błąd bez dotykania bazy", async () => {
    const { revokeApiKeyAction } = await import(
      "@/app/[locale]/(panel)/ustawienia-api/api-keys-actions"
    );
    const state = await revokeApiKeyAction({}, form({}));
    expect(state.formError).toBeDefined();
  });
});
