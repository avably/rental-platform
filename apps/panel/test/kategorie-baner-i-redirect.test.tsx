// @vitest-environment jsdom

/**
 * DROGA DO BANERA KATEGORII I ODMOWA PUSTEJ NAZWY (K-16/K-17/K-24, audyt UX
 * 2026-08-25; K-16 zgłoszone przez właściciela z własnego przebiegu).
 *
 * ===================== WADA, KTÓRĄ TEN PLIK ZAMYKA =====================
 *
 * Baner kategorii MA pole — tylko nie tam, gdzie operator go szuka. Wymaga
 * istniejącego wiersza (bilet uploadu i zapis wołają `p_category_id`), więc
 * mieszka w EDYCJI. Formularz zakładania o tym milczał, a po „Załóż kategorię"
 * akcja odsyłała na LISTĘ — czyli w miejsce, w którym banera też nie widać.
 * Operator, który przyszedł dodać grafikę kafla, wychodził z przekonaniem, że
 * banera nie da się wgrać. Do tego pusta nazwa padała natywnym dymkiem
 * przeglądarki (`required`), a nie stylem panelu.
 *
 * ===================== CO JEST MIERZONE =====================
 *
 *   1. ZDANIE O BANERZE stoi w formularzu ZAKŁADANIA i znika w EDYCJI, gdzie
 *      zamiast niego jest prawdziwe pole;
 *   2. UDANE ZAŁOŻENIE PRZEKIEROWUJE DO EDYCJI TEJ kategorii — po
 *      identyfikatorze z bazy, nie na listę. To jest dowód mutacyjny K-16b:
 *      cel przekierowania niesie id świeżego wiersza;
 *   3. NIEUDANE założenie nie przekierowuje NIGDZIE (operator zostaje przy
 *      swoich danych, z komunikatem);
 *   4. PUSTA NAZWA jest odrzucana STYLEM PANELU — bez `required`, z błędem pod
 *      polem i bez wysyłki. Bramka serwera (Zod) zostaje: sprawdzamy, że
 *      mówi tym samym zdaniem.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

const NOWA_ID = "cccccccc-1111-4111-8111-cccccccccccc";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

/* ============================ CZĘŚĆ 1: AKCJA ============================ */

const redirect = vi.hoisted(() => vi.fn());
const insertResult = vi.hoisted(() => ({
  data: null as { id: string } | null,
  error: null as { code?: string; message: string } | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ localePath: async (path: string) => `/pl${path}` }));
vi.mock("@/lib/catalog-cache", () => ({ invalidateStorefrontCatalog: vi.fn(async () => {}) }));

const supabase = vi.hoisted(() => ({
  from(table: string) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      insert: () => chain,
      single: () =>
        Promise.resolve(
          table === "catalog_categories"
            ? { data: insertResult.data, error: insertResult.error }
            : { data: null, error: null },
        ),
      // Odczyt rodzeństwa (pozycje) — pusta lista znaczy „pierwsza kategoria".
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: [], error: null }),
    };
    return chain;
  },
}));

vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => ({ supabase, tenantId: TENANT_ID }),
}));

const { createCategoryAction } = await import(
  "@/app/[locale]/(panel)/katalog/kategorie/actions"
);
const { CategoryForm } = await import("@/app/[locale]/(panel)/katalog/kategorie/category-form");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  redirect.mockReset();
  insertResult.data = { id: NOWA_ID };
  insertResult.error = null;
});

afterEach(() => cleanup());

describe("K-16b: założenie kategorii prowadzi do JEJ edycji, a nie na listę", () => {
  it("przekierowanie niesie identyfikator ŚWIEŻEGO wiersza", async () => {
    await createCategoryAction({}, form({ name: "Namioty", slug: "", description: "" }));

    expect(redirect, "akcja nie przekierowała nigdzie").toHaveBeenCalledTimes(1);
    const cel = redirect.mock.calls[0]![0] as string;
    expect(cel).toBe(`/pl/katalog/kategorie/${NOWA_ID}`);
    // Kontrola negatywna: sam adres listy jest prefiksem celu, więc bez tej
    // asercji test przeszedłby także dla starego zachowania.
    expect(cel).not.toBe("/pl/katalog/kategorie");
  });

  it("odmowa bazy NIE przekierowuje — operator zostaje przy swoich danych", async () => {
    insertResult.data = null;
    insertResult.error = { code: "23505", message: "duplicate key" };

    const state = await createCategoryAction({}, form({ name: "Namioty", slug: "", description: "" }));

    expect(redirect).not.toHaveBeenCalled();
    expect(state.formError, "odmowa bez zdania dla operatora").toBeTruthy();
    // Wpisane wartości przeżywają obieg (U9) — inaczej „zostaje" nic nie znaczy.
    expect(state.values?.name).toBe("Namioty");
  });
});

