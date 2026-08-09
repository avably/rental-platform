// @vitest-environment jsdom

/**
 * Pola własne na formularzach panelu (C6-A2, ADR-119).
 *
 * Dowodzimy tego, czego nie dowiedzie ani rdzeń, ani baza: że KONTRAKT
 * WIDOCZNOŚCI działa na ekranie w obie strony (pole z flagą „panel" jest,
 * pole bez niej nie ma jak się pojawić) i że wartość zapisana w bazie wraca
 * do właściwego pola we właściwym typie kontrolki.
 *
 * Reguły walidacji NIE są tu sprawdzane — mieszkają w `@avably/core`
 * i w triggerze 0057, a ich parytetu pilnuje wspólny zestaw wektorów.
 */
import type { CustomFieldDefinition } from "@avably/core";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CustomFieldsFieldset } from "@/components/fields/custom-fields-fieldset";
import { customFieldName, loadPanelCustomFields, readCustomFieldsFromForm } from "@/lib/custom-fields";

import plMessages from "../messages/pl.json";

/** Radix Select woła API, których jsdom nie implementuje. */
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

// jsdom trzyma drzewo między testami — bez sprzątania `querySelector` widzi
// pozostałości poprzedniego renderu (lekcja z jsdom-id-selector-needs-cleanup).
afterEach(cleanup);

const messages = { customFields: plMessages.customFields };

const ID = {
  panelText: "11111111-1111-4111-8111-111111111111",
  checkoutOnly: "22222222-2222-4222-8222-222222222222",
  archived: "33333333-3333-4333-8333-333333333333",
  date: "44444444-4444-4444-8444-444444444444",
  select: "55555555-5555-4555-8555-555555555555",
  checkbox: "66666666-6666-4666-8666-666666666666",
  number: "77777777-7777-4777-8777-777777777777",
} as const;

function definition(
  id: string,
  overrides: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
  return {
    id,
    entity: "customer",
    type: "text",
    label: "Numer uprawnień",
    helpText: null,
    required: false,
    options: [],
    position: 0,
    showInPanel: true,
    showInCheckout: false,
    showInContract: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Wiersz w kształcie, w jakim oddaje go PostgREST. */
function definitionRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    entity: "customer",
    field_type: "text",
    label: "Pole",
    help_text: null,
    required: false,
    options: [],
    position: 0,
    show_in_panel: true,
    show_in_checkout: false,
    show_in_contract: false,
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fakeSupabase(rows: unknown[]) {
  const eqs: [string, unknown][] = [];
  const builder: Record<string, unknown> = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      eqs.push([column, value]);
      return builder;
    },
    order() {
      return builder;
    },
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
  return {
    supabase: { from: () => builder } as never,
    eqs,
  };
}

function renderFieldset(props: Parameters<typeof CustomFieldsFieldset>[0]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <CustomFieldsFieldset {...props} />
    </NextIntlClientProvider>,
  );
}

describe("wybór pól na formularz panelu", () => {
  it("bierze pole z flagą „panel”, pomija checkoutowe i zarchiwizowane", async () => {
    const { supabase, eqs } = fakeSupabase([
      definitionRow(ID.panelText, { label: "Numer uprawnień", position: 1 }),
      definitionRow(ID.checkoutOnly, {
        label: "Skąd o nas wiesz",
        show_in_panel: false,
        show_in_checkout: true,
        position: 0,
      }),
      definitionRow(ID.archived, {
        label: "Stary numer",
        archived_at: "2026-08-01T00:00:00Z",
        position: 2,
      }),
    ]);

    const fields = await loadPanelCustomFields(supabase, "tenant-a", "customer");

    expect(fields.map((field) => field.label)).toEqual(["Numer uprawnień"]);
    // Zapytanie jest zawężone najemcą i encją — druga warstwa obok RLS.
    expect(eqs).toContainEqual(["tenant_id", "tenant-a"]);
    expect(eqs).toContainEqual(["entity", "customer"]);
  });
});

