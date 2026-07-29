// @vitest-environment jsdom

/**
 * Lista sekcji edytora strony (Kreator A1) — kontrakt warstwy klienta.
 *
 * Skuteczność zapisu pod RLS i kompletność pozycji po stronie SERWERA dowodzi
 * test integracyjny (site-editor-actions.test.ts, żywy Supabase, dowody
 * mutacyjne). TU pilnujemy tego, co robi klik/klawiatura w edytorze:
 *
 *   1. reorder (strzałka „niżej" — fallback klawiaturowy, deterministyczny w
 *      jsdom, w przeciwieństwie do przeciągania myszą) woła akcję z PEŁNYM
 *      kompletem id w NOWEJ kolejności (asercja na treści wywołania);
 *   2. duplikowanie woła duplicateAction z id sekcji;
 *   3. usunięcie WYMAGA potwierdzenia w oknie — sam klik „Usuń" NIE woła akcji;
 *   4. każdy wiersz ma uchwyt przeciągania z etykietą, a strzałki zostają jako
 *      fallback a11y (przeciąganie myszą weryfikowane w przeglądarce).
 *
 * Dowód mutacyjny warstwy klienta (opis w raporcie): gdyby reorder wysyłał samą
 * przestawioną parę zamiast kompletu (`next.filter(...)`), asercja na komplet
 * (test 1) staje się czerwona.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SortableSections } from "@/app/[locale]/(panel)/strona/sortable-sections";
import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";

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

const sec = plMessages.site.sections;

function section(id: string, heading: string): EditorSection {
  return { id, type: "hero", position: 0, enabled: true, content: { heading } };
}

const A = section("11111111-1111-4111-8111-111111111111", "Alfa");
const B = section("22222222-2222-4222-8222-222222222222", "Beta");
const C = section("33333333-3333-4333-8333-333333333333", "Gamma");

function renderList(overrides: Partial<Parameters<typeof SortableSections>[0]> = {}) {
  const props = {
    siteId: "99999999-9999-4999-8999-999999999999",
    sections: [A, B, C],
    reorderAction: vi.fn(async () => ({ ok: true }) as const),
    toggleAction: vi.fn(async () => ({ ok: true }) as const),
    duplicateAction: vi.fn(async () => ({ ok: true }) as const),
    deleteAction: vi.fn(async () => ({ ok: true }) as const),
    onChanged: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SortableSections {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

/** i-ty wiersz sekcji (kolejność ekranowa) — do zawężenia zapytań o przyciski. */
function row(index: number): HTMLElement {
  return screen.getAllByRole("listitem")[index]!;
}

afterEach(() => cleanup());