/* ============================ CZĘŚĆ 2: FORMULARZ ============================ */

function renderForm(props: Partial<Parameters<typeof CategoryForm>[0]> = {}) {
  const action = props.action ?? vi.fn(async () => ({}));
  return {
    action,
    ...render(
      <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
        <CategoryForm
          action={action}
          defaults={{ name: "", slug: "", description: "" }}
          isNew
          submitLabel={plMessages.catalog.categories.form.create}
          {...props}
        />
      </NextIntlClientProvider>,
    ),
  };
}

describe("K-16a: formularz zakładania mówi, gdzie jest baner", () => {
  it("zdanie o banerze stoi przy przycisku zakładania", () => {
    const { container } = renderForm();
    const zdanie = container.querySelector<HTMLElement>("[data-category-banner-later]");
    expect(zdanie, "formularz zakładania milczy o banerze").not.toBeNull();
    expect(zdanie!.textContent).toBe(plMessages.catalog.categories.form.bannerLater);
  });

  it("w EDYCJI zdania nie ma — jest tam prawdziwe pole banera", () => {
    const { container } = renderForm({
      isNew: false,
      categoryId: NOWA_ID,
      bannerPath: null,
      submitLabel: plMessages.catalog.categories.form.save,
    });
    expect(container.querySelector("[data-category-banner-later]")).toBeNull();
    const pole = container.querySelector<HTMLElement>("[data-category-banner]");
    expect(pole, "edycja bez pola banera — przekierowanie prowadziłoby donikąd").not.toBeNull();
    expect(pole!.dataset.categoryBannerState).toBe("empty");
  });
});

describe("K-24: pusta nazwa pada stylem panelu, nie dymkiem przeglądarki", () => {
  it("pole nazwy NIE ma atrybutu `required`", () => {
    renderForm();
    const pole = screen.getByLabelText(plMessages.catalog.categories.form.name);
    expect(
      pole.hasAttribute("required"),
      "`required` wraca do pola — natywny dymek zastępuje błąd panelu",
    ).toBe(false);
  });

  it("wysyłka z pustą nazwą pokazuje błąd POD POLEM i nie woła akcji", () => {
    const { action, container } = renderForm();
    const formularz = container.querySelector("form")!;

    fireEvent.submit(formularz);

    const blad = container.querySelector<HTMLElement>("#category-name-error");
    expect(blad, "brak błędu pod polem nazwy").not.toBeNull();
    expect(blad!.textContent).toBe(plMessages.catalog.categories.form.nameRequired);
    expect(blad!.getAttribute("role")).toBe("alert");
    expect(action, "formularz z pustą nazwą poszedł do akcji").not.toHaveBeenCalled();

    const pole = screen.getByLabelText(plMessages.catalog.categories.form.name);
    expect(pole.getAttribute("aria-invalid")).toBe("true");
    expect(pole.getAttribute("aria-describedby")).toBe("category-name-error");
  });

  it("wpisanie nazwy gasi błąd", () => {
    const { container } = renderForm();
    fireEvent.submit(container.querySelector("form")!);
    expect(container.querySelector("#category-name-error")).not.toBeNull();

    fireEvent.change(screen.getByLabelText(plMessages.catalog.categories.form.name), {
      target: { value: "Namioty" },
    });
    expect(container.querySelector("#category-name-error")).toBeNull();
  });

  it("bramka SERWERA mówi tym samym zdaniem (formularz bez JS)", async () => {
    // Zdanie w i18n i zdanie schematu muszą być tym samym zdaniem — inaczej
    // ten sam błąd brzmiałby inaczej zależnie od tego, czy JS się wykonał.
    const { categorySchema } = await import("@/lib/catalog-validation");
    const parsed = categorySchema.safeParse({ name: "   ", slug: "", description: "" });
    expect(parsed.success).toBe(false);
    const message = parsed.success
      ? undefined
      : parsed.error.issues.find((issue) => issue.path[0] === "name")?.message;
    expect(message).toBe(plMessages.catalog.categories.form.nameRequired);
  });
});
