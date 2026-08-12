// @vitest-environment jsdom

/**
 * KONTRAKT PANELOWEGO SELECTA — ADR-060 (co widać) + ADR-148 (co jedzie).
 *
 * ================== DLACZEGO TEN PLIK ZOSTAŁ PRZEPISANY ==================
 *
 * Do 2026-08-12 ten kontrakt sprawdzał, że most formularza ISTNIEJE:
 * `expect(html).toMatch(/<select[^>]*name="role"/)`. Most istniał i był PUSTY.
 * Radix zbiera swoje `<option>` w efekcie układu, więc z serwera wychodziło
 * `<select name="role"></select>` — zero opcji, zero wartości — i każdy
 * formularz panelu wysłany przed hydracją niósł nic. Bramka mierzyła
 * deklarację zamiast rzeczy i świeciła na zielono nad zepsutym zachowaniem.
 *
 * Stąd reguła, którą ten plik egzekwuje od teraz: kontrakt pola formularza
 * asertuje WARTOŚĆ NIESIONĄ przez most, a nie obecność elementu. Każdy
 * przypadek niżej idzie tą samą drogą, którą idzie produkcja:
 *
 *     render na serwerze → HTML → parser przeglądarki → FormData
 *
 * czyli dokładnie tym, co poleci na serwer z formularza wysłanego, zanim
 * dojedzie JavaScript. Tam, gdzie da się to zrobić, wynik przechodzi przez
 * PRAWDZIWY schemat walidacji ekranu (ustawienia dostaw), a nie przez atrapę
 * napisaną pod test.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { deliverySettingsCredentialsSchema } from "@/app/[locale]/(panel)/ustawienia-dostaw/delivery-settings-validation";

const adapterPath = resolve(process.cwd(), "components/fields/panel-select.tsx");
const adapterExists = existsSync(adapterPath);
const adapterSource = adapterExists ? readFileSync(adapterPath, "utf8") : "";
const adapter = adapterExists ? await import("@/components/fields/panel-select") : null;

const PanelSelect = adapter?.PanelSelect;

const ENVIRONMENT_OPTIONS = [
  { value: "test", label: "Testowe" },
  { value: "production", label: "Produkcyjne" },
];

/**
 * Serwerowy HTML przepuszczony przez parser przeglądarki i zebrany w FormData —
 * stan formularza w oknie PRZED hydracją, bez ani jednej linijki naszego JS.
 */
function bezJs(node: ReactElement) {
  const html = renderToStaticMarkup(node);
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
  const form = doc.querySelector("form");
  expect(form, "render nie zawiera <form> — dalsze asercje byłyby o pustym zbiorze").not.toBeNull();
  return { html, form: form!, data: new FormData(form!) };
}

/** Wartości `<option>`, które most naprawdę wystawia do wyboru. */
function opcjeMostu(form: HTMLFormElement, name: string): string[] {
  const bridge = form.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  expect(bridge, `mostu pola „${name}" nie ma w HTML`).not.toBeNull();
  return [...bridge!.querySelectorAll("option")].map((option) => option.value);
}

describe("kontrakt panelowego Selecta — co widać (ADR-060)", () => {
  it("adapter istnieje i składa WIDOCZNĄ kontrolkę wyłącznie z prymitywów @avably/ui", () => {
    expect(adapterExists, "brak components/fields/panel-select.tsx").toBe(true);
    expect(adapterSource).toContain('from "@avably/ui"');
    expect(adapterSource).toContain("SelectTrigger");
    expect(adapterSource).toContain("SelectContent");
    expect(adapterSource).toContain("SelectItem");
  });

  it("jedyny natywny <select> w renderze to most: schowany przed okiem, czytnikiem i tabulatorem", () => {
    expect(PanelSelect).toBeTypeOf("function");
    if (!PanelSelect) return;

    const { form } = bezJs(
      <form>
        <PanelSelect id="invite-role" name="role" defaultValue="staff" options={ENVIRONMENT_OPTIONS} />
      </form>,
    );

    // Kontrola pozytywna: widoczna kontrolka JEST prymitywem systemu.
    expect(form.querySelector('[data-slot="select-trigger"]')).not.toBeNull();

    const selects = [...form.querySelectorAll("select")];
    expect(selects.length, "w renderze nie ma ŻADNEGO <select>").toBeGreaterThan(0);
    for (const select of selects) {
      const opis = select.outerHTML.slice(0, 120);
      expect(select.getAttribute("aria-hidden"), `<select> w drzewie dostępności: ${opis}`).toBe(
        "true",
      );
      expect(select.getAttribute("tabindex"), `<select> w kolejności tabulacji: ${opis}`).toBe("-1");
    }
  });
});

