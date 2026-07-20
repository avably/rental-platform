/**
 * Bramka CI dla reguły „komunikat dostawcy nigdy nie jest komunikatem dla
 * użytkownika" (ADR-051).
 *
 * Regresja tutaj nie wywala builda ani typów — po prostu użytkownik dostaje
 * angielski żargon dostawcy w polskim interfejsie. Dokładnie tak było na
 * produkcji: ekran rejestracji pokazał „email rate limit exceeded", bo akcja
 * robiła `return { error: error.message }`.
 *
 * Dlatego testy jadą przez CAŁE akcje serwerowe, a nie tylko przez sam
 * mapper: to `actions.ts` decyduje, co ląduje na ekranie, i to tam wraca
 * przeciek, jeśli ktoś kiedyś „uprości" mapowanie z powrotem do `.message`.
 *
 * `getTranslations` jest zamockowane PRAWDZIWYMI plikami messages/{pl,en}.json
 * — asercje porównują do tekstu, który użytkownik naprawdę zobaczy, i pilnują
 * przy okazji, że klucz w ogóle istnieje w obu locale.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

/** Surowa treść dostawcy z obserwacji produkcyjnej — NIE ma prawa wyjść na ekran. */
const RAW_PROVIDER_MESSAGE = "email rate limit exceeded";

let currentLocale = "pl";

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
  getLocale: async () => currentLocale,
  getTranslations: async (namespace: string) => {
    // `Record<string, unknown>`, nie `Record<string, Record<string, string>>`:
    // drzewo messages ma zagnieżdżenia głębsze niż dwa poziomy (np.
    // emailLog.status.sent), więc płaski typ byłby kłamstwem — a sprawdzenie
    // i tak robimy w locie, poniżej.
    const messages: Record<string, unknown> = currentLocale === "pl" ? pl : en;
    return (key: string) => {
      const namespaceMessages = messages[namespace];
      const value =
        typeof namespaceMessages === "object" && namespaceMessages !== null
          ? (namespaceMessages as Record<string, unknown>)[key]
          : undefined;
      // next-intl w produkcji oddałby wtedy surowy identyfikator klucza —
      // tu ma być twardy błąd, inaczej test przeszedłby na „authError.generic"
      // wyświetlonym użytkownikowi jako tekst.
      if (typeof value !== "string") {
        throw new Error(`brak tłumaczenia ${namespace}.${key} dla locale ${currentLocale}`);
      }
      return value;
    };
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-for", "127.0.0.1"]]),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

// Limity i CAPTCHA po NASZEJ stronie nie są przedmiotem tych testów.
vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "test",
  checkRateLimit: async () => ({ success: true }),
}));
vi.mock("@avably/security/turnstile", () => ({
  verifyTurnstile: async () => ({ ok: true }),
}));
vi.mock("@/lib/post-auth-next", () => ({ setPostAuthNext: () => {} }));

/** Błąd, który zwróci Supabase Auth — sterowany per przypadek testowy. */
let providerError: unknown = null;
/** Kontekst sesji resetu; `null` = link wygasł (nasza ścieżka, nie dostawcy). */
let resetSession: { userId: string } | null = { userId: "u1" };

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signUp: async () => ({ error: providerError }),
      updateUser: async () => ({ error: providerError }),
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  getAuthContext: async () => resetSession,
}));

const { registerAction } = await import("@/app/[locale]/(auth)/register/actions");
const { resetConfirmAction } = await import("@/app/[locale]/(auth)/reset/confirm/actions");
const { authErrorKey } = await import("@/app/[locale]/(auth)/auth-error");

/**
 * Błąd w kształcie, w jakim oddaje go SDK dostawcy (`AuthApiError`):
 * treść po angielsku + `code` + `status`.
 */
function providerAuthError(message: string, status: number, code?: string): Error {
  return Object.assign(new Error(message), { status, code, __isAuthError: true });
}

async function register(): Promise<string | undefined> {
  const form = new FormData();
  form.set("email", "kto@test.local");
  form.set("password", "Haslo!12345678");
  const state = await registerAction({}, form);
  return state.error;
}

async function resetConfirm(): Promise<string | undefined> {
  const form = new FormData();
  form.set("password", "Haslo!12345678");
  const state = await resetConfirmAction({}, form);
  return state.error;
}

