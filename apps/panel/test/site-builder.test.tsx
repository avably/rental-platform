// @vitest-environment jsdom

/**
 * PŁÓTNO KREATORA (K1, ADR-083) — kontrakt warstwy klienta.
 *
 * Skuteczność zapisu pod RLS i kompletność pozycji po stronie SERWERA dowodzi
 * `site-editor-actions.test.ts` (żywy Supabase). TU pilnujemy tego, co robi
 * klik i klawiatura na płótnie:
 *
 *   1. pasek narzędzi sekcji WYCHODZI dopiero przy sekcji (hover/fokus) i
 *      niesie komplet akcji — nie wisi nad dwunastoma sekcjami naraz;
 *   2. duplikowanie woła akcję z id TEJ sekcji;
 *   3. usunięcie WYMAGA potwierdzenia — sam klik „Usuń” NIE woła akcji;
 *   4. „+” MIĘDZY sekcjami wstawia DOKŁADNIE tam, gdzie kliknięto (asercja na
 *      TREŚCI wywołania `reorderSections`, nie na fakcie wywołania);
 *   5. „+” na końcu i kafel z palety dokładają na KOŃCU;
 *   6. strzałka „niżej” zapisuje PEŁEN komplet pozycji.
 *
 * Dowód mutacyjny warstwy klienta (opis w raporcie): gdy `addSection` przestaje
 * czytać wskazany indeks i wstawia zawsze na końcu (`orderedIds.length`),
 * test 4 staje się czerwony, a test 5 zostaje zielony — czyli asercja mierzy
 * POZYCJĘ, a nie sam fakt dodania.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

/** Radix Dialog i sensory dnd-kit wołają API, których jsdom nie implementuje. */
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const actions = vi.hoisted(() => ({
  upsertSection: vi.fn(),
  reorderSections: vi.fn(),
  toggleSection: vi.fn(),
  duplicateSection: vi.fn(),
  deleteSection: vi.fn(),
  updateTemplate: vi.fn(),
  publishSite: vi.fn(),
}));

vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: () => {} }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/kreator/site-builder");
const { orderWithInsertedAt } = await import(
  "@/app/[locale]/(kreator)/strona/kreator/insert-position"
);

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const A: Section = { id: "aaaaaaaa-1111-4111-8111-111111111111", type: "hero", position: 0, enabled: true, content: { heading: "Alfa" } };
const B: Section = { id: "bbbbbbbb-2222-4222-8222-222222222222", type: "pricing", position: 1, enabled: true, content: { heading: "Beta" } };
const C: Section = { id: "cccccccc-3333-4333-8333-333333333333", type: "faq", position: 2, enabled: false, content: { heading: "Gamma", items: [] } };
const NEW_ID = "dddddddd-4444-4444-8444-444444444444";
const SITE_ID = "99999999-9999-4999-8999-999999999999";

const sec = plMessages.site.sections;
const builder = plMessages.site.builder;

function renderBuilder(sections: Section[] = [A, B, C]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder siteId={SITE_ID} template="classic" sections={sections} products={[]} />
    </NextIntlClientProvider>,
  );
}