describe("kontrakt panelowego Selecta — co jedzie do FormData (ADR-148)", () => {
  it("most niesie wybraną wartość JUŻ W SSR i formularz bez JS przechodzi PRAWDZIWĄ walidację", () => {
    expect(PanelSelect).toBeTypeOf("function");
    if (!PanelSelect) return;

    const { form, data } = bezJs(
      <form>
        <input name="email" defaultValue="kurier@example.invalid" />
        <input name="password" type="password" defaultValue="haslo-kuriera" />
        <PanelSelect
          id="cred-environment"
          name="environment"
          defaultValue="test"
          options={ENVIRONMENT_OPTIONS}
        />
      </form>,
    );

    // Kontrola pozytywna PRZED asercją o treści: most jest na ekranie i zna
    // OBIE opcje. Bez tego „niesie test" mogłoby być prawdą o pustym zbiorze.
    expect(opcjeMostu(form, "environment")).toEqual(["test", "production"]);

    expect(data.get("environment"), "most wysłał pustkę przed hydracją").toBe("test");

    const wynik = deliverySettingsCredentialsSchema.safeParse({
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
      environment: String(data.get("environment") ?? ""),
    });
    expect(
      wynik.success,
      `walidacja odbiła formularz bez JS: ${JSON.stringify(wynik.error?.issues ?? [])}`,
    ).toBe(true);
  });

  it("druga strona: bez dokonanego wyboru most nie podstawia pierwszej opcji, a walidacja odrzuca", () => {
    expect(PanelSelect).toBeTypeOf("function");
    if (!PanelSelect) return;

    const { form, data } = bezJs(
      <form>
        <PanelSelect
          id="cred-environment"
          name="environment"
          placeholder="Wybierz środowisko"
          options={ENVIRONMENT_OPTIONS}
        />
      </form>,
    );

    // Kotwica pustego wyboru MUSI istnieć: `<select>` bez zaznaczonej opcji
    // wysyła pierwszą z listy, czyli odpowiedź, której nikt nie udzielił.
    expect(opcjeMostu(form, "environment")).toEqual(["", "test", "production"]);
    expect(data.get("environment"), "most zgadł wybór za operatora").toBe("");

    const wynik = deliverySettingsCredentialsSchema.safeParse({
      email: "kurier@example.invalid",
      password: "haslo-kuriera",
      environment: String(data.get("environment") ?? ""),
    });
    expect(wynik.success, "walidacja przyjęła brak wyboru").toBe(false);
  });

  it("opcja pusta jedzie pustym stringiem, a sentinel widżetu nie wychodzi na zewnątrz", () => {
    expect(PanelSelect).toBeTypeOf("function");
    if (!PanelSelect) return;

    const { html, form, data } = bezJs(
      <form>
        <PanelSelect
          id="filter-klient"
          name="klient"
          defaultValue=""
          options={[
            { value: "", label: "Wszyscy" },
            { value: "customer-a", label: "Anna" },
          ]}
        />
      </form>,
    );

    expect(form.querySelector('[data-slot="select-trigger"]')).not.toBeNull();
    expect(opcjeMostu(form, "klient")).toEqual(["", "customer-a"]);
    expect(data.has("klient"), "pole filtra w ogóle nie poszło").toBe(true);
    expect(data.get("klient")).toBe("");
    expect(html).not.toContain("__panel_empty__");
  });

  it("na jedną nazwę przypada JEDNO pole formularza — most jest jeden", () => {
    expect(PanelSelect).toBeTypeOf("function");
    if (!PanelSelect) return;

    const { form, data } = bezJs(
      <form>
        <PanelSelect id="invite-role" name="role" defaultValue="staff" options={[
          { value: "staff", label: "staff" },
          { value: "owner", label: "owner" },
        ]} />
      </form>,
    );

    expect(form.querySelectorAll('[name="role"]').length, "dwa transporty tej samej nazwy").toBe(1);
    expect(form.querySelector('input[name="role"]')).toBeNull();
    expect(data.getAll("role")).toEqual(["staff"]);
  });

  it("bez `name` widżet nie dokłada do formularza niczego (autozapis kreatora)", () => {
    expect(PanelSelect).toBeTypeOf("function");
    if (!PanelSelect) return;

    const { form, data } = bezJs(
      <form>
        <PanelSelect id="layout" defaultValue="test" options={ENVIRONMENT_OPTIONS} />
      </form>,
    );

    expect(form.querySelector('[data-slot="select-trigger"]')).not.toBeNull();
    expect([...data.keys()], "widżet bez nazwy wsadził pole do formularza").toEqual([]);
  });

  it("pole wyłączone milczy — jak natywny <select disabled>", () => {
    expect(PanelSelect).toBeTypeOf("function");
    if (!PanelSelect) return;

    const { data } = bezJs(
      <form>
        <PanelSelect id="entity" name="entity" defaultValue="product" disabled options={[
          { value: "product", label: "Produkt" },
          { value: "order", label: "Zamówienie" },
        ]} />
      </form>,
    );

    // Ekrany, które chcą wysłać wartość pola zablokowanego, robią to jawnym
    // `<input type="hidden">` obok (pola własne) — most nie robi tego za nie.
    expect(data.has("entity")).toBe(false);
  });
});

describe("SONDA BEZPIECZEŃSTWA: most nie niesie nic ponad listę opcji", () => {
  it("wartość spoza listy nie przechodzi przez most", () => {
    expect(PanelSelect).toBeTypeOf("function");
    if (!PanelSelect) return;

    const PRZEMYT = "widmo-spoza-listy";
    const { html, form, data } = bezJs(
      <form>
        <PanelSelect
          id="cred-environment"
          name="environment"
          defaultValue={PRZEMYT}
          options={ENVIRONMENT_OPTIONS}
        />
      </form>,
    );

    // Kontrola pozytywna: most jest i ma opcje — inaczej „nie ma przemytu"
    // byłoby prawdą o pustym zbiorze.
    const niesione = opcjeMostu(form, "environment");
    expect(niesione.length).toBeGreaterThan(1);
    for (const wartosc of niesione) {
      expect(["", "test", "production"], `most wystawia opcję spoza listy: ${wartosc}`).toContain(
        wartosc,
      );
    }

    expect(data.get("environment"), "most podał serwerowi wartość spoza listy").toBe("");
    for (const [klucz, wartosc] of data.entries()) {
      expect(String(wartosc), `przemyt w polu ${klucz}`).not.toContain(PRZEMYT);
    }
    expect(html, "wartość spoza listy w źródle strony").not.toContain(PRZEMYT);
  });
});
