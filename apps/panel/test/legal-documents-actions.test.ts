/**
 * Akcje ekranu dokumentów prawnych (B4, ADR-129) — cztery rzeczy, których nie
 * widać w typach:
 *
 *   (a) ODMOWA WŁAŚCICIELA (42501 z RLS 0063 albo z jawnej bramki
 *       app.publish_legal_document) dostaje SWÓJ komunikat, a nie surową
 *       treść błędu bazy — i inny niż odmowa „nie ma czego publikować";
 *   (b) `created:false` (treść identyczna z żywą wersją) wraca jako SUKCES
 *       z informacją, że wersja nie powstała. Zamiana tego na błąd kazałaby
 *       najemcy szukać usterki tam, gdzie zadziałała reguła;
 *   (c) LUSTRO `terms_body` aktualizuje ustawienia umów, gdy wiersz
 *       `contract_document` istnieje, NIE tworzy go, gdy nie istnieje, a jego
 *       awaria NIE przewraca zapisu głównego (szkic zostaje w bazie);
 *   (d) `current_version_id` NIE MA w payloadzie zapisu — żywą wersję
 *       przestawia wyłącznie publikacja.
 *
 * Wzorzec: `api-keys-actions.test.ts` — minimalny klient PostgREST bez
 * symulacji RLS. Test woła DOKŁADNIE to, co woła produkcja (server action
 * z FormData), więc mutacja w mapowaniu odmów realnie pali asercję.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LEGAL_DOCUMENT_MESSAGES } from "@/lib/legal-documents";

const TENANT = "00000000-0000-4000-8000-00000000000a";

type DbError = { code?: string; message: string } | null;

interface Scenario {
  upsertError: DbError;
  upsertRows: { id: string }[] | null;
  settingsValue: unknown;
  settingsSelectError: DbError;
  settingsUpdateError: DbError;
  rpcData: unknown;
  rpcError: DbError;
}

const scenario: Scenario = {
  upsertError: null,
  upsertRows: [{ id: "doc-1" }],
  settingsValue: undefined,
  settingsSelectError: null,
  settingsUpdateError: null,
  rpcData: null,
  rpcError: null,
};

const calls = {
  upserts: [] as { payload: Record<string, unknown>; options: unknown }[],
  settingsSelects: 0,
  settingsUpdates: [] as Record<string, unknown>[],
  rpc: [] as { fn: string; args: unknown }[],
};

function thenable<T>(value: T) {
  return { then: <R,>(resolve: (v: T) => R) => Promise.resolve(value).then(resolve) };
}

const supabase = {
  from(table: string) {
    if (table === "legal_documents") {
      return {
        upsert(payload: Record<string, unknown>, options: unknown) {
          calls.upserts.push({ payload, options });
          return {
            select: () =>
              thenable({
                data: scenario.upsertError ? null : scenario.upsertRows,
                error: scenario.upsertError,
              }),
          };
        },
      };
    }
    if (table === "tenant_settings") {
      return {
        select() {
          calls.settingsSelects += 1;
          const chain = {
            eq: () => chain,
            maybeSingle: async () => ({
              data:
                scenario.settingsValue === undefined ? null : { value: scenario.settingsValue },
              error: scenario.settingsSelectError,
            }),
          };
          return chain;
        },
        update(payload: Record<string, unknown>) {
          calls.settingsUpdates.push(payload);
          const chain = {
            eq: () => chain,
            then: <R,>(resolve: (v: { data: null; error: DbError }) => R) =>
              Promise.resolve({ data: null, error: scenario.settingsUpdateError }).then(resolve),
          };
          return chain;
        },
      };
    }
    throw new Error(`nieoczekiwana tabela: ${table}`);
  },
  schema(name: string) {
    if (name !== "app") throw new Error(`nieoczekiwany schemat: ${name}`);
    return {
      rpc: async (fn: string, args: unknown) => {
        calls.rpc.push({ fn, args });
        return { data: scenario.rpcData, error: scenario.rpcError };
      },
    };
  },
};

class FakeAuthError extends Error {}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({ AuthError: FakeAuthError }));
vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => ({ supabase, tenantId: TENANT }),
}));

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const draft = {
  kind: "terms",
  title: "Regulamin",
  body_draft: "Fikcyjna treść regulaminu.",
  locale: "pl",
};

const contractSettings = {
  address: "ul. Przykładowa 10",
  nip: "0000000000",
  email: "umowy@example.invalid",
  terms_version: "DEMO-2026-07",
  terms_body: "Stara treść.",
};

beforeEach(() => {
  scenario.upsertError = null;
  scenario.upsertRows = [{ id: "doc-1" }];
  scenario.settingsValue = undefined;
  scenario.settingsSelectError = null;
  scenario.settingsUpdateError = null;
  scenario.rpcData = null;
  scenario.rpcError = null;
  calls.upserts = [];
  calls.settingsSelects = 0;
  calls.settingsUpdates = [];
  calls.rpc = [];
});

async function save(entries: Record<string, string>) {
  const { saveLegalDocumentDraftAction } = await import(
    "@/app/[locale]/(panel)/dokumenty-prawne/actions"
  );
  return saveLegalDocumentDraftAction({}, form(entries));
}

async function publish(kind: string) {
  const { publishLegalDocumentAction } = await import(
    "@/app/[locale]/(panel)/dokumenty-prawne/actions"
  );
  return publishLegalDocumentAction(kind);
}

describe("zapis szkicu — walidacja wejścia", () => {
  it.each([
    ["pusty tytuł", { ...draft, title: "   " }],
    ["tytuł ponad 120 znaków", { ...draft, title: "x".repeat(121) }],
    ["pusta treść", { ...draft, body_draft: "   " }],
    ["treść ponad 50 000 znaków", { ...draft, body_draft: "x".repeat(50_001) }],
    ["rodzaj spoza pary", { ...draft, kind: "cookies" }],
    ["język spoza pary", { ...draft, locale: "de" }],
  ])("%s → błąd formularza i ZERO zapisu", async (_label, entries) => {
    const state = await save(entries);
    expect(state.formError ?? Object.values(state.fieldErrors ?? {})[0]).toBeDefined();
    expect(calls.upserts, "walidacja przepuściła zapis").toEqual([]);
  });
});

describe("zapis szkicu — payload i odmowy", () => {
  it("payload NIE niesie current_version_id ani tenanta z formularza", async () => {
    await save({ ...draft, tenant_id: "podstawiony", current_version_id: "podstawiony" });

    expect(calls.upserts).toHaveLength(1);
    const payload = calls.upserts[0]!.payload;
    expect(payload.tenant_id).toBe(TENANT);
    expect(payload).not.toHaveProperty("current_version_id");
    expect(payload.kind).toBe("terms");
    expect(payload.body_draft).toBe(draft.body_draft);
  });

  it("odmowa 42501 mapuje się na komunikat „tylko właściciel”, nie na treść z bazy", async () => {
    scenario.upsertError = { code: "42501", message: "new row violates row-level security policy" };
    const state = await save(draft);

    expect(state.formError).toBe(LEGAL_DOCUMENT_MESSAGES.ownerOnly);
    expect(state.formError).not.toContain("row-level security");
    expect(state.success).toBeUndefined();
  });

  it("odmowa CHECK-a (23514) ma WŁASNY komunikat — inny niż odmowa roli", async () => {
    scenario.upsertError = { code: "23514", message: "violates check constraint" };
    const state = await save(draft);

    expect(state.formError).toBe(LEGAL_DOCUMENT_MESSAGES.rejected);
    expect(state.formError).not.toBe(LEGAL_DOCUMENT_MESSAGES.ownerOnly);
  });
});

describe("lustro terms_body → tenant_settings.contract_document", () => {
  it("aktualizuje wiersz, gdy istnieje — i podmienia WYŁĄCZNIE terms_body", async () => {
    scenario.settingsValue = contractSettings;
    const state = await save(draft);

    expect(state.success).toBe("terms");
    expect(state.notice).toBeUndefined();
    expect(calls.settingsUpdates).toHaveLength(1);
    expect(calls.settingsUpdates[0]!.value).toEqual({
      ...contractSettings,
      terms_body: draft.body_draft,
    });
  });

  it("NIE tworzy wiersza, gdy go nie ma — i nie melduje z tego powodu problemu", async () => {
    scenario.settingsValue = undefined;
    const state = await save(draft);

    expect(state.success).toBe("terms");
    expect(state.notice, "brak konfiguracji umów udaje awarię").toBeUndefined();
    expect(calls.settingsUpdates, "lustro założyło wiersz od zera").toEqual([]);
  });

  it("awaria lustra NIE przewraca zapisu głównego — sukces z notatką", async () => {
    scenario.settingsValue = contractSettings;
    scenario.settingsUpdateError = { code: "42501", message: "denied" };
    const state = await save(draft);

    expect(state.success, "zapis szkicu cofnięty przez awarię lustra").toBe("terms");
    expect(state.formError).toBeUndefined();
    expect(state.notice).toBe(LEGAL_DOCUMENT_MESSAGES.mirrorFailed);
  });

  it("nieudany ODCZYT ustawień też kończy się notatką, nie błędem zapisu", async () => {
    scenario.settingsSelectError = { message: "connection reset" };
    const state = await save(draft);

    expect(state.success).toBe("terms");
    expect(state.notice).toBe(LEGAL_DOCUMENT_MESSAGES.mirrorFailed);
    expect(calls.settingsUpdates).toEqual([]);
  });

  it("polityka prywatności NIE dotyka ustawień umów ani razu", async () => {
    scenario.settingsValue = contractSettings;
    const state = await save({ ...draft, kind: "privacy", title: "Polityka prywatności" });

    expect(state.success).toBe("privacy");
    expect(calls.settingsSelects, "lustro odpaliło dla nie-regulaminu").toBe(0);
    expect(calls.settingsUpdates).toEqual([]);
  });

  it("nieudany zapis szkicu NIE uruchamia lustra", async () => {
    scenario.upsertError = { code: "42501", message: "denied" };
    scenario.settingsValue = contractSettings;
    await save(draft);

    expect(calls.settingsSelects).toBe(0);
    expect(calls.settingsUpdates).toEqual([]);
  });
});

describe("publikacja", () => {
  it("woła app.publish_legal_document rodzajem z wejścia po walidacji", async () => {
    scenario.rpcData = { version_id: "v", version_no: 1, version_label: "v1", created: true };
    const result = await publish("terms");

    expect(calls.rpc).toEqual([
      { fn: "publish_legal_document", args: { p_kind: "terms" } },
    ]);
    expect(result).toEqual({ ok: true, created: true, versionLabel: "v1" });
  });

  it("rodzaj spoza pary odbija się BEZ wywołania bazy", async () => {
    const result = await publish("cookies");

    expect(result).toEqual({ ok: false, error: LEGAL_DOCUMENT_MESSAGES.rejected });
    expect(calls.rpc).toEqual([]);
  });

  it("created:false to SUKCES z informacją, że nowa wersja nie powstała", async () => {
    scenario.rpcData = { version_id: "v", version_no: 2, version_label: "v2", created: false };
    const result = await publish("terms");

    expect(result).toEqual({ ok: true, created: false, versionLabel: "v2" });
  });

  it("odmowa 42501 mapuje się na „tylko właściciel”", async () => {
    scenario.rpcError = { code: "42501", message: "legal_document_forbidden" };
    const result = await publish("terms");

    expect(result).toEqual({ ok: false, error: LEGAL_DOCUMENT_MESSAGES.ownerOnly });
  });

  it("brak dokumentu (22023) mówi, co zrobić najpierw — i to co innego niż odmowa roli", async () => {
    scenario.rpcError = { code: "22023", message: "legal_document_not_found" };
    const result = await publish("terms");

    expect(result).toEqual({ ok: false, error: LEGAL_DOCUMENT_MESSAGES.notFound });
    expect(LEGAL_DOCUMENT_MESSAGES.notFound).not.toBe(LEGAL_DOCUMENT_MESSAGES.ownerOnly);
  });

  it("pusta odpowiedź RPC nie udaje udanej publikacji", async () => {
    scenario.rpcData = null;
    const result = await publish("terms");

    expect(result).toEqual({ ok: false, error: LEGAL_DOCUMENT_MESSAGES.publishFailed });
  });
});
