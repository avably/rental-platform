/**
 * Anti-abuse USTAWIENIA NOWEGO HASŁA (reset/confirm) — domknięcie L2/ADR-106.
 *
 * L2 objął login, register i reset REQUEST; `resetConfirmAction` została
 * wyłącznie za sesją recovery z linku e-mail — bez dławienia. Sesja mówi,
 * KTO wchodzi, nie ILE razy: `updateUser` można było powtarzać bez końca, a
 * odpowiedzi dostawcy są wyrocznią (`same_password` = trafienie w aktualne
 * hasło konta). Trasa bez sesji i tak kosztowała rundę do dostawcy na żądanie.
 *
 * Bramka CI dla czterech reguł:
 *  1. KLUCZ NIE Z GOŁEGO x-forwarded-for — akcja idzie przez
 *     clientIpFromHeaders (moduł PRAWDZIWY, nie mock), więc podrobiony prefiks
 *     XFF nie kupuje świeżego licznika. Próg i okno przybite na sztywno:
 *     zmiana ma być świadomą zmianą testu i ADR, nie przypadkiem.
 *  2. LIMIT PRZED DOSTAWCĄ — po odcięciu ZERO dotknięcia sesji i `updateUser`
 *     (żadnej sondy, żadnej rundy sieciowej do GoTrue).
 *  3. LIMIT PRZED BRAMKĄ SESJI — odcięcie wygrywa z komunikatem o wygasłym
 *     linku, a każda próba (także ta bez sesji) zużywa budżet. Inaczej
 *     przestawienie limitera za bramkę zostawiłoby dziurę niewidoczną w diffie.
 *  4. KOMUNIKAT JEDNOLITY z pozostałymi trasami auth — dosłownie ten sam
 *     obiekt odpowiedzi co reset request przy limicie (`authError.tooManyRequests`).
 *
 * Wzorzec i konwencje mocków: test/auth-anti-abuse.test.ts. `getTranslations`
 * karmione PRAWDZIWYM messages/pl.json — asercje porównują tekst, który
 * użytkownik naprawdę zobaczy.
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
      if (typeof value !== "string") {
        throw new Error(`brak tłumaczenia ${namespace}.${key}`);
      }
      return value;
    };
  },
}));

/** Nagłówki żądania — sterowane per przypadek (podrabianie XFF). */
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

// UWAGA: @avably/security/client-ip celowo BEZ mocka — reguła „ostatni hop,
// nie deklaracja klienta" jest przedmiotem tych testów.

// Reset request wchodzi tu WYŁĄCZNIE jako wzorzec komunikatu przy limicie
// (porównanie odpowiedzi); jego CAPTCHA ma przepuszczać.
vi.mock("@avably/security/turnstile", () => ({
  verifyTurnstile: async () => ({ ok: true }),
}));

const updateUser = vi.fn(async () => ({ error: null }));
const resetPasswordForEmail = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth: { updateUser, resetPasswordForEmail } }),
}));

/** Sesja recovery — sterowana per przypadek (jest / wygasła). */
let authContext: unknown = { user: { id: "u1", email: "kto@test.local" } };
const getAuthContext = vi.fn(async () => authContext);
vi.mock("@/lib/auth", () => ({ getAuthContext: () => getAuthContext() }));

const { resetConfirmAction } = await import("@/app/[locale]/(auth)/reset/confirm/actions");
const { resetRequestAction } = await import("@/app/[locale]/(auth)/reset/actions");

const TOO_MANY = pl.authError.tooManyRequests;

function confirmForm(password = "NoweHaslo!12345"): FormData {
  const form = new FormData();
  form.set("password", password);
  return form;
}

/** Sukces to przekierowanie — połykamy sygnał i oddajemy URL. */
async function runConfirm(form = confirmForm()): Promise<{ error?: string } | { url: string }> {
  try {
    return await resetConfirmAction({}, form);
  } catch (error) {
    if (error instanceof RedirectSignal) return { url: error.url };
    throw error;
  }
}

