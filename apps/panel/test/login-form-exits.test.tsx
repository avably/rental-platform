// @vitest-environment jsdom

/**
 * DWA WYJŚCIA OBOK KOMUNIKATU BŁĘDU LOGOWANIA (ADR-153, N3).
 *
 * Komunikat musi zostać generyczny (patrz login-error-uniformity.test.ts),
 * więc sam z siebie nie mówi, co zrobić. Obie realne przyczyny dostają więc
 * drogę wyjścia obok niego — BEZ klasyfikowania czegokolwiek po stronie
 * serwera, czyli bez ujawniania, czy konto istnieje:
 *   • „Wyślij link potwierdzający ponownie" → /register/sprawdz-skrzynke,
 *   • „Nie pamiętam hasła" → /reset.
 *
 * Test jest ZACHOWANIOWY, nie źródłowy: renderuje PRAWDZIWY formularz,
 * wywołuje akcję i patrzy, co pojawia się na ekranie. Zamockowana jest
 * wyłącznie granica sieci (akcja serwerowa) — hook `useActionState` i cała
 * logika renderu są prawdziwe.
 *
 * OBIE STRONY: bez błędu wyjść NIE MA (nie straszą człowieka, który jeszcze
 * niczego nie zrobił), po błędzie SĄ i prowadzą pod właściwe adresy.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/** Odpowiedź akcji — sterowana per przypadek. */
let actionResult: { error?: string } = {};
const loginAction = vi.fn(async (_prev: unknown, _formData: FormData) => actionResult);

vi.mock("@/app/[locale]/(auth)/login/actions", () => ({
  loginAction: (prev: unknown, formData: FormData) => loginAction(prev, formData),
}));

// `Link` z next-intl potrzebuje routera App Routera — dla tego renderu
// wystarczy zwykła kotwica z tym samym `href`.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { LoginForm } = await import("@/app/[locale]/(auth)/login/form");

function renderForm() {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <LoginForm />
    </NextIntlClientProvider>,
  );
}

/** Wypełnia pola i wysyła formularz, czekając na rozstrzygnięcie akcji. */
async function submit(container: HTMLElement): Promise<void> {
  const form = container.querySelector("form");
  if (!form) throw new Error("Formularz logowania nie wyrenderował się.");
  fireEvent.change(container.querySelector<HTMLInputElement>("input[name='email']")!, {
    target: { value: "kto@test.local" },
  });
  fireEvent.change(container.querySelector<HTMLInputElement>("input[name='password']")!, {
    target: { value: "Haslo!12345678" },
  });
  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });
}

/** Wszystkie `href` bloku błędu — dowód, DOKĄD prowadzą wyjścia. */
function errorBlockHrefs(container: HTMLElement): string[] {
  const block = container.querySelector("[data-login-error]");
  if (!block) return [];
  return [...block.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href") ?? "");
}

afterEach(() => {
  cleanup();
  actionResult = {};
  loginAction.mockClear();
});

describe("formularz logowania — wyjścia przy błędzie (N3)", () => {
  it("bez błędu nie ma bloku wyjść (kontrola negatywna)", () => {
    const { container } = renderForm();

    expect(container.querySelector("[data-login-error]")).toBeNull();
    expect(screen.queryByText(messages.login.resendConfirmation)).toBeNull();
  });

  it("po nieudanym logowaniu komunikat stoi razem z DWOMA wyjściami", async () => {
    actionResult = { error: messages.login.signInFailed };
    const { container } = renderForm();

    await submit(container);

    // Najpierw: blok błędu JEST na ekranie…
    const block = container.querySelector("[data-login-error]");
    expect(block, "formularz nie pokazał bloku błędu — dalsze asercje byłyby puste").not.toBeNull();
    // …potem: co w nim stoi i dokąd prowadzi.
    expect(block!.textContent).toContain(messages.login.signInFailed);
    expect(errorBlockHrefs(container)).toEqual(["/register/sprawdz-skrzynke", "/reset"]);
  });

  it("komunikat błędu jest ogłaszany czytnikowi (role=alert)", async () => {
    actionResult = { error: messages.login.signInFailed };
    const { container } = renderForm();

    await submit(container);

    expect(screen.getByRole("alert").textContent).toContain(messages.login.signInFailed);
  });

  it("etykiety wyjść pochodzą z i18n, nie z literałów w komponencie", async () => {
    actionResult = { error: messages.login.signInFailed };
    const { container } = renderForm();

    await submit(container);

    const block = container.querySelector("[data-login-error]")!;
    expect(block.textContent).toContain(messages.login.resendConfirmation);
    expect(block.textContent).toContain(messages.login.forgotPassword);
  });
});
