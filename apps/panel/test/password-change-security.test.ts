/**
 * ZMIANA HASŁA ZE ZNAJOMOŚCI HASŁA — sonda bezpieczeństwa (U11a, ADR-144).
 *
 * Trzy reguły, każda z obu stron (jest/nie ma, sukces/odmowa):
 *
 *  1. LIMIT PRÓB w DWÓCH wymiarach — per IP i per UŻYTKOWNIK. Bramka
 *     „obecne hasło" jest z definicji wektorem zgadywania, a wymiar sam po IP
 *     dawałby atakowi rozproszonemu świeży licznik na każdy adres.
 *  2. IZOLACJA KONT — zmiana hasła użytkownika A nie rusza ANI sesji, ANI
 *     hasła użytkownika B. To ta klasa błędu, o którą chodzi: operacja
 *     globalna udająca operację na własnym koncie. Dowodzimy jej na
 *     ZACHOWANIU (podstawiony GoTrue z sesjami dwóch kont), nie na skanie
 *     źródła, plus noga strukturalna: żadne wywołanie nie sięga po admin API.
 *  3. ODMOWA JEDNOLITA — złe hasło, hasło o innej długości i hasło
 *     różniące się jednym znakiem dają TEN SAM komunikat i ten sam koszt
 *     (każde zgadnięcie kosztuje jedną rundę do dostawcy; żadne nie odpada
 *     lokalnie na długości, bo to byłaby wyrocznia i o treści, i o czasie).
 *
 * Dostawca jest PODSTAWIONY, ale modeluje GoTrue tam, gdzie to ma znaczenie:
 * `updateUser({password})` wylogowuje wszystkie sesje użytkownika POZA tą,
 * która zmianę wykonała (empiria ADR-122 D3), a `signInWithPassword` odmawia
 * jednym błędem niezależnie od tego, czym różniło się zgadnięcie.
 *
 * `getTranslations` karmione PRAWDZIWYMI messages/pl.json — asercje
 * porównują tekst, który operator naprawdę zobaczy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import pl from "../messages/pl.json";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  permanentRedirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  getTranslations: async (namespace: string) => {
    const messages: Record<string, unknown> = pl;
    return (key: string) => {
      const namespaceMessages = messages[namespace];
      const value =
        typeof namespaceMessages === "object" && namespaceMessages !== null
          ? (namespaceMessages as Record<string, unknown>)[key]
          : undefined;
      if (typeof value !== "string") throw new Error(`brak tłumaczenia ${namespace}.${key}`);
      return value;
    };
  },
}));

let currentHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

interface RateLimitCall {
  key: string;
  limit: number;
  windowSeconds: number;
  prefix: string;
}
let rateLimitCalls: RateLimitCall[] = [];
/** Fragment klucza, którego kubełek jest wyczerpany (null = wszystkie wolne). */
let rateLimitFailFor: string | null = null;

vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "panel-auth-rl",
  checkRateLimit: async (
    key: string,
    opts: { limit: number; windowSeconds: number; prefix: string },
  ) => {
    rateLimitCalls.push({ key, ...opts });
    const success = rateLimitFailFor === null || !key.includes(rateLimitFailFor);
    return { success, remaining: success ? 1 : 0 };
  },
}));

// @avably/security/client-ip CELOWO bez mocka — klucz limitu ma pochodzić
// z zaufanego źródła, a nie z deklaracji klienta (L2, ADR-106).

const sendPasswordChangedEmail = vi.fn(async (_input: unknown): Promise<string | undefined> =>
  undefined,
);
vi.mock("@/lib/password-changed-email", () => ({
  sendPasswordChangedEmail: (input: unknown) => sendPasswordChangedEmail(input),
}));

/* ===================== PODSTAWIONY DOSTAWCA (GoTrue) ===================== */

