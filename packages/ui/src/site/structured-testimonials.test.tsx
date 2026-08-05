/**
 * OPINIE STRUKTURALNE — KONTRAKT RENDERU (E6, aneks ADR-094).
 *
 * Trzy rzeczy, których nie widać w typach:
 *
 *   1. PAS PRZEWIJA SIEBIE, NIE STRONĘ. `scrollIntoView` na kafelku wygląda
 *      w kodzie niewinnie i przy każdej strzałce przesuwa całą stronę pod
 *      czytającym. Ta sama wada, co w E3, więc ten sam dowód: karuzela woła
 *      `scrollTo` KONTENERA, a `scrollIntoView` nie pada ANI RAZU.
 *   2. PODPIS NIE JEST CZĘŚCIĄ CYTATU. Autor nie powiedział własnego nazwiska,
 *      więc nazwisko w `<blockquote>` każe czytnikowi ekranu odczytać je jako
 *      część wypowiedzi. Sprawdzamy DRZEWO, nie klasy.
 *   3. AUTO-UKŁAD NIE ZOSTAWIA DZIUR ANI NIE TNIE — na czterech licznościach
 *      (1, 3, 4, 7), bo fikstura jednej liczności nie odróżnia układu, który
 *      się dostosowuje, od takiego, który akurat pasuje (lekcja z E3).
 */
import {
  structuredPresetFor,
  withStructuredLayout,
  type TestimonialsStructuredContent,
  type TestimonialsStructuredItem,
} from "@avably/core/site";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_SITE_LABELS, SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

const L = DEFAULT_SITE_LABELS;

const scrollTo = vi.fn();
const scrollIntoView = vi.fn();

beforeAll(() => {
  // jsdom nie implementuje ani przewijania, ani obserwatora rozmiaru — obie
  // atrapy są tu po to, żeby MIERZYĆ wywołania, a nie żeby je uciszyć.
  Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];
  Element.prototype.scrollIntoView = scrollIntoView;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  scrollTo.mockClear();
  scrollIntoView.mockClear();
});

const uzytkownik = () => userEvent.setup({ pointerEventsCheck: 0 });

function opinie(patch: Partial<TestimonialsStructuredContent> = {}): TestimonialsStructuredContent {
  const preset = structuredPresetFor("testimonials", "pl") as TestimonialsStructuredContent;
  return { ...preset, ...patch } as TestimonialsStructuredContent;
}

function pokaz(content: TestimonialsStructuredContent) {
  const sections = [
    { id: "o1", position: 0, type: "testimonials", content },
  ] as unknown as RenderSection[];
  return render(<SiteRenderer sections={sections} />);
}

/** Opinie o zadanej LICZNOŚCI — treści różne, żeby dało się je rozróżnić. */
function wpisy(ile: number): TestimonialsStructuredItem[] {
  return Array.from({ length: ile }, (_, index) => ({
    quote: `Opinia numer ${index + 1} — pełne zdanie, które ma się zmieścić w całości.`,
    author: `Autor ${index + 1}`,
    role: `Rola ${index + 1}`,
  }));
}