describe("render pól własnych", () => {
  it("nie renderuje nagłówka, gdy najemca nie ma pól", () => {
    const { container } = renderFieldset({ fields: [], values: {} });
    expect(container.querySelector("[data-custom-fields]")).toBeNull();
  });

  it("renderuje etykietę najemcy i wiąże ją z polem pod nazwą z identyfikatora", () => {
    renderFieldset({ fields: [definition(ID.panelText)], values: {} });

    const input = screen.getByLabelText("Numer uprawnień");
    // Nazwa pola to ID definicji, nigdy etykieta: etykietę operator zmienia
    // w ustawieniach, a wiązanie ma to przetrwać.
    expect(input.getAttribute("name")).toBe(customFieldName(ID.panelText));
  });

  it("zachowuje kolejność z definicji, a nie kolejność w mapie wartości", () => {
    const { container } = renderFieldset({
      fields: [
        definition(ID.date, { label: "Data przeglądu", type: "date", position: 0 }),
        definition(ID.panelText, { label: "Numer uprawnień", position: 1 }),
      ],
      values: { [ID.panelText]: "UP/1", [ID.date]: "2026-03-05" },
    });

    const rendered = [...container.querySelectorAll("[data-custom-field]")].map((node) =>
      node.getAttribute("data-custom-field"),
    );
    expect(rendered).toEqual([ID.date, ID.panelText]);
  });

  it("dobiera kontrolkę do rodzaju pola", () => {
    const { container } = renderFieldset({
      fields: [
        definition(ID.date, { type: "date", label: "Data przeglądu" }),
        definition(ID.checkbox, { type: "checkbox", label: "Zgoda" }),
        definition(ID.number, { type: "number", label: "Stan licznika" }),
      ],
      values: { [ID.checkbox]: true, [ID.number]: 1234.5 },
    });

    expect(screen.getByLabelText("Data przeglądu").getAttribute("type")).toBe("date");
    // Pole zaznaczane odbija zapisane `true`, a nie stan domyślny kontrolki.
    expect(
      container
        .querySelector(`[data-custom-field="${ID.checkbox}"] button[role="checkbox"]`)
        ?.getAttribute("data-state"),
    ).toBe("checked");
    // Liczba wraca w zapisie polskim — takim, w jakim operator ją wpisał.
    expect((screen.getByLabelText("Stan licznika") as HTMLInputElement).value).toBe("1234,5");
  });

  it("konwencję nagłówka wybiera POWIERZCHNIA, nie komponent", () => {
    // Ten sam fieldset stoi na karcie prowadzonej kapitalikami, w kreatorze
    // z dużymi nagłówkami sekcji i na formularzu bez grup. Twardy `uppercase`
    // w komponencie zgodziłby pola własne z jedną konwencją i poróżnił
    // z dwiema — więc wariant przychodzi z ekranu.
    const legend = () => document.querySelector("[data-custom-fields] legend")!;

    renderFieldset({ fields: [definition(ID.panelText)], values: {}, legendVariant: "eyebrow" });
    expect(legend().className).toContain("uppercase");
    cleanup();

    renderFieldset({ fields: [definition(ID.panelText)], values: {}, legendVariant: "label" });
    expect(legend().className).not.toContain("uppercase");
    cleanup();

    renderFieldset({ fields: [definition(ID.panelText)], values: {}, legendVariant: "section" });
    expect(legend().className).not.toContain("uppercase");
    expect(legend().className).toContain("text-xl");
  });

  it("gdy grupę nazywa nagłówek ekranu, legendy nie ma wcale", () => {
    // Karta zamówienia ma własny `<h2>` — druga „Pola własne" pod spodem
    // czytałaby się jak usterka. Nazwa grupy idzie wtedy przez aria.
    const { container } = renderFieldset({
      fields: [definition(ID.panelText)],
      values: {},
      labelledBy: "order-custom-fields-heading",
    });
    expect(container.querySelector("legend")).toBeNull();
    expect(
      container.querySelector("[data-custom-fields]")?.getAttribute("aria-labelledby"),
    ).toBe("order-custom-fields-heading");
  });

  it("pokazuje odmowę POD polem, którego dotyczy, i oznacza je maszynowo", () => {
    renderFieldset({
      fields: [definition(ID.panelText)],
      values: {},
      errors: { [customFieldName(ID.panelText)]: "Wypełnij to pole." },
    });

    const input = screen.getByLabelText("Numer uprawnień");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Wypełnij to pole.");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("lista wyboru ma pustkę — wymagalności pilnuje serwer, nie podstawiona opcja", () => {
    renderFieldset({
      fields: [
        definition(ID.select, { type: "select", label: "Rodzaj", options: ["Alfa", "Beta"], required: true }),
      ],
      values: {},
    });
    expect(screen.getByText(plMessages.customFields.values.notSelected)).toBeTruthy();
  });
});

describe("odczyt formularza", () => {
  const t = (key: string) => key;

  it("odmowy trafiają pod nazwy pól formularza, a odmowa całej mapy — nad formularz", () => {
    const form = new FormData();
    form.set(customFieldName(ID.date), "2026-02-31");

    const result = readCustomFieldsFromForm(
      [definition(ID.date, { type: "date" })],
      form,
      t as never,
      { entity: "customer" },
    );

    expect(result.fieldErrors[customFieldName(ID.date)]).toBe("issue.date");
    expect(result.formError).toBeUndefined();
  });

  it("wartości pola spoza panelu nie da się podmienić formularzem panelu", () => {
    // WEKTOR: operator dokłada do żądania `cf_<id>` definicji oznaczonej
    // wyłącznie „zamawianie". Widoczność jest kontraktem, więc wartość ma
    // zostać taka, jak ją zapisał klient w sklepie.
    const form = new FormData();
    form.set(customFieldName(ID.checkoutOnly), "podmienione");

    const result = readCustomFieldsFromForm(
      [definition(ID.checkoutOnly, { showInPanel: false, showInCheckout: true })],
      form,
      t as never,
      { entity: "customer", existing: { [ID.checkoutOnly]: "z plakatu" } },
    );

    expect(result.fieldErrors).toEqual({});
    expect(result.values[ID.checkoutOnly]).toBe("z plakatu");
  });
});