/** Odsłania pasek narzędzi sekcji — dokładnie tak, jak robi to kursor. */
function hoverSection(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-canvas-section="${id}"]`);
  expect(node, `brak sekcji ${id} na płótnie`).not.toBeNull();
  fireEvent.mouseEnter(node!);
  const toolbar = node!.querySelector<HTMLElement>(`[data-section-toolbar="${id}"]`);
  expect(toolbar, `pasek narzędzi nie wyszedł przy sekcji ${id}`).not.toBeNull();
  return toolbar!;
}

/** Klika „+” o danym indeksie i wybiera z galerii kafel „Baner (hero)”. */
function addHeroAt(container: HTMLElement, index: number) {
  const trigger = container.querySelector<HTMLElement>(`[data-insert-at="${index}"]`);
  expect(trigger, `brak miejsca wstawienia o indeksie ${index}`).not.toBeNull();
  fireEvent.click(trigger!);
  // Kafel MUSI pochodzić z OTWARTEGO OKNA, nie z palety: ta sama siatka
  // (`SectionTypeGallery`) stoi na stałe również w lewej kolumnie, a paleta
  // dokłada na KOŃCU — bez zawężenia do okna test mierzyłby nie tę drogę
  // i przechodziłby także wtedy, gdy „+” w środku strony jest zepsute.
  const tile = document.querySelector<HTMLElement>('[role="dialog"] [data-add-section-tile="hero"]');
  expect(tile, "galeria nie otworzyła się z kaflem hero").not.toBeNull();
  fireEvent.click(tile!);
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: NEW_ID });
  actions.reorderSections.mockResolvedValue({ ok: true });
  actions.toggleSection.mockResolvedValue({ ok: true });
  actions.duplicateSection.mockResolvedValue({ ok: true });
  actions.deleteSection.mockResolvedValue({ ok: true });
  actions.updateTemplate.mockResolvedValue({ ok: true });
  actions.publishSite.mockResolvedValue({ ok: true, publishedAt: "2026-07-31T10:00:00Z" });
});

afterEach(() => cleanup());

describe("pasek narzędzi sekcji wychodzi przy sekcji i niesie komplet akcji", () => {
  it("w spoczynku płótno nie pokazuje ANI JEDNEGO paska", () => {
    const { container } = renderBuilder();
    expect(container.querySelectorAll("[data-section-toolbar]")).toHaveLength(0);
    // Kontrola po pustym zbiorze: sekcje NA PEWNO są, więc brak pasków to
    // decyzja, a nie puste płótno.
    expect(container.querySelectorAll("[data-canvas-section]")).toHaveLength(3);
  });

  it("najechanie odsłania pasek TEJ sekcji — i tylko tej", () => {
    const { container } = renderBuilder();
    hoverSection(container, B.id);
    expect(container.querySelectorAll("[data-section-toolbar]")).toHaveLength(1);
    expect(container.querySelector(`[data-section-toolbar="${A.id}"]`)).toBeNull();
  });

  it("pasek niesie uchwyt przeciągania, kolejność, duplikat, ustawienia i usunięcie", () => {
    const { container } = renderBuilder();
    const toolbar = hoverSection(container, B.id);

    expect(within(toolbar).getByLabelText(sec.dragHandle)).toBeTruthy();
    for (const label of [sec.moveUp, sec.moveDown, sec.duplicate, builder.settings, sec.remove]) {
      expect(within(toolbar).getByRole("button", { name: label }), `zgubiona akcja: ${label}`).toBeTruthy();
    }
    // Sekcja WŁĄCZONA proponuje wyłączenie (i odwrotnie) — jedna kontrolka, dwa stany.
    expect(within(toolbar).getByRole("button", { name: sec.disable })).toBeTruthy();
  });

  it("sekcja wyłączona zostaje na płótnie, ale mówi wprost, że klient jej nie zobaczy", () => {
    const { container } = renderBuilder();
    expect(container.querySelector(`[data-section-hidden="${C.id}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-section-hidden="${A.id}"]`)).toBeNull();
    // Wyłączona proponuje WŁĄCZENIE.
    const toolbar = hoverSection(container, C.id);
    expect(within(toolbar).getByRole("button", { name: sec.enable })).toBeTruthy();
  });
});

describe("akcje paska idą do istniejących akcji modelu sekcyjnego", () => {
  it("duplikowanie woła duplicateSection z id TEJ sekcji", async () => {
    const { container } = renderBuilder();
    const toolbar = hoverSection(container, B.id);
    fireEvent.click(within(toolbar).getByRole("button", { name: sec.duplicate }));
    await waitFor(() => expect(actions.duplicateSection).toHaveBeenCalledWith(B.id));
  });

  it("usunięcie WYMAGA potwierdzenia — sam klik w „Usuń” nie woła akcji", async () => {
    const { container } = renderBuilder();
    const toolbar = hoverSection(container, B.id);
    fireEvent.click(within(toolbar).getByRole("button", { name: sec.remove }));
    expect(actions.deleteSection).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: sec.confirmRemove }));
    await waitFor(() => expect(actions.deleteSection).toHaveBeenCalledWith(B.id));
  });

  it("strzałka „niżej” zapisuje PEŁEN komplet pozycji w nowej kolejności", async () => {
    const { container } = renderBuilder();
    const toolbar = hoverSection(container, A.id);
    fireEvent.click(within(toolbar).getByRole("button", { name: sec.moveDown }));
    await waitFor(() =>
      expect(actions.reorderSections).toHaveBeenCalledWith(SITE_ID, [B.id, A.id, C.id]),
    );
  });
});