describe("KARUZELA przewija SIEBIE, nie stronę", () => {
  it("strzałka woła scrollTo KONTENERA i ani razu scrollIntoView", async () => {
    const user = uzytkownik();
    const { container } = pokaz(withStructuredLayout(opinie(), "carousel"));
    const lista = container.querySelector<HTMLElement>("[data-testimonials-list]")!;

    await user.click(screen.getByRole("button", { name: L.testimonialsNext }));

    expect(scrollTo, "krok karuzeli nie przewinął pasa").toHaveBeenCalled();
    expect(scrollTo.mock.instances[0], "przewinięto COŚ INNEGO niż pas opinii").toBe(lista);
    expect(scrollTo.mock.calls[0]![0]).toMatchObject({ behavior: "smooth" });
    expect(
      scrollIntoView,
      "użyto scrollIntoView — przy każdej strzałce przesuwałoby to całą stronę pod czytającym",
    ).not.toHaveBeenCalled();
  });

  it("strzałki mają NAZWY i wygaszają się na końcach pasa", async () => {
    const user = uzytkownik();
    pokaz(withStructuredLayout(opinie({ items: wpisy(3) }), "carousel"));
    const poprzednia = screen.getByRole("button", { name: L.testimonialsPrev });
    const nastepna = screen.getByRole("button", { name: L.testimonialsNext });

    expect(poprzednia, "na początku pasa jest dokąd cofać").toBeDisabled();
    expect(nastepna).not.toBeDisabled();
    await user.click(nastepna);
    expect(poprzednia, "po kroku wstecz dalej nie ma dokąd wracać").not.toBeDisabled();
  });

  it("nazwy strzałek mówią o OPINII, a nie o zdjęciu", () => {
    pokaz(withStructuredLayout(opinie(), "carousel"));
    // Delta wobec E3: wspólne etykiety galerii („Następne zdjęcie") byłyby przy
    // cytacie komunikatem FAŁSZYWYM, a nie tylko niedokładnym.
    expect(screen.queryByRole("button", { name: L.galleryNext })).toBeNull();
    expect(screen.getByRole("button", { name: L.testimonialsNext })).toBeTruthy();
  });

  it("pas jest przewijany GESTEM z definicji (scroll-snap), bez własnej obsługi dotyku", () => {
    const { container } = pokaz(withStructuredLayout(opinie(), "carousel"));
    const lista = container.querySelector<HTMLElement>("[data-testimonials-list]")!;
    for (const klasa of ["overflow-x-auto", "snap-x", "snap-mandatory"]) {
      expect(lista.className, `pas bez klasy „${klasa}” nie przewinie się palcem`).toContain(klasa);
    }
  });

  it("pas NIE RUSZA SIĘ SAM — zero autorotacji", async () => {
    vi.useFakeTimers();
    try {
      pokaz(withStructuredLayout(opinie(), "carousel"));
      scrollTo.mockClear();
      // Ruch, którego czytelnik nie zaczął, zabiera cytat w połowie zdania.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(scrollTo, "pas przesunął się bez udziału czytelnika — to jest autorotacja").not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PODPIS NIE JEST CZĘŚCIĄ CYTATU", () => {
  it("cytat siedzi w blockquote, a podpis POZA nim", () => {
    pokaz(
      opinie({
        items: [{ quote: "Sprzęt dojechał na czas.", author: "Anna Kowalska", role: "Wesele" }],
      }),
    );
    const cytat = screen.getByText("Sprzęt dojechał na czas.");
    expect(cytat.tagName.toLowerCase()).toBe("blockquote");
    expect(
      within(cytat).queryByText("Anna Kowalska"),
      "nazwisko w środku cytatu — czytnik odczyta je jako część wypowiedzi",
    ).toBeNull();
    expect(screen.getByText("Anna Kowalska")).toBeTruthy();
    expect(screen.getByText("Wesele")).toBeTruthy();
  });

  it("rola jest OPCJONALNA — jej brak nie zostawia pustego wiersza", () => {
    pokaz(opinie({ items: [{ quote: "Krótko i na temat.", author: "Dom Kultury" }] }));
    expect(document.querySelector("[data-testimonial-role]")).toBeNull();
  });
});

describe("AUTO-UKŁAD: żadna liczność nie zostawia dziury ani nie ucina opinii", () => {
  const LICZNOSCI = [1, 3, 4, 7];

  it.each(LICZNOSCI)("siatka przy %i opiniach: tyle kafli, ile opinii — i CAŁA treść", (ile) => {
    pokaz(withStructuredLayout(opinie({ items: wpisy(ile) }), "grid"));
    expect(document.querySelectorAll("[data-testimonial]").length).toBe(ile);
    for (let index = 0; index < ile; index += 1) {
      expect(
        screen.getByText(`Opinia numer ${index + 1} — pełne zdanie, które ma się zmieścić w całości.`),
        `opinia ${index + 1} zniknęła albo została ucięta`,
      ).toBeTruthy();
    }
  });

  it.each(LICZNOSCI)("przy %i opiniach rząd wypełniają WPISY, a nie stałe tory siatki", (ile) => {
    pokaz(withStructuredLayout(opinie({ items: wpisy(ile) }), "grid"));
    const lista = document.querySelector<HTMLElement>("[data-testimonials-grid]")!;

    expect(lista.className, "kontener nie jest pasem zawijanym").toContain("site-auto-grid");
    expect(
      lista.className,
      "wrócił stały tor siatki — ostatni rząd zostawi puste komórki",
    ).not.toMatch(/(^|\s)grid-cols-\d/);
    expect(
      Number(lista.style.getPropertyValue("--site-auto-cols")),
      `${ile} opinii w większej liczbie kolumn — pustka w JEDYNYM rzędzie`,
    ).toBeLessThanOrEqual(ile);
  });

  it("cztery opinie stają w RÓWNYCH dwóch rzędach, a nie w 3 + 1", () => {
    pokaz(withStructuredLayout(opinie({ items: wpisy(4) }), "grid"));
    const lista = document.querySelector<HTMLElement>("[data-testimonials-grid]")!;
    expect(lista.style.getPropertyValue("--site-auto-cols")).toBe("2");
  });

  it("KAŻDY kafel ma te same klasy — zero wyjątków dla „ostatniego przy nieparzystej”", () => {
    pokaz(withStructuredLayout(opinie({ items: wpisy(7) }), "grid"));
    const klasy = new Set(
      Array.from(document.querySelectorAll("[data-testimonial]")).map((kafel) => kafel.className),
    );
    expect(
      klasy.size,
      "kafle różnią się klasami — układ ma gałąź po numerze wpisu, czyli wróci przy innej liczbie",
    ).toBe(1);
  });
});

describe("PRZEŁĄCZNIK UKŁADU JEST BEZSTRATNY NA REALNEJ TREŚCI", () => {
  it("siatka → karuzela → siatka oddaje treść co do klucza", () => {
    const wejscie = opinie({
      items: [
        { quote: "Namiot stanął dzień wcześniej.", author: "Anna i Marek", role: "Wesele" },
        { quote: "Nagłośnienie zawsze sprawne.", author: "Katarzyna Nowak" },
      ],
    });
    expect(withStructuredLayout(withStructuredLayout(wejscie, "carousel"), "grid")).toEqual(wejscie);
  });

  it("OBA układy pokazują tę samą treść — przełączenie nie gubi opinii", () => {
    const tresc = opinie({ items: wpisy(5) });
    for (const layout of ["grid", "carousel"] as const) {
      cleanup();
      pokaz(withStructuredLayout(tresc, layout));
      expect(
        document.querySelectorAll("[data-testimonial]").length,
        `układ „${layout}” pokazał inną liczbę opinii`,
      ).toBe(5);
    }
  });
});