interface FakeUser {
  id: string;
  email: string;
  password: string;
}
interface FakeSession {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

const USER_A: FakeUser = { id: "user-a", email: "a@wypozyczalnia.test", password: "StareHaslo!123" };
const USER_B: FakeUser = { id: "user-b", email: "b@wypozyczalnia.test", password: "InneHaslo!456" };

class FakeAuthProvider {
  users: FakeUser[] = [];
  sessions: FakeSession[] = [];
  /** Ślad każdego dotknięcia admin API — powinien zostać PUSTY. */
  adminCalls: string[] = [];
  private seq = 0;

  reset(): void {
    this.users = [{ ...USER_A }, { ...USER_B }];
    this.sessions = [];
    this.adminCalls = [];
    this.seq = 0;
    this.openSession(USER_A.id);
    this.openSession(USER_A.id);
    this.openSession(USER_B.id);
  }

  openSession(userId: string): FakeSession {
    this.seq += 1;
    const session: FakeSession = {
      id: `sess-${this.seq}`,
      userId,
      accessToken: `access-${this.seq}`,
      refreshToken: `refresh-${this.seq}`,
    };
    this.sessions.push(session);
    return session;
  }

  sessionsOf(userId: string): FakeSession[] {
    return this.sessions.filter((session) => session.userId === userId);
  }

  passwordOf(userId: string): string {
    return this.users.find((user) => user.id === userId)!.password;
  }
}

const provider = new FakeAuthProvider();

/** Wywołania per klient — do asercji „klient użytkownika B nietknięty". */
interface FakeClient {
  label: string;
  calls: string[];
  sessionId: string | null;
  auth: Record<string, unknown>;
}

function makeClient(label: string, sessionId: string | null): FakeClient {
  const client: FakeClient = { label, calls: [], sessionId, auth: {} };

  const held = () => provider.sessions.find((session) => session.id === client.sessionId) ?? null;

  /**
   * Admin API jest tu WYŁĄCZNIE po to, żeby dało się je przyłapać: każdy
   * dostęp zostaje w śladzie, a wywołanie kasuje sesje WSZYSTKICH kont —
   * czyli modeluje prawdziwy zasięg klucza serwisowego. Test wymaga, żeby
   * akcja nigdy tu nie zajrzała.
   */
  const admin = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        provider.adminCalls.push(`${label}:admin.${prop}`);
        client.calls.push(`admin.${prop}`);
        return async () => {
          provider.sessions = [];
          return { data: null, error: null };
        };
      },
    },
  );

  client.auth = {
    admin,

    async getClaims() {
      const session = held();
      client.calls.push("getClaims");
      if (!session) return { data: null, error: { message: "no session" } };
      const user = provider.users.find((candidate) => candidate.id === session.userId)!;
      return {
        data: { claims: { sub: user.id, email: user.email, aal: "aal1", app_metadata: {} } },
        error: null,
      };
    },

    async signInWithPassword({ email, password }: { email: string; password: string }) {
      client.calls.push("signInWithPassword");
      const user = provider.users.find((candidate) => candidate.email === email);
      // Odmowa dostawcy jest JEDNA — nie zdradza, czym różniło się zgadnięcie.
      if (!user || user.password !== password) {
        return {
          data: { session: null, user: null },
          error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 },
        };
      }
      const session = provider.openSession(user.id);
      client.sessionId = session.id;
      return {
        data: {
          session: {
            access_token: session.accessToken,
            refresh_token: session.refreshToken,
          },
          user: { id: user.id },
        },
        error: null,
      };
    },

    async updateUser({ password }: { password?: string }) {
      client.calls.push("updateUser");
      const session = held();
      if (!session) return { data: null, error: { code: "session_not_found", status: 401 } };
      const user = provider.users.find((candidate) => candidate.id === session.userId)!;
      if (password === user.password) {
        return { data: null, error: { code: "same_password", status: 422 } };
      }
      user.password = password!;
      // GoTrue: zmiana hasła wylogowuje wszystkie sesje TEGO użytkownika poza
      // tą, która zmianę wykonała (ADR-122 D3, empiria v2.192.0).
      provider.sessions = provider.sessions.filter(
        (candidate) => candidate.userId !== user.id || candidate.id === session.id,
      );
      return { data: { user: { id: user.id } }, error: null };
    },

    async setSession({
      access_token,
      refresh_token,
    }: {
      access_token: string;
      refresh_token: string;
    }) {
      client.calls.push(`setSession:${access_token}`);
      const session = provider.sessions.find(
        (candidate) =>
          candidate.accessToken === access_token && candidate.refreshToken === refresh_token,
      );
      if (!session) return { data: null, error: { message: "refresh_token_not_found" } };
      client.sessionId = session.id;
      return { data: { session }, error: null };
    },

    async signOut({ scope }: { scope?: string } = {}) {
      client.calls.push(`signOut:${scope ?? "global"}`);
      const session = held();
      if (!session) return { error: null };
      provider.sessions = provider.sessions.filter((candidate) => {
        if (candidate.userId !== session.userId) return true;
        if (scope === "others") return candidate.id === session.id;
        if (scope === "local") return candidate.id !== session.id;
        return false;
      });
      if (scope !== "others") client.sessionId = null;
      return { error: null };
    },
  };

  return client;
}