describe("SortableSections — reorder", () => {
  it("strzałka wyżej/niżej na pierwszym wierszu woła akcję z KOMPLETEM id w nowej kolejności", async () => {
    const props = renderList();

    fireEvent.click(within(row(0)).getByRole("button", { name: sec.moveDown }));

    await waitFor(() => expect(props.reorderAction).toHaveBeenCalledTimes(1));
    // Komplet trzech id, kolejność [B, A, C] — nie sama przestawiona para.
    expect(props.reorderAction).toHaveBeenCalledWith([B.id, A.id, C.id]);
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it("strzałka w górę na pierwszym wierszu jest wyłączona (nie ma dokąd)", () => {
    renderList();
    const up = within(row(0)).getByRole("button", { name: sec.moveUp }) as HTMLButtonElement;
    expect(up.disabled).toBe(true);
  });

  it("błąd akcji COFA kolejność i pokazuje komunikat (rollback, role=alert)", async () => {
    const reorderAction = vi.fn(async () => ({ ok: false, error: "Zapis padł" }) as const);
    renderList({ reorderAction });

    fireEvent.click(within(row(0)).getByRole("button", { name: sec.moveDown }));

    // Komunikat błędu się pojawia…
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Zapis padł");
    // …a lista wróciła do pierwotnej kolejności (Alfa znów pierwsza).
    expect(within(row(0)).getByDisplayValue("Alfa")).toBeTruthy();
  });
});

describe("SortableSections — duplikowanie", () => {
  it("duplikowanie na drugim wierszu woła duplicateAction z id tej sekcji", async () => {
    const props = renderList();

    fireEvent.click(within(row(1)).getByRole("button", { name: sec.duplicate }));

    await waitFor(() => expect(props.duplicateAction).toHaveBeenCalledTimes(1));
    expect(props.duplicateAction).toHaveBeenCalledWith(B.id);
  });
});

describe("SortableSections — usuwanie z potwierdzeniem", () => {
  it("sam klik usuwania NIE woła akcji; dopiero potwierdzenie w oknie", async () => {
    const props = renderList();

    // Klik CTA w wierszu otwiera okno, ale nie usuwa.
    fireEvent.click(within(row(0)).getByRole("button", { name: sec.remove }));
    expect(props.deleteAction).not.toHaveBeenCalled();

    // Okno pokazuje pytanie potwierdzenia.
    expect(await screen.findByText(sec.confirmRemoveTitle)).toBeTruthy();

    // Potwierdzenie (submit „Usuń sekcję", nazwa ≠ wierszowe „Usuń").
    const confirm = screen.getByRole("button", { name: sec.confirmRemove });
    fireEvent.submit(confirm.closest("form")!);

    await waitFor(() => expect(props.deleteAction).toHaveBeenCalledTimes(1));
    expect(props.deleteAction).toHaveBeenCalledWith(A.id);
  });
});

describe("SortableSections — sygnał zajętości u KAŻDEGO callera", () => {
  // Bramka pending-states (Część B) kotwiczy na DEFINICJI RowButton (/loading?/
  // w sygnaturze), więc zdjęcie loading={pending} z POJEDYNCZEGO wywołania jest
  // dla niej niewidzialne. Ten test patrzy na WYWOŁANIA: podczas pending każdy
  // przycisk-akcja wiersza musi nieść aria-busy — regresja u jednego callera
  // (np. samej strzałki „w górę") pali się tutaj.
  //
  // Dowód mutacyjny (opis w raporcie): zdjęcie loading={pending} z JEDNEGO
  // RowButton w sortable-sections.tsx → ten test czerwony; restore → zielony.
  const ROW_BUTTON_NAMES = [sec.moveUp, sec.moveDown, sec.disable, sec.duplicate];

  it("podczas pending KAŻDY RowButton każdego wiersza ma aria-busy=true", async () => {
    // Akcja WISZĄCA (nie kończy się) trzyma tranzycję listy w stanie pending.
    let release: (v: { ok: true }) => void = () => {};
    const hang = new Promise<{ ok: true }>((r) => (release = r));
    const duplicateAction = vi.fn(() => hang);
    renderList({ duplicateAction });

    fireEvent.click(within(row(0)).getByRole("button", { name: sec.duplicate }));

    await waitFor(() => {
      const buttons = ROW_BUTTON_NAMES.flatMap((name) => screen.getAllByRole("button", { name }));
      // 4 akcje wiersza × 3 wiersze — kontrola pozytywna liczności.
      expect(buttons).toHaveLength(ROW_BUTTON_NAMES.length * 3);
      for (const b of buttons) {
        expect(b.getAttribute("aria-busy"), `${b.textContent?.trim()} bez aria-busy podczas pending`).toBe("true");
      }
    });

    release({ ok: true });
  });
});

describe("SortableSections — a11y kolejności", () => {
  it("każdy wiersz ma uchwyt przeciągania z etykietą, a strzałki zostają jako fallback", () => {
    renderList();
    expect(screen.getAllByLabelText(sec.dragHandle)).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: sec.moveUp })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: sec.moveDown })).toHaveLength(3);
  });
});
