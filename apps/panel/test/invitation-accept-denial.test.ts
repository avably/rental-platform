/**
 * Odmowy akceptacji zaproszenia mówią ludzkim głosem (recenzja #334 → ADR-193).
 *
 * STAN ZASTANY (sonda na żywym stacku 2026-08-18, spójna z nagłówkami
 * migracji 0007/0011/0051): odmowy `app.accept_invitation` (P0003–P0007)
 * wracają z PostgREST jako gołe HTTP 500 z ciałem dosłownie
 * `Something went wrong` — bez JSON-a, bez kodu, bez treści RAISE. Akcja
 * przepisywała ten tekst 1:1 do stanu formularza, więc zapraszany dostawał
 * angielski komunikat infrastruktury zamiast powodu odmowy.
 *
 * KONTRAKT: przy odmowie RPC akcja zwraca PRZETŁUMACZONY komunikat
 * (`invitationAccept.denied`, PL/EN wg locale żądania), który nazywa możliwe
 * powody i następny krok — i który NIE niesie ani surowego tekstu stacku,
 * ani tokenu, ani żadnego adresu e-mail (izolacja: komunikat jest STAŁĄ
 * słownika). Uszkodzony token = osobny komunikat o uszkodzonym linku.
 * Ścieżka sukcesu (refresh sesji + redirect) zostaje nietknięta.
 *
 * Tłumaczenia idą przez `createTranslator` nad REALNYMI słownikami — asercje
 * porównują ze słownikiem, nie z literałem w teście, więc redakcja treści
 * nie wywraca suity, a brak klucza tak (fallback = pełna ścieżka klucza,
 * którą łapie porównanie).
 */
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";
import enMessages from "../messages/en.json";

const MESSAGES = { pl: plMessages, en: enMessages } as const;

const activeLocale = vi.hoisted(() => ({ current: "pl" as "pl" | "en" }));

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => activeLocale.current,
  getTranslations: async (namespace?: string) =>
    createTranslator({
      locale: activeLocale.current,
      messages: MESSAGES[activeLocale.current],
      namespace: namespace as never,
      onError: () => {},
    }),
}));

vi.mock("@/lib/navigation", () => ({
  localePath: async (pathname: string, query?: Record<string, string>) =>
    `/${activeLocale.current}${pathname}${query?.next ? `?next=${encodeURIComponent(query.next)}` : ""}`,
}));

// Sterowalna granica Supabase: RPC i sesja — dokładnie to, co widzi akcja.
const supabaseState = vi.hoisted(() => ({
  rpcError: null as { message: string } | null,
  rpcCalls: [] as { fn: string; args: unknown }[],
  refreshCalls: 0,
  session: true,
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    schema: (name: string) => ({
      rpc: async (fn: string, args: unknown) => {
        supabaseState.rpcCalls.push({ fn: `${name}.${fn}`, args });
        return supabaseState.rpcError ? { error: supabaseState.rpcError } : { data: null, error: null };
      },
    }),
    auth: {
      refreshSession: async () => {
        supabaseState.refreshCalls += 1;
        return { data: {}, error: null };
      },
    },
  }),
}));

vi.mock("@/lib/auth", () => ({
  getAuthContext: async () =>
    supabaseState.session ? { user: { email: "zaproszony@test.local" } } : null,
}));

const { acceptInvitationAction } = await import(
  "@/app/[locale]/zaproszenie/[token]/actions"
);

const TOKEN = "a".repeat(64);

function formData(token: string | null): FormData {
  const data = new FormData();
  if (token !== null) data.set("token", token);
  return data;
}

beforeEach(() => {
  activeLocale.current = "pl";
  supabaseState.rpcError = null;
  supabaseState.rpcCalls = [];
  supabaseState.refreshCalls = 0;
  supabaseState.session = true;
});

describe("odmowa RPC → ludzki komunikat, nie surowy tekst stacku", () => {
  it("PL: komunikat ze słownika invitationAccept.denied", async () => {
    supabaseState.rpcError = { message: "Something went wrong" };

    const state = await acceptInvitationAction({}, formData(TOKEN));

    expect(state.error).toBe(plMessages.invitationAccept.denied);
    expect(state.error).not.toContain("Something went wrong");
  });

  it("EN: ten sam klucz w słowniku angielskim", async () => {
    activeLocale.current = "en";
    supabaseState.rpcError = { message: "Something went wrong" };

    const state = await acceptInvitationAction({}, formData(TOKEN));

    expect(state.error).toBe(enMessages.invitationAccept.denied);
    expect(state.error).not.toContain("Something went wrong");
  });

  it("izolacja: komunikat nie niesie tokenu ani żadnego adresu e-mail", async () => {
    supabaseState.rpcError = { message: "Something went wrong" };

    const state = await acceptInvitationAction({}, formData(TOKEN));

    expect(state.error).not.toContain(TOKEN);
    // Stała słownika nie ma prawa nieść adresów — ani zapraszanego, ani
    // z wiersza zaproszenia (do którego akcja celowo NIE sięga — RLS nie
    // widzi go dla zapraszanego, a service-role jest tu zakazany, ADR-099).
    expect(state.error).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  });

  it("komunikat pochodzi WYŁĄCZNIE ze słownika — nie z error.message stacku", async () => {
    supabaseState.rpcError = { message: "PODSTAWIONY-TEKST-STACKU-123" };

    const state = await acceptInvitationAction({}, formData(TOKEN));

    expect(state.error).toBe(plMessages.invitationAccept.denied);
    expect(state.error).not.toContain("PODSTAWIONY-TEKST-STACKU-123");
  });
});

describe("uszkodzony link i ścieżki nietknięte", () => {
  it("token za krótki → komunikat o uszkodzonym linku, RPC w ogóle nie woła się", async () => {
    const state = await acceptInvitationAction({}, formData("krotki"));

    expect(state.error).toBe(plMessages.invitationAccept.invalidLink);
    expect(supabaseState.rpcCalls).toHaveLength(0);
  });

  it("bez sesji → redirect na logowanie z zachowanym next (token co do znaku)", async () => {
    supabaseState.session = false;

    await expect(acceptInvitationAction({}, formData(TOKEN))).rejects.toMatchObject({
      url: `/pl/login?next=${encodeURIComponent(`/zaproszenie/${TOKEN}`)}`,
    });
    expect(supabaseState.rpcCalls).toHaveLength(0);
  });

  it("sukces → odświeżenie sesji (świeży claim) i redirect na pulpit", async () => {
    await expect(acceptInvitationAction({}, formData(TOKEN))).rejects.toMatchObject({
      url: "/pl/",
    });
    expect(supabaseState.rpcCalls).toEqual([
      { fn: "app.accept_invitation", args: { p_token: TOKEN } },
    ]);
    expect(supabaseState.refreshCalls).toBe(1);
  });
});
