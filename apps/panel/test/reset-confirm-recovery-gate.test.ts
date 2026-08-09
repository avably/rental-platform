/**
 * Bramka recovery ustawienia nowego hasła (R14, audyt M-01, ADR-122).
 *
 * PRZED R14 `resetConfirmAction` wykonywała `updateUser({ password })` dla
 * KAŻDEJ ważnej sesji — napastnik z przejętą sesją zmieniał hasło i utrwalał
 * przejęcie. Ta suita jest bramką CI dla trzech twierdzeń:
 *
 *  1. DOWÓD RECOVERY: hasło zmienia wyłącznie sesja, którą ustanowił świeży,
 *     jednorazowy token z e-maila — rozpoznawana po claimie `amr` ze
 *     ZWERYFIKOWANEGO JWT dostawcy (metoda "otp"/"recovery", zmierzone na
 *     GoTrue v2.192.0), nigdy po stanie aplikacyjnym, który da się podrobić.
 *  2. UNIEWAŻNIENIE POZOSTAŁYCH SESJI po udanej zmianie (signOut scope
 *     "others") + powiadomienie e-mail o zmianie hasła.
 *  3. ODMOWA JEDNOLITA: sesja zwykła i brak sesji dostają IDENTYCZNĄ
 *     odpowiedź — bramki nie widać z zewnątrz (wzorzec aneksu ADR-106).
 *
 * Wywołania są SUROWE (bez formularza): akcja dostaje FormData wprost, jak
 * w bezpiecznej reprodukcji audytu. `getAuthContext` i `hasRecentRecoveryProof`
 * są PRAWDZIWE — mockiem jest wyłącznie klient Supabase, a payloady claimów
 * mają kształt REALNYCH JWT zdjętych z lokalnego GoTrue (sondy R14, ADR-122).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-for", "203.0.113.7"]]),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

// Limity mają własną suitę (reset-confirm-anti-abuse) — tu zawsze przepuszczają.
vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "panel-auth-rl",
  checkRateLimit: async () => ({ success: true, remaining: 1 }),
}));

/** Odpowiedź getClaims — sterowana per przypadek. */
let claimsResult: { data: { claims: Record<string, unknown> } | null; error: unknown } = {
  data: null,
  error: null,
};
const getClaims = vi.fn(async () => claimsResult);
const updateUser = vi.fn(async (_input: { password: string }) => ({ error: null }));
const signOut = vi.fn(async (_input: { scope: string }) => ({ error: null }));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims, updateUser, signOut } }),
}));

const sendPasswordChangedEmail = vi.fn(async (_input: unknown): Promise<string | undefined> => undefined);
vi.mock("@/lib/password-changed-email", () => ({
  sendPasswordChangedEmail: (input: unknown) => sendPasswordChangedEmail(input),
}));

const { resetConfirmAction } = await import("@/app/[locale]/(auth)/reset/confirm/actions");
const { hasRecentRecoveryProof, RECOVERY_PROOF_MAX_AGE_SECONDS } = await import("@/lib/auth");

/** Odmowa jednolita — dokładny tekst, który widzi użytkownik. */
const UNIFORM_REFUSAL = "Sesja resetu wygasła lub link jest nieprawidłowy. Poproś o nowy link.";

const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

/**
 * Payload claimów w kształcie REALNEGO JWT lokalnego GoTrue v2.192.0 po
 * przepływie recovery (sonda R14) — łącznie z claimami tenanckimi hooka
 * app.custom_access_token. `amr` nadpisywalne per przypadek.
 */
function claims(amr: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {
    aal: "aal1",
    app_metadata: {
      provider: "email",
      providers: ["email"],
      role: null,
      superadmin: false,
      tenant_id: null,
    },
    aud: "authenticated",
    email: "kto@test.local",
    exp: NOW_SECONDS() + 3600,
    iat: NOW_SECONDS(),
    is_anonymous: false,
    role: "authenticated",
    session_id: "a4d5fdc0-77da-4e96-8e33-137a8dcad9de",
    sub: "u1",
    user_metadata: { email_verified: true },
  };
  if (amr !== undefined) base.amr = amr;
  return base;
}