describe("„+ Dodaj sekcję” wstawia DOKŁADNIE tam, gdzie kliknięto", () => {
  it("między pierwszą a drugą sekcją: nowa sekcja ląduje na pozycji 2", async () => {
    const { container } = renderBuilder();
    addHeroAt(container, 1);

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(actions.reorderSections).toHaveBeenCalledWith(SITE_ID, [A.id, NEW_ID, B.id, C.id]),
    );
  });

  it("na samym początku strony: nowa sekcja ląduje na pozycji 1", async () => {
    const { container } = renderBuilder();
    addHeroAt(container, 0);
    await waitFor(() =>
      expect(actions.reorderSections).toHaveBeenCalledWith(SITE_ID, [NEW_ID, A.id, B.id, C.id]),
    );
  });

  it("„+” pod ostatnią sekcją dokłada na KOŃCU", async () => {
    const { container } = renderBuilder();
    addHeroAt(container, 3);
    await waitFor(() =>
      expect(actions.reorderSections).toHaveBeenCalledWith(SITE_ID, [A.id, B.id, C.id, NEW_ID]),
    );
  });

  it("nieudany zapis sekcji NIE zapisuje kolejności", async () => {
    actions.upsertSection.mockResolvedValue({ ok: false, error: "Nie udało się." });
    const { container } = renderBuilder();
    addHeroAt(container, 1);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Nie udało się."));
    expect(actions.reorderSections).not.toHaveBeenCalled();
  });
});

describe("lewa paleta: sekcje z palety, elementy jako zapowiedź, szablon w stopce", () => {
  it("kafel z palety dokłada sekcję na KOŃCU strony", async () => {
    const { container } = renderBuilder();
    const palette = container.querySelector<HTMLElement>('[data-builder-palette="expanded"]');
    expect(palette).not.toBeNull();
    fireEvent.click(within(palette!).getByRole("button", { name: /Cennik/ }));
    await waitFor(() =>
      expect(actions.reorderSections).toHaveBeenCalledWith(SITE_ID, [A.id, B.id, C.id, NEW_ID]),
    );
  });

  it("zakładka „Elementy” mówi wprost, czego jeszcze nie ma", () => {
    const { container } = renderBuilder();
    fireEvent.click(container.querySelector<HTMLElement>('[data-palette-tab="elements"]')!);
    expect(container.querySelector("[data-palette-elements-soon]")?.textContent).toContain(
      builder.elementsSoonTitle,
    );
    // Zapowiedź NIE udaje kontrolek: żadnego przycisku dodania elementu.
    expect(container.querySelector("[data-palette-elements-soon] button")).toBeNull();
  });

  it("paleta się zwija i rozwija", () => {
    const { container } = renderBuilder();
    fireEvent.click(container.querySelector<HTMLElement>("[data-palette-toggle]")!);
    expect(container.querySelector('[data-builder-palette="collapsed"]')).not.toBeNull();
    fireEvent.click(container.querySelector<HTMLElement>("[data-palette-toggle]")!);
    expect(container.querySelector('[data-builder-palette="expanded"]')).not.toBeNull();
  });

  it("wybór szablonu zapisuje się istniejącą akcją", async () => {
    const { container } = renderBuilder();
    const templateBlock = container.querySelector<HTMLElement>("[data-builder-template]")!;
    fireEvent.click(within(templateBlock).getByRole("radio", { name: /Bold/ }));
    fireEvent.click(within(templateBlock).getByRole("button", { name: plMessages.site.template.save }));
    await waitFor(() => expect(actions.updateTemplate).toHaveBeenCalledWith(SITE_ID, "bold"));
  });
});

