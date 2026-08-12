// @vitest-environment jsdom

/**
 * WYJŚCIA ZE ŚCIEŻKI RESETU HASŁA (ADR-153, N7).
 *
 * Obie trasy resetu były zaułkami bez ani jednego odnośnika: kto trafił na
 * `/reset` przez pomyłkę albo przypomniał sobie hasło, zostawał z przyciskiem
 * „wstecz" przeglądarki; a komunikat odmowy przy ustawianiu hasła mówił
 * „Poproś o nowy link" ZDANIEM, nie linkiem.
 *
 * Test renderuje prawdziwe komponenty i sprawdza, DOKĄD prowadzą odnośniki —
 * sama obecność tekstu niczego by nie dowiodła, bo to właśnie tekst tam był.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// CAPTCHA nie jest przedmiotem tego pliku (własna suita) — bez site key
// i tak renderuje nic, ale atrapa uniezależnia test od środowiska.
vi.mock("@/app/[locale]/(auth)/captcha-field", () => ({ AuthCaptchaField: () => null }));

vi.mock("@/app/[locale]/(auth)/reset/actions", () => ({
  resetRequestAction: async () => ({}),
}));

let confirmResult: { error?: string } = {};
vi.mock("@/app/[locale]/(auth)/reset/confirm/actions", () => ({
  resetConfirmAction: async () => confirmResult,
}));

const ResetRequestPage = (await import("@/app/[locale]/(auth)/reset/page")).default;
const { ResetConfirmForm } = await import("@/app/[locale]/(auth)/reset/confirm/form");

function wrap(children: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {children}
    </NextIntlClientProvider>,
  );
}

function hrefs(container: HTMLElement): string[] {
  return [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
}

afterEach(() => {
  cleanup();
  confirmResult = {};
});

describe("/reset — ekran prośby o link ma wyjście", () => {
  it("prowadzi z powrotem na logowanie", () => {
    const { container } = wrap(<ResetRequestPage />);

    // Kontrola: ekran się wyrenderował (formularz jest), dopiero potem link.
    expect(container.querySelector("input[name='email']")).not.toBeNull();
    expect(hrefs(container), "ekran resetu nie prowadzi nigdzie").toContain("/login");
    expect(container.textContent).toContain(messages.resetRequest.backToLogin);
  });
});

describe("/reset/confirm — odmowa akcji niesie DZIAŁAJĄCY link po nowy", () => {
  it("bez błędu nie ma linku wyjścia (kontrola negatywna)", () => {
    const { container } = wrap(<ResetConfirmForm />);

    expect(container.querySelector("[data-reset-confirm-error]")).toBeNull();
    expect(hrefs(container)).toEqual([]);
  });

  it("po odmowie akcji komunikat stoi razem z linkiem na /reset", async () => {
    confirmResult = { error: "Sesja resetu wygasła lub link jest nieprawidłowy. Poproś o nowy link." };
    const { container } = wrap(<ResetConfirmForm />);

    const form = container.querySelector("form")!;
    fireEvent.change(container.querySelector<HTMLInputElement>("input[name='password']")!, {
      target: { value: "NoweHaslo!12345" },
    });
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const block = container.querySelector("[data-reset-confirm-error]");
    expect(block, "formularz nie pokazał bloku odmowy").not.toBeNull();
    expect(block!.textContent).toContain("Poproś o nowy link");
    expect(hrefs(container), "„Poproś o nowy link” dalej jest samym zdaniem").toContain("/reset");
  });
});