function sessionWith(amr: unknown): void {
  claimsResult = { data: { claims: claims(amr) }, error: null };
}

function noSession(): void {
  claimsResult = { data: null, error: { message: "Auth session missing!" } };
}

function confirmForm(password = "NoweHaslo!12345"): FormData {
  const form = new FormData();
  form.set("password", password);
  return form;
}

async function runConfirm(form = confirmForm()): Promise<{ error?: string } | { url: string }> {
  try {
    return await resetConfirmAction({}, form);
  } catch (error) {
    if (error instanceof RedirectSignal) return { url: error.url };
    throw error;
  }
}

beforeEach(() => {
  noSession();
  getClaims.mockClear();
  updateUser.mockClear();
  signOut.mockClear();
  sendPasswordChangedEmail.mockClear();
  sendPasswordChangedEmail.mockResolvedValue(undefined);
  signOut.mockResolvedValue({ error: null });
  updateUser.mockResolvedValue({ error: null });
});

describe("test negatywny audytu M-01: zwykła sesja nie zmienia hasła", () => {
  it("sesja hasłowa (amr: password) → odmowa, ZERO updateUser/signOut/e-maila", async () => {
    sessionWith([{ method: "password", timestamp: NOW_SECONDS() }]);

    expect(await runConfirm()).toEqual({ error: UNIFORM_REFUSAL });
    expect(updateUser, "bramka recovery przepuściła zwykłą sesję do zapisu hasła").not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it("sesja hasłowa z MFA (amr: password+totp) → odmowa: TOTP nie zastępuje dowodu z e-maila", async () => {
    sessionWith([
      { method: "password", timestamp: NOW_SECONDS() - 60 },
      { method: "totp", timestamp: NOW_SECONDS() },
    ]);

    expect(await runConfirm()).toEqual({ error: UNIFORM_REFUSAL });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("claim amr NIEOBECNY → odmowa (brak dowodu to brak dowodu)", async () => {
    sessionWith(undefined);

    expect(await runConfirm()).toEqual({ error: UNIFORM_REFUSAL });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("amr zdeformowany (timestamp string / wpis null) → odmowa fail-closed", async () => {
    sessionWith([null, { method: "otp", timestamp: String(NOW_SECONDS()) }, "otp"]);

    expect(await runConfirm()).toEqual({ error: UNIFORM_REFUSAL });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("dowód PRZETERMINOWANY (starszy niż okno) → odmowa; okno nie rośnie przy refreshu", async () => {
    sessionWith([{ method: "otp", timestamp: NOW_SECONDS() - RECOVERY_PROOF_MAX_AGE_SECONDS - 60 }]);

    expect(await runConfirm()).toEqual({ error: UNIFORM_REFUSAL });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("odmowa dla zwykłej sesji jest IDENTYCZNA jak przy braku sesji (bramki nie widać)", async () => {
    sessionWith([{ method: "password", timestamp: NOW_SECONDS() }]);
    const regularSession = await runConfirm();

    noSession();
    const withoutSession = await runConfirm();

    expect(regularSession).toEqual(withoutSession);
    expect(withoutSession).toEqual({ error: UNIFORM_REFUSAL });
  });
});

describe("sesja recovery: zmiana hasła + obowiązki po zmianie", () => {
  const freshRecovery = () => sessionWith([{ method: "otp", timestamp: NOW_SECONDS() }]);

  it("świeży dowód otp → hasło zapisane, przekierowanie na login", async () => {
    freshRecovery();

    const result = await runConfirm();

    expect(updateUser).toHaveBeenCalledWith({ password: "NoweHaslo!12345" });
    expect((result as { url: string }).url).toContain("/login");
    expect((result as { url: string }).url).toContain("reset=ok");
  });

  it("po udanej zmianie: unieważnienie POZOSTAŁYCH sesji (scope others, nie global)", async () => {
    freshRecovery();

    await runConfirm();

    expect(signOut, "brak unieważnienia pozostałych sesji po zmianie hasła").toHaveBeenCalledWith({
      scope: "others",
    });
  });

  it("po udanej zmianie: powiadomienie e-mail na adres z claimów, w języku żądania", async () => {
    freshRecovery();

    await runConfirm();

    expect(sendPasswordChangedEmail, "brak powiadomienia o zmianie hasła").toHaveBeenCalledTimes(1);
    expect(sendPasswordChangedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "kto@test.local", locale: "pl" }),
    );
  });

  it("kolejność: unieważnienie i e-mail dopiero PO udanym zapisie hasła (błąd dostawcy = nic z tego)", async () => {
    freshRecovery();
    updateUser.mockResolvedValueOnce({
      error: { code: "same_password", message: "same password", status: 422 } as never,
    });

    const result = await runConfirm();

    expect(result).toHaveProperty("error");
    expect(signOut, "signOut poszedł mimo nieudanej zmiany hasła").not.toHaveBeenCalled();
    expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it("awaria signOut nie cofa zmiany: przekierowanie mimo błędu (refresh tokeny już martwe u dostawcy)", async () => {
    freshRecovery();
    signOut.mockResolvedValueOnce({ error: { message: "network" } as never });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runConfirm();

    expect(result).toHaveProperty("url");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unieważnić pozostałych sesji"));
    warn.mockRestore();
  });

  it("awaria poczty nie cofa zmiany: przekierowanie, powód w logu (nigdy cichy sukces)", async () => {
    freshRecovery();
    sendPasswordChangedEmail.mockResolvedValueOnce("transport niedostępny");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runConfirm();

    expect(result).toHaveProperty("url");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("powiadomienie o zmianie hasła"));
    warn.mockRestore();
  });

  it("metoda \"recovery\" (przyszłe nazewnictwo GoTrue) też jest dowodem", async () => {
    sessionWith([{ method: "recovery", timestamp: NOW_SECONDS() }]);

    const result = await runConfirm();

    expect(updateUser).toHaveBeenCalled();
    expect(result).toHaveProperty("url");
  });
});

describe("hasRecentRecoveryProof — granice okna i zegara", () => {
  const nowMs = 1_786_310_080_000;
  const nowSeconds = nowMs / 1000;

  it("dowód na granicy okna przechodzi, sekundę za oknem — nie", () => {
    expect(
      hasRecentRecoveryProof([{ method: "otp", timestamp: nowSeconds - RECOVERY_PROOF_MAX_AGE_SECONDS }], nowMs),
    ).toBe(true);
    expect(
      hasRecentRecoveryProof(
        [{ method: "otp", timestamp: nowSeconds - RECOVERY_PROOF_MAX_AGE_SECONDS - 1 }],
        nowMs,
      ),
    ).toBe(false);
  });

  it("lekki rozjazd zegarów (znacznik z bliskiej przyszłości) tolerowany, odległa przyszłość — nie", () => {
    expect(hasRecentRecoveryProof([{ method: "otp", timestamp: nowSeconds + 60 }], nowMs)).toBe(true);
    expect(hasRecentRecoveryProof([{ method: "otp", timestamp: nowSeconds + 600 }], nowMs)).toBe(false);
  });

  it("metody bez dowodu skrzynki: password, totp, oauth, token_refresh, magiclink", () => {
    for (const method of ["password", "totp", "oauth", "token_refresh", "magiclink"]) {
      expect(
        hasRecentRecoveryProof([{ method, timestamp: nowSeconds }], nowMs),
        `metoda „${method}" nie może być dowodem recovery`,
      ).toBe(false);
    }
  });
});

describe("konfiguracja dostawcy pod bramką (defense in depth)", () => {
  it("config.toml: secure_password_change = true (R14/M-01; hosted włącza właściciel w dashboardzie)", () => {
    const configPath = resolve(process.cwd(), "../../packages/db/supabase/config.toml");
    const config = readFileSync(configPath, "utf8");

    expect(config).toMatch(/^secure_password_change = true$/m);
    expect(config).not.toMatch(/^secure_password_change = false$/m);
  });
});
