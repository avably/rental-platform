/**
 * KONTRAKT DOSTĘPNOŚCI SEKCJI FAQ v3 (E1, ADR-094) — mierzony RENDEREM.
 *
 * Wzorzec accordionu z W3C APG nie jest listą atrybutów do przepisania, tylko
 * ZACHOWANIEM: nagłówek, który jest nagłówkiem, przycisk, który mówi swój stan
 * i wskazuje swój panel, oraz klawiatura, która działa bez myszy. Dlatego ten
 * plik NICZEGO NIE SKANUJE — montuje sekcję przez `SiteRenderer` (czyli tę samą
 * drogą, którą idzie sklep) i naciska klawisze.
 *
 * FAQ jest w E1 typem REFERENCYJNYM: jeśli framework sekcji strukturalnych
 * czegoś nie umie, widać to tutaj, a nie w abstrakcji bez konsumenta.
 */
import {
  structuredPresetFor,
  withStructuredLayout,
  type FaqStructuredContent,
} from "@avably/core/site";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

afterEach(cleanup);

function faq(overrides: Partial<FaqStructuredContent> = {}): FaqStructuredContent {
  return { ...(structuredPresetFor("faq", "pl") as FaqStructuredContent), ...overrides };
}

/** Montaż PRZEZ RENDERER strony — nie przez sam komponent typu. */
function renderFaq(content: FaqStructuredContent) {
  const sections = [{ id: "s1", position: 0, type: "faq", content }] as RenderSection[];
  return render(<SiteRenderer sections={sections} />);
}

function triggers(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("[data-faq-trigger]"));
}

describe("FAQ v3: sekcja renderuje się przez wspólny renderer", () => {
  it.each(["accordion", "open-list"] as const)(
    "%s: KAŻDA para z treści jest na stronie (pytanie i odpowiedź)",
    (layout) => {
      const content = withStructuredLayout(faq(), layout) as FaqStructuredContent;
      const { container } = renderFaq(content);

      expect(container.querySelector(`[data-structured-section="faq"]`)).not.toBeNull();
      expect(
        container.querySelector(`[data-structured-layout="${layout}"]`),
        "układ nie trafił do znaczników — kotwica zrzutów i testów",
      ).not.toBeNull();

      for (const item of content.items) {
        expect(screen.getByText(item.q), `brak pytania „${item.q}”`).toBeTruthy();
        expect(screen.getByText(item.a), `brak odpowiedzi na „${item.q}”`).toBeTruthy();
      }
      expect(container.querySelectorAll("[data-faq-panel]").length).toBe(content.items.length);
    },
  );

  it("nagłówek sekcji jest opcjonalny — bez niego sekcja dalej działa", () => {
    const content = faq();
    delete (content as { heading?: string }).heading;
    const { container } = renderFaq(content);
    expect(container.querySelectorAll("h2").length).toBe(0);
    expect(triggers(container).length).toBe(content.items.length);
  });

  it("pas motywu wchodzi do klas sekcji (kolor NIE jest w komponencie)", () => {
    const { container } = renderFaq(faq({ background: "inverted" }));
    const section = container.querySelector<HTMLElement>(`[data-structured-section="faq"]`);
    expect(section?.className).toContain("site-band-inverted");
  });
});

describe("FAQ v3 / accordion: struktura wg W3C APG", () => {
  it("tytuł pary siedzi w ELEMENCIE NAGŁÓWKOWYM z aria-level, a przycisk jest jego dzieckiem", () => {
    const content = faq();
    const { container } = renderFaq(content);

    const headings = Array.from(container.querySelectorAll<HTMLElement>("h3[aria-level]"));
    expect(headings.length, "pary FAQ nie są nagłówkami — nawigacja po nagłówkach je pominie").toBe(
      content.items.length,
    );
    for (const heading of headings) {
      expect(heading.getAttribute("aria-level")).toBe("3");
      const button = heading.querySelector("button");
      expect(button, "przycisk musi być W nagłówku, nie odwrotnie").not.toBeNull();
      expect(button?.getAttribute("type"), "przycisk bez type wysyła formularz").toBe("button");
    }
  });

  it("aria-expanded mówi stan, aria-controls wskazuje ISTNIEJĄCY panel, panel wskazuje przycisk", () => {
    const content = faq();
    const { container } = renderFaq(content);

    for (const [index, trigger] of triggers(container).entries()) {
      expect(trigger.getAttribute("aria-expanded"), "brak stanu na przycisku").toBe(
        index === 0 ? "true" : "false",
      );
      const panelId = trigger.getAttribute("aria-controls");
      expect(panelId, "przycisk nie wskazuje panelu").toBeTruthy();
      const panel = container.querySelector(`#${CSS.escape(panelId!)}`);
      expect(panel, `aria-controls wskazuje na nieistniejący element (${panelId})`).not.toBeNull();
      expect(panel?.getAttribute("aria-labelledby")).toBe(trigger.id);
      expect(panel?.getAttribute("role")).toBe("region");
    }
  });

  it("PIERWSZA para jest otwarta, reszta ukryta atrybutem `hidden`", () => {
    const content = faq();
    const { container } = renderFaq(content);
    const panels = Array.from(container.querySelectorAll<HTMLElement>("[data-faq-panel]"));
    expect(panels[0]?.hasAttribute("hidden"), "pierwsza odpowiedź powinna być widoczna").toBe(false);
    for (const panel of panels.slice(1)) {
      expect(panel.hasAttribute("hidden"), "pozostałe odpowiedzi powinny być zwinięte").toBe(true);
    }
  });

  it("identyfikatory są UNIKALNE także przy dwóch sekcjach FAQ na jednej stronie", () => {
    const sections = [
      { id: "s1", position: 0, type: "faq", content: faq() },
      { id: "s2", position: 1, type: "faq", content: faq() },
    ] as RenderSection[];
    const { container } = render(<SiteRenderer sections={sections} />);
    const ids = Array.from(container.querySelectorAll("[id]")).map((node) => node.id);
    expect(new Set(ids).size, "zduplikowane id — aria-controls wskazywałoby cudzy panel").toBe(
      ids.length,
    );
  });
});