describe("górny pasek: powrót, viewport, szkielet historii, stan zapisu, publikacja", () => {
  it("powrót prowadzi na launcher, a nie w głąb kreatora", () => {
    const { container } = renderBuilder();
    expect(container.querySelector("[data-builder-back]")?.getAttribute("href")).toBe("/strona");
  });

  it("przełącznik viewportu zmienia szerokość płótna", () => {
    const { container } = renderBuilder();
    expect(container.querySelector("[data-builder-canvas]")?.getAttribute("data-viewport")).toBe("desktop");
    fireEvent.click(screen.getByRole("button", { name: builder.viewportMobile }));
    expect(container.querySelector("[data-builder-canvas]")?.getAttribute("data-viewport")).toBe("mobile");
  });

  it("cofnij/ponów startuje WYŁĄCZONE — nie ma jeszcze czego cofnąć (K2)", () => {
    // Do K1 przyciski były szkieletem z zapowiedzią „wkrótce". Od K2 historia
    // istnieje naprawdę, więc wyłączenie znaczy „pusty stos", a nie „brak
    // funkcji" — dowód, że stan płótna napędza pasek, jest w canvas-editing.
    const { container } = renderBuilder();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("[data-builder-history-button]")];
    expect(buttons.map((button) => button.getAttribute("data-builder-history-button"))).toEqual([
      "undo",
      "redo",
    ]);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("aria-label")).not.toContain(builder.soon);
    }
  });

  it("stan zapisu mówi „Zapisano” dopiero po udanej mutacji", async () => {
    const { container } = renderBuilder();
    const state = container.querySelector("[data-builder-save-state]")!;
    expect(state.textContent).toBe("");

    const toolbar = hoverSection(container, B.id);
    fireEvent.click(within(toolbar).getByRole("button", { name: sec.duplicate }));
    await waitFor(() => expect(state.textContent).toBe(builder.saved));
  });

  it("nieudana mutacja NIE melduje zapisu — zostawia komunikat", async () => {
    actions.duplicateSection.mockResolvedValue({ ok: false, error: "Brak uprawnień." });
    const { container } = renderBuilder();
    const toolbar = hoverSection(container, B.id);
    fireEvent.click(within(toolbar).getByRole("button", { name: sec.duplicate }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Brak uprawnień."));
    expect(container.querySelector("[data-builder-save-state]")?.textContent).toBe("");
  });

  it("publikacja idzie istniejącą akcją publish_site", async () => {
    const { container } = renderBuilder();
    fireEvent.click(container.querySelector<HTMLElement>("[data-builder-publish]")!);
    await waitFor(() => expect(actions.publishSite).toHaveBeenCalledWith(SITE_ID));
  });
});

describe("puste płótno jest STANEM, a nie zniknięciem kreatora", () => {
  it("bez sekcji kreator mówi, co zrobić, i daje pierwsze miejsce wstawienia", () => {
    const { container } = renderBuilder([]);
    expect(container.querySelector("[data-builder-canvas-empty]")?.textContent).toContain(
      builder.emptyTitle,
    );
    expect(container.querySelector('[data-insert-at="0"]')).not.toBeNull();
    // Paleta zostaje — pusta strona to nie powód, żeby chować narzędzia.
    expect(container.querySelector('[data-builder-palette="expanded"]')).not.toBeNull();
  });
});

describe("arytmetyka wstawienia (czysta funkcja)", () => {
  it("indeks liczony jest w skali listy BEZ nowego elementu", () => {
    expect(orderWithInsertedAt(["a", "b", "c"], "n", 0)).toEqual(["n", "a", "b", "c"]);
    expect(orderWithInsertedAt(["a", "b", "c"], "n", 2)).toEqual(["a", "b", "n", "c"]);
    expect(orderWithInsertedAt(["a", "b", "c"], "n", 3)).toEqual(["a", "b", "c", "n"]);
  });

  it("indeks spoza zakresu przycina się do krawędzi zamiast wywracać zapis", () => {
    expect(orderWithInsertedAt(["a", "b"], "n", -5)).toEqual(["n", "a", "b"]);
    expect(orderWithInsertedAt(["a", "b"], "n", 99)).toEqual(["a", "b", "n"]);
  });

  it("nowe id nie duplikuje się, gdy przyszło już w komplecie z serwera", () => {
    expect(orderWithInsertedAt(["a", "n", "b"], "n", 0)).toEqual(["n", "a", "b"]);
  });
});