beforeEach(() => {
  currentLocale = "pl";
  providerError = null;
  resetSession = { userId: "u1" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("rejestracja: błąd dostawcy nie trafia na ekran", () => {
  it("limit wysyłki e-maili → NASZ komunikat z instrukcją, zero treści dostawcy", async () => {
    providerError = providerAuthError(RAW_PROVIDER_MESSAGE, 429, "over_email_send_rate_limit");

    const error = await register();

    // 1. Na ekranie jest DOKŁADNIE nasz tekst — `toBe`, nie `toContain`,
    //    więc mutant doklejający nasz komunikat do angielskiego nie przejdzie.
    expect(error).toBe(pl.authError.emailRateLimit);
    // 2. Jawnie: surowej treści dostawcy nie ma w wyniku w żadnej postaci.
    expect(error).not.toContain(RAW_PROVIDER_MESSAGE);
    expect(error).not.toContain("rate limit");
    // 3. Komunikat NIESIE INSTRUKCJĘ. Limit siedzi po stronie dostawcy i nie
    //    znika od odświeżenia — „spróbuj ponownie" bez horyzontu czasowego
    //    kazałoby użytkownikowi dobijać się w kółko.
    expect(error).toContain("godzinę");
  });

  it("nieznany błąd dostawcy → generyczny komunikat naszej treści", async () => {
    providerError = providerAuthError(
      "Database error saving new user",
      400,
      "some_code_we_have_never_seen",
    );

    const error = await register();

    expect(error).toBe(pl.authError.generic);
    expect(error).not.toContain("Database error saving new user");
    expect(error).not.toContain("Database");
  });

  it("błąd dostawcy zupełnie bez kodu i statusu też nie przecieka", async () => {
    providerError = new Error("Unexpected token < in JSON at position 0");

    const error = await register();

    expect(error).toBe(pl.authError.generic);
    expect(error).not.toContain("JSON");
  });

  it("adres już zajęty → komunikat mówiący, co zrobić dalej", async () => {
    providerError = providerAuthError("User already registered", 422, "user_already_exists");

    const error = await register();

    expect(error).toBe(pl.authError.emailTaken);
    expect(error).not.toContain("already registered");
  });

  it("awaria dostawcy (5xx bez kodu) → komunikat o niedostępności usługi", async () => {
    providerError = providerAuthError("Internal Server Error", 503);

    const error = await register();

    expect(error).toBe(pl.authError.providerUnavailable);
    expect(error).not.toContain("Internal Server Error");
  });

  it("komunikat jest w języku interfejsu (EN)", async () => {
    currentLocale = "en";
    providerError = providerAuthError(RAW_PROVIDER_MESSAGE, 429, "over_email_send_rate_limit");

    const error = await register();

    expect(error).toBe(en.authError.emailRateLimit);
    expect(error).not.toContain(RAW_PROVIDER_MESSAGE);
  });
});

describe("reset hasła: ta sama zapora co w rejestracji", () => {
  it("hasło niespełniające wymagań dostawcy → NASZ komunikat", async () => {
    providerError = providerAuthError(
      "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz",
      422,
      "weak_password",
    );

    const error = await resetConfirm();

    expect(error).toBe(pl.authError.weakPassword);
    expect(error).not.toContain("Password should contain");
    expect(error).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("wygasły token → komunikat mówiący, że trzeba poprosić o nowy link", async () => {
    providerError = providerAuthError("Email link is invalid or has expired", 401, "otp_expired");

    const error = await resetConfirm();

    expect(error).toBe(pl.authError.linkExpired);
    expect(error).not.toContain("Email link is invalid");
  });

  it("nieznany błąd dostawcy → generyczny komunikat naszej treści", async () => {
    providerError = providerAuthError("New password is too similar", 422, "brand_new_code");

    const error = await resetConfirm();

    expect(error).toBe(pl.authError.generic);
    expect(error).not.toContain("New password is too similar");
  });
});

/**
 * KONTROLA POZYTYWNA — zabezpieczenie przed nadgorliwym mapowaniem.
 *
 * Komunikaty pisane po NASZEJ stronie po polsku (walidacja Zod, limity, brak
 * sesji resetu — oraz `RAISE EXCEPTION` z naszych funkcji bazy, celowo pisane
 * pod wyświetlenie użytkownikowi) mają docierać na ekran BEZ ZMIANY. Mapowanie
 * dotyczy wyłącznie błędów dostawcy; gdyby ktoś przepuścił przez nie wszystko,
 * te komunikaty zamieniłyby się w bezużyteczne „Nie udało się dokończyć
 * operacji".
 *
 * W obu akcjach z tego pasa nie ma dziś ścieżki, w której błąd NASZEJ bazy
 * dociera do warstwy komunikatu (rejestracja i reset hasła wołają wyłącznie
 * Supabase Auth), więc kontrola stoi na naszych polskich komunikatach, które
 * tamtędy faktycznie przechodzą, plus na samym mapperze.
 */
describe("kontrola pozytywna: nasze polskie komunikaty przechodzą bez zmiany", () => {
  it("wygasła sesja resetu (nasz komunikat) nie jest podmieniana na generyczny", async () => {
    resetSession = null;
    providerError = providerAuthError(RAW_PROVIDER_MESSAGE, 429, "over_email_send_rate_limit");

    const error = await resetConfirm();

    expect(error).toBe("Sesja resetu wygasła lub link jest nieprawidłowy. Poproś o nowy link.");
    expect(error).not.toBe(pl.authError.generic);
  });

  it("komunikat walidacji Zod (nasz, polski) dociera dosłownie", async () => {
    const form = new FormData();
    form.set("password", "krótkie");

    const state = await resetConfirmAction({}, form);

    expect(state.error).toBe("Hasło musi mieć co najmniej 8 znaków.");
  });

  it("mapper NIE reaguje na polski komunikat naszej bazy udający limit", () => {
    // Błąd z `RAISE EXCEPTION` (PostgREST): kod P0001, nie kod GoTrue.
    // Gdyby mapowanie szło po treści zamiast po kodzie, słowo „limit"
    // wystarczyłoby, żeby ten błąd wpadł w komunikat o limicie wysyłki.
    const dbError = {
      message: "Przekroczono limit pozycji w katalogu dla tego planu.",
      code: "P0001",
    };

    expect(authErrorKey(dbError)).toBe("generic");
  });
});
