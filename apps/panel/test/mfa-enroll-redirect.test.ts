/**
 * Rejestracja TOTP kończy się PRZEKIEROWANIEM, nie ślepym zaułkiem.
 *
 * Potwierdzone na produkcji przy pierwszej konfiguracji 2FA: `verifyTotpAction`
 * kończyła się `return { success }`, formularz zamieniał się w zdanie „włączone"
 * i użytkownik zostawał na `/bezpieczenstwo` bez żadnej drogi dalej — mimo że
 * sesja po `mfa.verify` jest już aal2, czyli dokładnie tam, dokąd szedł.
 * Wyzwanie MFA (`wyzwanie/actions.ts`) robiło to poprawnie od Zadania 7; tu
 * powielamy TĘ SAMĄ konwencję, zamiast wymyślać drugą.
 *
 * Trzy gwarancje:
 *   1. `next` prowadzi tam, dokąd użytkownik szedł (przenoszony ukrytym polem
 *      formularza, jak w wyzwanie/form.tsx),
 *   2. bez `next` fallback to strona główna panelu — NIGDY zaszyte `/admin`.
 *      Zaszycie ujawniłoby istnienie panelu superadmina sesji bez claimu
 *      i rozszczelniło maskowanie 404 (ADR-010/011, ADR-034),
 *   3. `next` spoza aplikacji jest ODRZUCANY (`safeNextPath`) — inaczej ekran
 *      2FA byłby open-redirectem uzbrojonym w świeżo podbitą sesję aal2.
 *
 * Każde przekierowanie niesie prefiks locale (`localePath`) — reguła ADR-034.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let currentLocale = "pl";
let verifyError: { message: string } | null = null;
const verifyCalls: { factorId: string; code: string }[] = [];

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
  getTranslations: async () => (key: string) => key,
}));

const FACTOR_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: "00000000-0000-4000-8000-000000000001",
            email: "operator@example.com",
            aal: "aal2",
            app_metadata: {},
          },
        },
        error: null,
      }),
      mfa: {
        challenge: async () => ({ data: { id: "challenge-1" }, error: null }),
        verify: async (args: { factorId: string; code: string }) => {
          verifyCalls.push({ factorId: args.factorId, code: args.code });
          return { data: null, error: verifyError };
        },
      },
    },
  }),
}));

const { verifyTotpAction } = await import("@/app/[locale]/bezpieczenstwo/actions");

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** Uruchamia akcję i zwraca cel przekierowania (null, jeśli nie przekierowała). */
async function redirectTargetOf(data: FormData): Promise<string | null> {
  try {
    await verifyTotpAction({}, data);
    return null;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
}

beforeEach(() => {
  currentLocale = "pl";
  verifyError = null;
  verifyCalls.length = 0;
});

describe.each(["pl", "en"])("rejestracja TOTP — locale %s", (locale) => {
  beforeEach(() => {
    currentLocale = locale;
  });

  it("z parametrem `next` ląduje tam, dokąd użytkownik szedł", async () => {
    const target = await redirectTargetOf(
      formData({ factorId: FACTOR_ID, code: "123456", next: "/ustawienia-emaili" }),
    );

    expect(target, "akcja nie przekierowała — ślepy zaułek po włączeniu 2FA").not.toBeNull();
    expect(target).toBe(`/${locale}/ustawienia-emaili`);
  });

  it("bez `next` wraca na stronę główną panelu", async () => {
    const target = await redirectTargetOf(formData({ factorId: FACTOR_ID, code: "123456" }));

    expect(target).toBe(`/${locale}`);
  });
});

describe("sanityzacja `next` (ochrona przed open-redirectem)", () => {
  it.each([
    ["adres absolutny", "https://example.com/przejmij"],
    ["schema-relative", "//example.com/przejmij"],
    ["backslash", "/\\example.com"],
    ["ścieżka bez wiodącego ukośnika", "example.com"],
  ])("%s jest odrzucany — fallback na stronę główną", async (_name, next) => {
    const target = await redirectTargetOf(formData({ factorId: FACTOR_ID, code: "123456", next }));

    expect(target).toBe("/pl");
  });

  it("nie przekierowuje na panel superadmina, gdy `next` go nie wskazał", async () => {
    const target = await redirectTargetOf(formData({ factorId: FACTOR_ID, code: "123456" }));

    expect(target).not.toBeNull();
    expect(target!.startsWith("/pl/admin")).toBe(false);
  });
});

describe("nieudana weryfikacja", () => {
  it("zwraca błąd zamiast przekierowywać", async () => {
    verifyError = { message: "Nieprawidłowy kod." };

    const target = await redirectTargetOf(formData({ factorId: FACTOR_ID, code: "000000" }));

    expect(target).toBeNull();
    expect(verifyCalls).toHaveLength(1);
  });
});