describe("FAQ v3 / accordion: klawiatura i mysz", () => {
  it("klik rozwija i zwija tę samą parę", async () => {
    const user = userEvent.setup();
    const { container } = renderFaq(faq());
    const [first, second] = triggers(container);

    await user.click(second!);
    expect(second!.getAttribute("aria-expanded")).toBe("true");
    await user.click(second!);
    expect(second!.getAttribute("aria-expanded")).toBe("false");
    expect(first).toBeTruthy();
  });

  it("Enter i Spacja robią to samo, co klik (przycisk natywny, nie `div` z onClick)", async () => {
    const user = userEvent.setup();
    const { container } = renderFaq(faq());
    const second = triggers(container)[1]!;

    second.focus();
    expect(document.activeElement).toBe(second);

    await user.keyboard("{Enter}");
    expect(second.getAttribute("aria-expanded"), "Enter nie rozwinął odpowiedzi").toBe("true");

    await user.keyboard(" ");
    expect(second.getAttribute("aria-expanded"), "Spacja nie zwinęła odpowiedzi").toBe("false");
  });

  it("WSZYSTKIE przyciski stoją w sekwencji Tab, w kolejności treści", async () => {
    const user = userEvent.setup();
    const content = faq();
    const { container } = renderFaq(content);
    const list = triggers(container);

    for (const trigger of list) {
      expect(trigger.hasAttribute("tabindex"), "ręczny tabindex psuje naturalną kolejność").toBe(
        false,
      );
    }

    for (const trigger of list) {
      await user.tab();
      expect(document.activeElement, "przycisk pary wypadł z sekwencji Tab").toBe(trigger);
    }
  });

  it("domyślnie otwiera się JEDNA odpowiedź naraz", async () => {
    const user = userEvent.setup();
    const { container } = renderFaq(faq({ allowMultiple: false }));
    const [first, second] = triggers(container);

    await user.click(second!);
    expect(second!.getAttribute("aria-expanded")).toBe("true");
    expect(first!.getAttribute("aria-expanded"), "poprzednia para została otwarta").toBe("false");
  });

  it("ustawienie „pozwól otworzyć wiele naraz” zostawia obie otwarte", async () => {
    const user = userEvent.setup();
    const { container } = renderFaq(faq({ allowMultiple: true }));
    const [first, second] = triggers(container);

    await user.click(second!);
    expect(second!.getAttribute("aria-expanded")).toBe("true");
    expect(first!.getAttribute("aria-expanded"), "ustawienie „wiele naraz” nie zadziałało").toBe(
      "true",
    );
  });
});

describe("FAQ v3 / lista otwarta", () => {
  it("nie ma czego rozwijać — zero przycisków, wszystkie odpowiedzi widoczne", () => {
    const content = withStructuredLayout(faq(), "open-list") as FaqStructuredContent;
    const { container } = renderFaq(content);

    expect(
      container.querySelectorAll("button").length,
      "układ bez zwijania nie może mieć przełączników",
    ).toBe(0);
    for (const panel of container.querySelectorAll<HTMLElement>("[data-faq-panel]")) {
      expect(panel.hasAttribute("hidden")).toBe(false);
    }
  });

  it("pary zostają nagłówkami — hierarchia dokumentu nie zależy od wyglądu", () => {
    const content = withStructuredLayout(faq(), "open-list") as FaqStructuredContent;
    const { container } = renderFaq(content);
    expect(container.querySelectorAll("h3[aria-level='3']").length).toBe(content.items.length);
  });

  it("przełączenie układu tam i z powrotem nie gubi ANI JEDNEJ pary na stronie", () => {
    const base = faq();
    const there = withStructuredLayout(base, "open-list") as FaqStructuredContent;
    const back = withStructuredLayout(there, "accordion") as FaqStructuredContent;

    const first = renderFaq(base).container.textContent;
    cleanup();
    renderFaq(there);
    cleanup();
    const last = renderFaq(back).container.textContent;
    expect(last).toBe(first);
  });
});
