import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Akcje ekranu pól własnych (C6-A1, ADR-118) — kontrakt na TREŚĆ ŻĄDANIA,
 * bez Supabase.
 *
 * Trzy rzeczy naraz:
 *  1. walidacja odrzuca złe wejście PRZED dotknięciem bazy;
 *  2. zapis jest ZAWĘŻONY do tenanta (`.eq("tenant_id", …)`) — bramką
 *     w produkcji jest RLS, ale akcja nie ma prawa polegać wyłącznie na niej;
 *  3. odmowy bazy (42501 z polityki, 23514 z bramki zamrożenia, pusty wynik
 *     UPDATE) zamieniają się w zdanie dla operatora, a nie w surowy błąd
 *     ani — co gorsza — w ciche „zapisano".
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const DEFINITION = "22222222-2222-4222-8222-222222222222";
const NEIGHBOUR = "33333333-3333-4333-8333-333333333333";

interface BuilderCalls {
  from: string[];
  insert: Record<string, unknown> | null;
  updates: Record<string, unknown>[];
  eqs: [string, unknown][];
}

/**
 * Szpieg query-buildera. `select` kończy łańcuch obietnicą, ale bywa też
 * ogniwem pośrednim (odczyt listy) — dlatego zwracany obiekt jest
 * jednocześnie thenable i builderem.
 */
function makeSupabase(results: { data: unknown; error: unknown }[]) {
  const calls: BuilderCalls = { from: [], insert: null, updates: [], eqs: [] };
  let cursor = 0;
  const next = () => results[Math.min(cursor++, results.length - 1)]!;

  const builder: Record<string, unknown> = {
    insert(payload: Record<string, unknown>) {
      calls.insert = payload;
      return Promise.resolve(next());
    },
    update(payload: Record<string, unknown>) {
      calls.updates.push(payload);
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.eqs.push([column, value]);
      return builder;
    },
    is() {
      return builder;
    },
    order() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(next());
    },
    select() {
      return builder;
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(next()).then(resolve);
    },
  };

  const supabase = {
    from(table: string) {
      calls.from.push(table);
      return builder;
    },
  };
  return { supabase, calls };
}

const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/navigation", () => ({ localePath: async (path: string) => `/pl${path}` }));

const { createDefinitionAction, updateDefinitionAction, toggleArchiveAction, moveDefinitionAction } =
  await import("@/app/[locale]/(panel)/organizacja/pola-wlasne/actions");

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const VALID = {
  entity: "customer",
  fieldType: "text",
  label: "Numer uprawnień",
  helpText: "",
  optionsText: "",
  showInPanel: "on",
};

beforeEach(() => {
  requireMember.mockReset();
});

