// @vitest-environment jsdom

/**
 * Kontrakt CAPTCHA formularzy auth (L2, ADR-106).
 *
 * SEMANTYKA WŁĄCZENIA — obie strony medalu, na każdym z trzech formularzy:
 *  - site key USTAWIONY → formularz niesie ukryty input `turnstileToken`
 *    (kanał tokenu do akcji serwerowej) i bootuje skrypt api.js dostawcy,
 *  - site key NIEUSTAWIONY → ani inputa, ani skryptu — CAPTCHA jest jawnie
 *    wyłączona i formularz wygląda jak przed L2 (anty-lockout: dokładnie ten
 *    stan wchodzi na prod PRZED ustawieniem sekretów przez właściciela).
 *
 * Test dwustronny z tego samego powodu co calendar-locale-contract: sama
 * asercja „z kluczem jest" przeszłaby też, gdyby widżet renderował się
 * BEZWARUNKOWO — a wtedy panel bez skonfigurowanego klucza próbowałby bić
 * w skrypt dostawcy na każdym logowaniu.
 */
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

vi.mock("@/app/[locale]/(auth)/login/actions", () => ({
  loginAction: async () => ({}),
}));
vi.mock("@/app/[locale]/(auth)/register/actions", () => ({
  registerAction: async () => ({}),
}));
vi.mock("@/app/[locale]/(auth)/reset/actions", () => ({
  resetRequestAction: async () => ({}),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  // Skrypt dostawcy ląduje w <head> poza drzewem Reacta — cleanup() go nie
  // zdejmuje, a kolejny przypadek nie może dziedziczyć czyjegoś taga.
  document.head.querySelectorAll("script").forEach((node) => node.remove());
});

/**
 * Formularze importowane per przypadek na ŚWIEŻYM grafie modułów
 * (resetModules): loader skryptu w turnstile-widget jest singletonem
 * modułu — bez resetu drugi formularz dziedziczyłby stan boota pierwszego
 * i asercje skryptu kłamałyby w obie strony. React zostaje jeden (dep
 * zewnętrzny, poza rejestrem resetu), więc render działa normalnie.
 */
const CASES: Array<[string, () => Promise<React.ReactElement>]> = [
  [
    "login",
    async () => {
      const { LoginForm } = await import("@/app/[locale]/(auth)/login/form");
      return <LoginForm />;
    },
  ],
  [
    "register",
    async () => {
      const { RegisterForm } = await import("@/app/[locale]/(auth)/register/form");
      return <RegisterForm />;
    },
  ],
  [
    "reset",
    async () => {
      const ResetRequestPage = (await import("@/app/[locale]/(auth)/reset/page")).default;
      return <ResetRequestPage />;
    },
  ],
];

function renderForm(element: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      {element}
    </NextIntlClientProvider>,
  );
}

describe.each(CASES)("formularz %s", (_name, loadElement) => {
  it("z site key niesie ukryty input turnstileToken i bootuje skrypt dostawcy", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.resetModules();
    const { container } = renderForm(await loadElement());

    const input = container.querySelector('input[name="turnstileToken"]');
    expect(input, "brak kanału tokenu — akcja serwerowa nigdy nie dostanie CAPTCHA").not.toBeNull();
    expect(input).toHaveProperty("type", "hidden");

    const script = document.head.querySelector(
      'script[src^="https://challenges.cloudflare.com/turnstile/"]',
    );
    expect(script, "widżet nie bootuje skryptu api.js").not.toBeNull();
  });

  it("bez site key nie renderuje inputa ani nie dotyka skryptu dostawcy", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.resetModules();
    const { container } = renderForm(await loadElement());

    expect(container.querySelector('input[name="turnstileToken"]')).toBeNull();
    expect(
      document.head.querySelector('script[src^="https://challenges.cloudflare.com/"]'),
      "CAPTCHA wyłączona, a formularz i tak bije w skrypt dostawcy",
    ).toBeNull();
  });
});
