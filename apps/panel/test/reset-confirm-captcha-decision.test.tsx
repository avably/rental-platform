// @vitest-environment jsdom

/**
 * ROZSTRZYGNIĘCIE: reset/confirm NIE dostaje CAPTCHA (aneks ADR-106).
 *
 * `auth-captcha-contract.test.tsx` przybija trzy formularze, które widżet mieć
 * MUSZĄ (login, register, reset request). Ten test przybija drugą stronę tego
 * samego rozstrzygnięcia — jedyny formularz auth, który go świadomie nie ma.
 *
 * Dlaczego nie: wejście na ten ekran wymaga sesji recovery z linku e-mail, a
 * te powstają wyłącznie za CAPTCHA i limitem reset requestu (3/h/IP + 3/h/adres)
 * — bot i tak nie wyprodukuje ich masowo. Dołożenie wyzwania kosztowałoby
 * najkruchszy moment ścieżki: użytkownik stoi z krótkotrwałą sesją tuż po
 * kliknięciu linku, a awaria dostawcy przy fail-closed (tak jest na reset
 * request) zamieniłaby ją w lockout wymagający NOWEGO linku. Zapotrzebowanie
 * na dławienie pokrywa limit IP — patrz reset-confirm-anti-abuse.test.ts.
 *
 * Asercja jest z site key USTAWIONYM celowo: bez klucza `AuthCaptchaField`
 * renderuje nic, więc test bez stubu env przechodziłby także po dołożeniu
 * widżetu — czyli nie pilnowałby niczego.
 */
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

vi.mock("@/app/[locale]/(auth)/reset/confirm/actions", () => ({
  resetConfirmAction: async () => ({}),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  document.head.querySelectorAll("script").forEach((node) => node.remove());
});

it("formularz nowego hasła nie niesie kanału tokenu ani nie bootuje skryptu dostawcy", async () => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  vi.resetModules();
  const ResetConfirmPage = (await import("@/app/[locale]/(auth)/reset/confirm/page")).default;

  const { container } = render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <ResetConfirmPage />
    </NextIntlClientProvider>,
  );

  expect(
    container.querySelector('input[name="turnstileToken"]'),
    "CAPTCHA na reset/confirm to zmiana rozstrzygnięcia ADR-106 — zaktualizuj aneks razem z testem",
  ).toBeNull();
  expect(document.head.querySelector('script[src^="https://challenges.cloudflare.com/"]')).toBeNull();
});
