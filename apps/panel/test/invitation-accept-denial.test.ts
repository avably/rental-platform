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
 * KONTRAKT (ADR-193, rozszerzony w ADR-196): przy odmowie RPC akcja
 * klasyfikuje stan PO ODCZYCIE — woła `app.invitation_state` (0087) i zwraca
 * PRZETŁUMACZONY komunikat PER STAN (`invitationAccept.state*`, PL/EN wg
 * locale żądania) dla każdej z sześciu etykiet zamkniętego zbioru. FAIL-CLOSED:
 * etykieta spoza zbioru albo błąd odczytu → ogólny `invitationAccept.denied`.
 * Żaden komunikat NIE niesie surowego tekstu stacku, tokenu ani adresu
 * e-mail (izolacja: komunikaty są STAŁYMI słownika). Uszkodzony token =
 * osobny komunikat o uszkodzonym linku, bez pytania bazy. Ścieżka sukcesu
 * (refresh sesji + redirect) zostaje nietknięta i NIE czyta stanu.
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
// `stateResult` startuje jako BŁĄD odczytu: to jest domyślna, fail-closed
// gałąź (ogólny `denied`), a testy per-stan jawnie podstawiają etykietę.
const supabaseState = vi.hoisted(() => ({
  rpcError: null as { message: string } | null,
  stateResult: { data: null as unknown, error: { message: "state read failed" } as {
    message: string;
  } | null },
  rpcCalls: [] as { fn: string; args: unknown }[],
  refreshCalls: 0,
  session: true,
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    schema: (name: string) => ({
      rpc: async (fn: string, args: unknown) => {
        supabaseState.rpcCalls.push({ fn: `${name}.${fn}`, args });
        if (fn === "invitation_state") {
          return supabaseState.stateResult.error
            ? { data: null, error: supabaseState.stateResult.error }
            : { data: supabaseState.stateResult.data, error: null };
        }
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
  supabaseState.stateResult = { data: null, error: { message: "state read failed" } };
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

/**
 * Klasyfikacja PO ODCZYCIE (ADR-196): sześć stanów zamkniętego zbioru z
 * `app.invitation_state` (0087) → sześć komunikatów słownika, w OBU locale.
 * Oczekiwania idą ze słowników (nie z literałów w teście) — redakcja treści
 * nie wywraca suity, a brak klucza w którymkolwiek języku tak (fallback
 * next-intl = pełna ścieżka klucza, którą łapie porównanie ze stałą).
 */
describe("odmowa RPC → komunikat PER STAN z odczytu invitation_state (ADR-196)", () => {
  const STATE_TO_KEY = [
    ["not_found", "stateNotFound"],
    ["used", "stateUsed"],
    ["revoked", "stateRevoked"],
    ["expired", "stateExpired"],
    ["email_mismatch", "stateEmailMismatch"],
    ["open", "stateOpen"],
  ] as const;

  for (const locale of ["pl", "en"] as const) {
    for (const [state, key] of STATE_TO_KEY) {
      it(`${locale}: stan '${state}' → komunikat ${key} ze słownika`, async () => {
        activeLocale.current = locale;
        supabaseState.rpcError = { message: "Something went wrong" };
        supabaseState.stateResult = { data: state, error: null };

        const result = await acceptInvitationAction({}, formData(TOKEN));

        expect(result.error).toBe(MESSAGES[locale].invitationAccept[key]);
        expect(result.error).not.toBe(MESSAGES[locale].invitationAccept.denied);
        expect(result.error).not.toContain("Something went wrong");
      });
    }
  }

  it("stan czyta się DOPIERO po odmowie akceptu i tym samym tokenem", async () => {
    supabaseState.rpcError = { message: "Something went wrong" };
    supabaseState.stateResult = { data: "expired", error: null };

    await acceptInvitationAction({}, formData(TOKEN));

    expect(supabaseState.rpcCalls).toEqual([
      { fn: "app.accept_invitation", args: { p_token: TOKEN } },
      { fn: "app.invitation_state", args: { p_token: TOKEN } },
    ]);
  });

  it("fail-closed: etykieta SPOZA zamkniętego zbioru → ogólny denied", async () => {
    supabaseState.rpcError = { message: "Something went wrong" };
    supabaseState.stateResult = { data: "nowy-nieznany-stan", error: null };

    const result = await acceptInvitationAction({}, formData(TOKEN));

    expect(result.error).toBe(plMessages.invitationAccept.denied);
  });

  it("fail-closed: błąd odczytu stanu → ogólny denied (bez wyjątku na ścieżce)", async () => {
    supabaseState.rpcError = { message: "Something went wrong" };
    supabaseState.stateResult = { data: null, error: { message: "read exploded" } };

    const result = await acceptInvitationAction({}, formData(TOKEN));

    expect(result.error).toBe(plMessages.invitationAccept.denied);
    expect(result.error).not.toContain("read exploded");
  });

  it("izolacja: ŻADEN z sześciu komunikatów per stan (PL i EN) nie niesie tokenu ani adresu e-mail", async () => {
    // Asercja na STAŁYCH słownika — dokładnie to, co widzi człowiek; komunikat
    // z adresem albo tokenem byłby regresem ADR-181 niezależnie od kodu akcji.
    for (const locale of ["pl", "en"] as const) {
      for (const [, key] of STATE_TO_KEY) {
        const message = MESSAGES[locale].invitationAccept[key];
        expect(message, `${locale}.${key} istnieje w słowniku`).toBeTruthy();
        expect(message).not.toContain(TOKEN);
        expect(message).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      }
    }
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