function ipCall(): RateLimitCall | undefined {
  return rateLimitCalls.find((call) => call.key.startsWith("reset-confirm:ip:"));
}

beforeEach(() => {
  rateLimitCalls = [];
  rateLimitFailFor = null;
  currentHeaders = new Map([["x-forwarded-for", "203.0.113.7"]]);
  authContext = { user: { id: "u1", email: "kto@test.local" } };
  updateUser.mockClear();
  resetPasswordForEmail.mockClear();
  getAuthContext.mockClear();
});

describe("klucz limitu: zaufane IP, nie deklaracja klienta", () => {
  it("podrobiony prefiks XFF nie zmienia klucza (liczy się ostatni hop)", async () => {
    currentHeaders = new Map([["x-forwarded-for", "6.6.6.6, 198.51.100.7"]]);
    await runConfirm();

    expect(ipCall()?.key, "klucz limitu wziął deklarację klienta zamiast hopu proxy").toBe(
      "reset-confirm:ip:198.51.100.7",
    );
  });

  it("x-real-ip (nagłówek platformy) wygrywa z x-forwarded-for", async () => {
    currentHeaders = new Map([
      ["x-real-ip", "198.51.100.9"],
      ["x-forwarded-for", "6.6.6.6"],
    ]);
    await runConfirm();

    expect(ipCall()?.key).toBe("reset-confirm:ip:198.51.100.9");
  });

  it("próg, okno i przestrzeń kluczy zgodne z aneksem ADR-106 (5/h/IP)", async () => {
    await runConfirm();

    expect(ipCall()).toEqual({
      key: "reset-confirm:ip:203.0.113.7",
      limit: 5,
      windowSeconds: 3600,
      prefix: "panel-auth-rl",
    });
  });

  it("wymiar jest JEDEN — kontowego nie ma, bo tożsamość niesie dopiero sesja", async () => {
    await runConfirm();

    expect(rateLimitCalls).toHaveLength(1);
  });
});

describe("odcięcie: przed dostawcą i przed bramką sesji", () => {
  it("po odcięciu ZERO dotknięcia sesji i zero zapisu hasła", async () => {
    rateLimitFailFor = "reset-confirm:ip:";

    expect(await runConfirm()).toEqual({ error: TOO_MANY });
    expect(
      getAuthContext,
      "limiter stoi ZA odczytem sesji — runda do dostawcy mimo odcięcia",
    ).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("wygasła sesja recovery przy odciętym limicie: komunikat limitu, nie o linku", async () => {
    authContext = null;
    rateLimitFailFor = "reset-confirm:ip:";

    expect(await runConfirm()).toEqual({ error: TOO_MANY });
  });

  it("próba bez ważnej sesji też zużywa budżet (inaczej limit da się ominąć)", async () => {
    authContext = null;

    expect(await runConfirm()).toEqual({
      error: "Sesja resetu wygasła lub link jest nieprawidłowy. Poproś o nowy link.",
    });
    expect(ipCall(), "nieudana próba nie doszła do limitera").toBeDefined();
  });

  it("odmowa jest identyczna z pozostałymi trasami auth (jednolity komunikat)", async () => {
    rateLimitFailFor = "reset-confirm:ip:";
    const confirmDenied = await runConfirm();

    rateLimitFailFor = "reset:ip:";
    const requestForm = new FormData();
    requestForm.set("email", "kto@test.local");
    const requestDenied = await resetRequestAction({}, requestForm);

    expect(confirmDenied).toEqual({ error: TOO_MANY });
    expect(requestDenied, "komunikat reset/confirm rozjechał się z resztą tras").toEqual(
      confirmDenied,
    );
  });
});

describe("ścieżka szczęśliwa dalej działa", () => {
  it("w budżecie: hasło zapisane, przekierowanie na login z potwierdzeniem", async () => {
    const result = await runConfirm();

    expect(updateUser).toHaveBeenCalledWith({ password: "NoweHaslo!12345" });
    expect(result).toHaveProperty("url");
    expect((result as { url: string }).url).toContain("/login");
    expect((result as { url: string }).url).toContain("reset=ok");
  });
});