/** Klient sesji przeglądarki operatora A (ten, który dostaje cookies). */
let sessionClient: FakeClient;
/** Klient „drugiej przeglądarki" — użytkownik B. Musi zostać NIETKNIĘTY. */
let bystanderClient: FakeClient;
/** Klienty bez cookies tworzone przez akcję do sprawdzenia hasła. */
let reauthClients: FakeClient[] = [];

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => sessionClient,
}));

vi.mock("@avably/db", () => ({
  createServerClient: () => {
    const client = makeClient(`reauth-${reauthClients.length + 1}`, null);
    reauthClients.push(client);
    return client;
  },
}));

const { changePasswordAction, signOutOtherDevicesAction } = await import(
  "@/app/[locale]/(panel)/bezpieczenstwo/password-actions"
);

const DENIED = pl.security.passwordDenied;
const TOO_MANY = pl.authError.tooManyRequests;
const NEW_PASSWORD = "ZupelnieNowe!987";

function changeForm(currentPassword: string, password = NEW_PASSWORD, confirm = password): FormData {
  const form = new FormData();
  form.set("currentPassword", currentPassword);
  form.set("password", password);
  form.set("passwordConfirm", confirm);
  return form;
}

beforeEach(() => {
  provider.reset();
  rateLimitCalls = [];
  rateLimitFailFor = null;
  reauthClients = [];
  currentHeaders = new Map([["x-forwarded-for", "203.0.113.7"]]);
  sendPasswordChangedEmail.mockClear();
  sendPasswordChangedEmail.mockResolvedValue(undefined);
  // Sesja A1 to bieżąca karta operatora; A2 to jego drugie urządzenie.
  sessionClient = makeClient("sesja-A", provider.sessionsOf(USER_A.id)[0]!.id);
  bystanderClient = makeClient("sesja-B", provider.sessionsOf(USER_B.id)[0]!.id);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* ========================= 1. LIMIT PRÓB ========================= */

describe("sonda 1 — limit prób w dwóch wymiarach (IP i użytkownik)", () => {
  it("udana zmiana zużywa OBA kubełki, w przestrzeni kluczy auth panelu", async () => {
    await changePasswordAction({}, changeForm(USER_A.password));

    expect(rateLimitCalls.map((call) => call.key)).toEqual([
      "password-change:ip:203.0.113.7",
      `password-change:user:${USER_A.id}`,
    ]);
    for (const call of rateLimitCalls) {
      expect(call.prefix, "limit poza przestrzenią auth panelu").toBe("panel-auth-rl");
      expect(call.windowSeconds).toBeGreaterThan(0);
      expect(call.limit).toBeGreaterThan(0);
    }
  });

  it("wyczerpany kubełek UŻYTKOWNIKA odcina PRZED sprawdzeniem hasła", async () => {
    rateLimitFailFor = `user:${USER_A.id}`;
    const state = await changePasswordAction({}, changeForm(USER_A.password));

    expect(state.formError).toBe(TOO_MANY);
    expect(reauthClients, "akcja poszła do dostawcy mimo odcięcia").toHaveLength(0);
    expect(provider.passwordOf(USER_A.id)).toBe(USER_A.password);
  });

  it("wyczerpany kubełek IP odcina PRZED odczytem sesji i przed dostawcą", async () => {
    rateLimitFailFor = "ip:203.0.113.7";
    const state = await changePasswordAction({}, changeForm(USER_A.password));

    expect(state.formError).toBe(TOO_MANY);
    expect(sessionClient.calls).not.toContain("getClaims");
    expect(reauthClients).toHaveLength(0);
  });

  it("klucz IP bierze OSTATNI hop, nie deklarację klienta", async () => {
    currentHeaders = new Map([["x-forwarded-for", "6.6.6.6, 198.51.100.7"]]);
    await changePasswordAction({}, changeForm(USER_A.password));

    expect(rateLimitCalls[0]!.key).toBe("password-change:ip:198.51.100.7");
  });

  it("wylogowanie pozostałych urządzeń też ma własny kubełek", async () => {
    rateLimitFailFor = "sign-out-others";
    const state = await signOutOtherDevicesAction({}, new FormData());

    expect(state.formError).toBe(TOO_MANY);
    expect(provider.sessionsOf(USER_A.id)).toHaveLength(2);
  });
});

/* ===================== 2. IZOLACJA KONT ===================== */

describe("sonda 2 — zmiana hasła A nie rusza konta B", () => {
  it("po udanej zmianie: sesje A zredukowane do świeżej, sesje i hasło B nietknięte", async () => {
    const state = await changePasswordAction({}, changeForm(USER_A.password));

    expect(state.success).toBe(pl.security.passwordSuccess);
    expect(provider.passwordOf(USER_A.id)).toBe(NEW_PASSWORD);

    // A: obie stare sesje znikły, została WYŁĄCZNIE ta ustanowiona przy
    // sprawdzeniu hasła — i to ona siedzi w cookies operatora.
    const aSessions = provider.sessionsOf(USER_A.id);
    expect(aSessions).toHaveLength(1);
    expect(sessionClient.sessionId).toBe(aSessions[0]!.id);
    expect(sessionClient.calls).toContain(`setSession:${aSessions[0]!.accessToken}`);

    // Unieważnienie pozostałych sesji jest JAWNE, a nie odziedziczone po
    // zachowaniu konkretnej wersji dostawcy (ADR-122 D3).
    expect(reauthClients[0]!.calls).toEqual([
      "signInWithPassword",
      "updateUser",
      "signOut:others",
    ]);

    // B: nic. Ani sesje, ani hasło, ani jedno wywołanie na jego kliencie.
    expect(provider.sessionsOf(USER_B.id)).toHaveLength(1);
    expect(provider.passwordOf(USER_B.id)).toBe(USER_B.password);
    expect(bystanderClient.calls).toEqual([]);
  });

  it("„wyloguj ze wszystkich urządzeń\" tnie tylko POZOSTAŁE sesje A", async () => {
    const state = await signOutOtherDevicesAction({}, new FormData());

    expect(state.success).toBe(pl.security.revokeSuccess);
    // Bieżąca karta zostaje zalogowana — to jest sens `scope: "others"`.
    expect(provider.sessionsOf(USER_A.id).map((session) => session.id)).toEqual([
      sessionClient.sessionId,
    ]);
    expect(provider.sessionsOf(USER_B.id)).toHaveLength(1);
    expect(bystanderClient.calls).toEqual([]);
  });

  it("żadna z akcji nie sięga po admin API (klucz serwisowy)", async () => {
    await changePasswordAction({}, changeForm(USER_A.password));
    await signOutOtherDevicesAction({}, new FormData());

    expect(provider.adminCalls, `dotknięcie admin API: ${provider.adminCalls.join(", ")}`).toEqual(
      [],
    );
  });

  it("bez sesji akcja przekierowuje na logowanie, zamiast cokolwiek zmieniać", async () => {
    sessionClient = makeClient("sesja-wygasla", null);

    await expect(changePasswordAction({}, changeForm(USER_A.password))).rejects.toThrow(
      /REDIRECT:.*\/login/,
    );
    expect(provider.passwordOf(USER_A.id)).toBe(USER_A.password);
  });
});

/* ===================== 3. ODMOWA JEDNOLITA ===================== */

describe("sonda 3 — odmowa nie jest wyrocznią", () => {
  const guesses: [string, string][] = [
    ["hasło o innej długości", "x"],
    ["hasło różniące się jednym znakiem", "StareHaslo!124"],
    ["hasło zupełnie inne", "CoszupelnieInnego!9999999"],
  ];

  it.each(guesses)("%s → ten sam komunikat i ta sama runda do dostawcy", async (_name, guess) => {
    const state = await changePasswordAction({}, changeForm(guess));

    expect(state.formError).toBe(DENIED);
    expect(state.fieldErrors, "błąd pola zdradziłby, na czym poległo zgadnięcie").toBeUndefined();
    // Koszt jest ten sam: każde zgadnięcie idzie do dostawcy. Odrzut lokalny
    // (np. na długości) byłby wyrocznią również w czasie odpowiedzi.
    expect(reauthClients).toHaveLength(1);
    expect(reauthClients[0]!.calls).toContain("signInWithPassword");
  });

  it("wszystkie trzy zgadnięcia dają IDENTYCZNY komunikat", async () => {
    const messages: (string | undefined)[] = [];
    for (const [, guess] of guesses) {
      reauthClients = [];
      messages.push((await changePasswordAction({}, changeForm(guess))).formError);
    }
    expect(new Set(messages).size, `rozjazd komunikatów: ${messages.join(" | ")}`).toBe(1);
    expect(messages[0]).toBe(DENIED);
  });

  it("nieudane zgadnięcie nie rusza ani hasła, ani sesji — także bieżącej", async () => {
    await changePasswordAction({}, changeForm("ZupelnieZle!000"));

    expect(provider.passwordOf(USER_A.id)).toBe(USER_A.password);
    expect(provider.sessionsOf(USER_A.id)).toHaveLength(2);
    expect(sessionClient.sessionId).toBe(provider.sessionsOf(USER_A.id)[0]!.id);
  });
});

/* ===================== POZOSTAŁE ZACHOWANIA ===================== */

describe("zmiana hasła — pozostałe zachowania", () => {
  it("po udanej zmianie leci powiadomienie na adres konta", async () => {
    await changePasswordAction({}, changeForm(USER_A.password));

    expect(sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordChangedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: USER_A.email, locale: "pl" }),
    );
  });

  it("nieudane zgadnięcie NIE wysyła powiadomienia", async () => {
    await changePasswordAction({}, changeForm("ZupelnieZle!000"));
    expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it("nowe hasło krótsze niż wymaganie odpada przy POLU, bez rundy do dostawcy", async () => {
    const state = await changePasswordAction({}, changeForm(USER_A.password, "krotkie"));

    expect(state.fieldErrors?.password).toBeTypeOf("string");
    expect(reauthClients).toHaveLength(0);
    expect(provider.passwordOf(USER_A.id)).toBe(USER_A.password);
  });

  it("rozjechane powtórzenie odpada przy POLU powtórzenia", async () => {
    const state = await changePasswordAction(
      {},
      changeForm(USER_A.password, NEW_PASSWORD, "CosInnego!12345"),
    );

    expect(state.fieldErrors?.passwordConfirm).toBeTypeOf("string");
    expect(reauthClients).toHaveLength(0);
  });

  it("odrzut dostawcy (to samo hasło) siada przy polu i sprząta świeżą sesję", async () => {
    const state = await changePasswordAction({}, changeForm(USER_A.password, USER_A.password));

    expect(state.fieldErrors?.password).toBe(pl.authError.samePassword);
    // Sesja ustanowiona do sprawdzenia hasła nie ma po co żyć dalej: hasło
    // się nie zmieniło, więc konto zostaje z dokładnie tymi sesjami, co przed.
    expect(provider.sessionsOf(USER_A.id)).toHaveLength(2);
    expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
  });
});