describe("createDefinitionAction", () => {
  it("odrzuca pustą nazwę PRZED dotknięciem bazy", async () => {
    const { supabase, calls } = makeSupabase([{ data: [], error: null }]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await createDefinitionAction({}, form({ ...VALID, label: "   " }));

    expect(state.fieldErrors?.label).toBeTruthy();
    expect(calls.insert, "baza dotknięta mimo błędu walidacji").toBeNull();
  });

  it("odrzuca listę wyboru bez pozycji", async () => {
    const { supabase, calls } = makeSupabase([{ data: [], error: null }]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await createDefinitionAction(
      {},
      form({ ...VALID, fieldType: "select", optionsText: "   \n  " }),
    );

    expect(state.fieldErrors?.optionsText).toBeTruthy();
    expect(calls.insert).toBeNull();
  });

  it("odrzuca pole niewidoczne nigdzie", async () => {
    const { supabase, calls } = makeSupabase([{ data: [], error: null }]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await createDefinitionAction({}, form({ ...VALID, showInPanel: "" }));

    expect(state.fieldErrors?.showInPanel).toBeTruthy();
    expect(calls.insert).toBeNull();
  });

  it("zapisuje z identyfikatorem tenanta i pozycją na końcu listy", async () => {
    const { supabase, calls } = makeSupabase([
      { data: [{ position: 0 }, { position: 3 }], error: null },
      { data: null, error: null },
    ]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    await expect(
      createDefinitionAction({}, form({ ...VALID, fieldType: "select", optionsText: "Alfa\nBeta" })),
    ).rejects.toThrow("REDIRECT:/pl/organizacja/pola-wlasne");

    // DOWÓD IZOLACJI: odczyt sąsiadów zawężony do tenanta, a payload niesie
    // jego identyfikator — nie ufamy wyłącznie polityce RLS.
    expect(calls.eqs).toContainEqual(["tenant_id", TENANT]);
    expect(calls.insert).toMatchObject({
      tenant_id: TENANT,
      entity: "customer",
      field_type: "select",
      options: ["Alfa", "Beta"],
      position: 4,
    });
  });

  it("odmowę polityki tłumaczy na zdanie o roli, nie na surowy błąd bazy", async () => {
    const { supabase } = makeSupabase([
      { data: [], error: null },
      { data: null, error: { code: "42501", message: "new row violates row-level security" } },
    ]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await createDefinitionAction({}, form(VALID));
    expect(state.formError).toContain("właściciel");
    expect(state.formError).not.toContain("row-level security");
  });
});

describe("updateDefinitionAction", () => {
  it("zawęża zapis do tenanta i wiersza", async () => {
    const { supabase, calls } = makeSupabase([{ data: [{ id: DEFINITION }], error: null }]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateDefinitionAction(DEFINITION, {}, form(VALID));

    expect(state.success).toBe("saved");
    expect(calls.eqs).toContainEqual(["tenant_id", TENANT]);
    expect(calls.eqs).toContainEqual(["id", DEFINITION]);
  });

  it("bramkę zamrożenia typu tłumaczy na wskazówkę, co zrobić zamiast tego", async () => {
    const { supabase } = makeSupabase([
      { data: null, error: { code: "23514", message: "check constraint" } },
    ]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateDefinitionAction(DEFINITION, {}, form(VALID));
    expect(state.formError).toContain("Zarchiwizuj");
    expect(state.success).toBeUndefined();
  });

  it("pusty wynik zapisu NIE JEST sukcesem", async () => {
    // Polityka UPDATE odfiltrowała wiersz (członek bez roli właściciela).
    // Ciche „zapisano" byłoby ekranem, który potwierdza czynność, jakiej
    // nie wykonał.
    const { supabase } = makeSupabase([{ data: [], error: null }]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateDefinitionAction(DEFINITION, {}, form(VALID));
    expect(state.success).toBeUndefined();
    expect(state.formError).toContain("właściciel");
  });

  it("odrzuca identyfikator, który nie jest identyfikatorem", async () => {
    const { supabase, calls } = makeSupabase([{ data: [], error: null }]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateDefinitionAction("../../klienci", {}, form(VALID));
    expect(state.formError).toBeTruthy();
    expect(calls.updates).toHaveLength(0);
  });
});

describe("toggleArchiveAction", () => {
  it("archiwizuje znacznikiem czasu, a przywraca zerując go", async () => {
    const archived = makeSupabase([{ data: [{ id: DEFINITION }], error: null }]);
    requireMember.mockResolvedValue({ supabase: archived.supabase, tenantId: TENANT });
    const first = await toggleArchiveAction(DEFINITION, true, {}, new FormData());
    expect(first.success).toBe("archived");
    expect(typeof archived.calls.updates[0]!.archived_at).toBe("string");
    expect(archived.calls.eqs).toContainEqual(["tenant_id", TENANT]);

    const restored = makeSupabase([{ data: [{ id: DEFINITION }], error: null }]);
    requireMember.mockResolvedValue({ supabase: restored.supabase, tenantId: TENANT });
    const second = await toggleArchiveAction(DEFINITION, false, {}, new FormData());
    expect(second.success).toBe("restored");
    expect(restored.calls.updates[0]!.archived_at).toBeNull();
  });

  it("nie istnieje akcja usunięcia definicji", async () => {
    // Archiwizacja zamiast usunięcia jest regułą, nie zwyczajem: gdyby ktoś
    // dopisał tu akcję kasującą, wartości na wierszach straciłyby etykietę
    // i typ. Grant DELETE dla `authenticated` w 0057 też nie istnieje.
    const module = await import("@/app/[locale]/(panel)/organizacja/pola-wlasne/actions");
    expect(Object.keys(module).filter((name) => /delete|usu/i.test(name))).toEqual([]);
  });
});

describe("moveDefinitionAction", () => {
  it("zamienia pozycje z sąsiadem, obie w obrębie tenanta", async () => {
    const { supabase, calls } = makeSupabase([
      { data: { id: DEFINITION, entity: "customer", position: 1 }, error: null },
      {
        data: [
          { id: NEIGHBOUR, position: 0 },
          { id: DEFINITION, position: 1 },
        ],
        error: null,
      },
      { data: [{ id: DEFINITION }], error: null },
      { data: [{ id: NEIGHBOUR }], error: null },
    ]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await moveDefinitionAction(DEFINITION, "up", {}, new FormData());

    expect(state.success).toBe("moved");
    expect(calls.updates).toEqual([{ position: 0 }, { position: 1 }]);
    expect(calls.eqs.filter(([column]) => column === "tenant_id")).toHaveLength(4);
  });

  it("na skraju listy nie robi nic (i nie kłamie o błędzie)", async () => {
    const { supabase, calls } = makeSupabase([
      { data: { id: DEFINITION, entity: "customer", position: 0 }, error: null },
      { data: [{ id: DEFINITION, position: 0 }], error: null },
    ]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await moveDefinitionAction(DEFINITION, "up", {}, new FormData());
    expect(state.success).toBe("moved");
    expect(calls.updates).toHaveLength(0);
  });

  it("przerywa po pierwszym zapisie odfiltrowanym przez politykę", async () => {
    const { supabase, calls } = makeSupabase([
      { data: { id: DEFINITION, entity: "customer", position: 1 }, error: null },
      {
        data: [
          { id: NEIGHBOUR, position: 0 },
          { id: DEFINITION, position: 1 },
        ],
        error: null,
      },
      { data: [], error: null },
    ]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await moveDefinitionAction(DEFINITION, "up", {}, new FormData());
    expect(state.formError).toContain("właściciel");
    // Kluczowe: DRUGI zapis nie poszedł — inaczej lista zostałaby
    // z połową zamiany.
    expect(calls.updates).toHaveLength(1);
  });
});

describe("trasy interaktywne są przypięte do renderu dynamicznego", () => {
  // Statyczny prerender + nonce CSP = strona renderuje się i NIE HYDRATUJE,
  // bez błędu w konsoli (ADR-083). Awaria cicha, więc pilnuje jej test.
  const ROOT = join(__dirname, "..", "app", "[locale]", "(panel)", "organizacja", "pola-wlasne");

  for (const route of ["page.tsx", "nowe/page.tsx", "[definitionId]/page.tsx"]) {
    it(`${route} deklaruje render dynamiczny`, () => {
      const source = readFileSync(join(ROOT, route), "utf8");
      expect(source).toMatch(/export const dynamic = "force-dynamic";/);
      expect(source).not.toMatch(/export (async )?function generateStaticParams/);
    });
  }
});
