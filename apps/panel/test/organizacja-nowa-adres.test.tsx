// @vitest-environment jsdom

/**
 * ADRES SKLEPU ZAMIAST „SLUGA" (ADR-153, N5b).
 *
 * Pole nazywało się „Slug (adres, np. moja-firma)" i było jedynym miejscem
 * w panelu, w którym operator musiał znać żargon — a wpisuje tam adres, pod
 * którym od pierwszej sekundy stanie jego publiczny sklep. Podgląd na żywo
 * pokazuje DOKŁADNIE tę wartość, którą zbuduje serwer.
 *
 * DECYZJA WŁAŚCICIELA (2026-08-12): adres BĘDZIE później edytowalny, więc
 * ekran ma o tym mówić i NIE straszyć nieodwracalnością. Test pilnuje obu
 * kierunków: nota o możliwości zmiany jest, a zdania „tego już nie zmienisz"
 * nie ma.
 *
 * Test jest ZACHOWANIOWY: wpisuje tekst w prawdziwe pole i patrzy, co robi
 * podgląd — podpięcie `value` pod stan, który nigdy się nie zmienia, ze
 * źródła wygląda identycznie.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

vi.mock("@/app/[locale]/(panel)/organizacja/nowa/actions", () => ({
  createTenantAction: async () => ({}),
}));

const { CreateTenantForm } = await import("@/app/[locale]/(panel)/organizacja/nowa/form");

function renderForm() {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <CreateTenantForm terms={null} />
    </NextIntlClientProvider>,
  );
}

function slugInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>("input[name='slug']");
  if (!input) throw new Error("Pole adresu sklepu nie wyrenderowało się.");
  return input;
}

function preview(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>("[data-slug-preview]");
  if (!node) throw new Error("Podgląd adresu nie wyrenderował się.");
  return node;
}

afterEach(cleanup);

describe("pole adresu sklepu — nazwa i podgląd na żywo", () => {
  it("etykieta mówi o adresie sklepu, a nie o „slugu”", () => {
    renderForm();

    expect(screen.getByText(messages.newOrganization.slug)).toBeTruthy();
    expect(messages.newOrganization.slug.toLowerCase()).not.toContain("slug");
  });

  it("puste pole → podpowiedź o dozwolonych znakach, nie kikut adresu", () => {
    const { container } = renderForm();

    expect(preview(container).textContent).toBe(messages.newOrganization.slugPreviewEmpty);
    expect(preview(container).textContent).not.toContain(".avably.io");
  });

  it("wpisanie nazwy pokazuje pełny adres sklepu NA ŻYWO", () => {
    const { container } = renderForm();

    fireEvent.change(slugInput(container), { target: { value: "wypozyczalnia-gdansk" } });

    expect(preview(container).textContent).toContain("wypozyczalnia-gdansk.avably.io");
  });

  it("podgląd pokazuje wartość ZNORMALIZOWANĄ — tę, którą zapisze serwer", () => {
    const { container } = renderForm();

    fireEvent.change(slugInput(container), { target: { value: "  Wypozyczalnia-GDANSK  " } });

    expect(preview(container).textContent).toContain("wypozyczalnia-gdansk.avably.io");
    expect(preview(container).textContent).not.toContain("GDANSK");
  });

  it("zmiana wartości zmienia podgląd (nie zamarza na pierwszym wpisie)", () => {
    const { container } = renderForm();

    fireEvent.change(slugInput(container), { target: { value: "pierwsza" } });
    expect(preview(container).textContent).toContain("pierwsza.avably.io");

    fireEvent.change(slugInput(container), { target: { value: "druga" } });
    expect(preview(container).textContent).toContain("druga.avably.io");
    expect(preview(container).textContent).not.toContain("pierwsza");
  });
});

describe("ton ekranu: adres da się zmienić (decyzja właściciela)", () => {
  it("nota obiecuje zmianę adresu, przekierowanie starego I własną domenę", () => {
    const { container } = renderForm();

    const note = container.textContent ?? "";
    expect(note).toContain(messages.newOrganization.slugEditableNote);
    // Uwaga właściciela 2026-08-19: nota mówi OBIE rzeczy — przekierowanie
    // starego adresu po zmianie oraz możliwość podpięcia własnej domeny.
    expect(note).toContain("przekieruj");
    expect(note).toContain("własną domenę");
  });

  it("ekran NIE straszy nieodwracalnością", () => {
    const { container } = renderForm();

    const text = (container.textContent ?? "").toLowerCase();
    expect(text).not.toContain("nie zmienisz");
    expect(text).not.toContain("nieodwracaln");
    expect(text).not.toContain("na zawsze");
  });
});
