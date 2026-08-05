// @vitest-environment jsdom

/**
 * KONTAKT STRUKTURALNY — DANE KLIKALNE I FORMULARZ (E4, ADR-095).
 *
 * Cztery rzeczy, które psują się cicho, więc mają tu własne zdania:
 *
 *   1. KLIKALNOŚĆ. `mailto:` i `tel:` to jedyne, co robi ta sekcja bez JS-a.
 *      Link, który stracił schemat, wygląda identycznie jak sprawny — dopóki
 *      ktoś w niego nie kliknie na telefonie.
 *   2. WYWOŁANIE AKCJI, NIE DOM. Formularz „wysłał", jeżeli AKCJA została
 *      wywołana z właściwym ładunkiem. Sprawdzanie, czy zniknął napis, mierzy
 *      widok, a nie wysyłkę (lekcja E2/E3 — mierzymy wywołanie modułu).
 *   3. PODGLĄD TO TEN SAM FORMULARZ. Płótno kreatora nie dostaje wiązania,
 *      więc drzewo musi być IDENTYCZNE i tylko wyjęte z interakcji. Gdyby
 *      podgląd był osobnym komponentem, rozjechałby się z tym, co widzi klient.
 *   4. BRAK ADRESATA = BRAK FORMULARZA. To jest stan, nie awaria: sekcja
 *      pokazuje wtedy same dane kontaktowe i nic nie obiecuje.
 *
 * Kontrolki znajdujemy po ROLI i DOSTĘPNEJ NAZWIE — dokładnie tak, jak robi to
 * czytnik ekranu, i dokładnie dlatego, że `data-*` przechodzi także wtedy, gdy
 * jedyna droga do pola jest dla człowieka niewidoczna.
 */
import {
  structuredPresetFor,
  withStructuredLayout,
  type ContactStructuredContent,
  type ContactSubmitInput,
  type ContactSubmitResult,
} from "@avably/core/site";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SITE_LABELS, SiteRenderer } from "./site-renderer";
import type { ContactFormBinding, RenderSection } from "./types";

const L = DEFAULT_SITE_LABELS;
const F = L.contactForm;
const BILET = "1754300000.podpis-testowy";

afterEach(cleanup);

/**
 * TREŚĆ OPERATORA, NIE PRESETOWA. Preset ma adres w domenie zarezerwowanej
 * i komplet czterech rodzajów — realna sekcja bywa inna, a fikstura ma
 * ODRÓŻNIAĆ implementacje, nie potwierdzać, że preset jest presetem.
 */
function kontakt(patch: Partial<ContactStructuredContent> = {}): ContactStructuredContent {
  const preset = structuredPresetFor("contact", "pl") as ContactStructuredContent;
  return {
    ...preset,
    items: [
      { kind: "email", value: "biuro@wypozyczalnia.test" },
      { kind: "phone", value: "+48 512 345 678" },
      { kind: "address", value: "ul. Polna 12\n30-001 Kraków" },
      { kind: "hours", value: "pon.–pt. 9–17" },
      { kind: "map", value: "Polna 12, Kraków" },
    ],
    ...patch,
  } as ContactStructuredContent;
}

function pokaz(content: ContactStructuredContent, binding?: ContactFormBinding) {
  const sections = [
    { id: "sek-kontakt", position: 0, type: "contact", content },
  ] as unknown as RenderSection[];
  return render(
    <SiteRenderer sections={sections} {...(binding ? { contactForm: binding } : {})} />,
  );
}

/** Wiązanie z ATRAPĄ AKCJI — mierzymy jej wywołania, nie skutki uboczne DOM-u. */
function wiazanie(result: ContactSubmitResult = { status: "sent" }) {
  const submit = vi.fn(async (_input: ContactSubmitInput) => result);
  const binding: ContactFormBinding = { ticket: BILET, submit };
  return { binding, submit };
}

/** Wypełnienie formularza po dostępnych nazwach pól. */
async function wypelnij(
  user: ReturnType<typeof userEvent.setup>,
  values: { name?: string; email?: string; phone?: string; message?: string } = {},
) {
  const {
    name = "Anna Kowalska",
    email = "anna@przyklad.test",
    message = "Dzień dobry, czy namiot 5x8 jest wolny w czerwcu?",
  } = values;
  await user.type(screen.getByRole("textbox", { name: F.name }), name);
  await user.type(screen.getByRole("textbox", { name: F.email }), email);
  if (values.phone !== undefined) {
    await user.type(screen.getByRole("textbox", { name: F.phone }), values.phone);
  }
  await user.type(screen.getByRole("textbox", { name: F.message }), message);
}

describe("dane kontaktowe są KLIKALNE", () => {
  it("e-mail prowadzi w mailto, telefon w tel (bez spacji), mapa w wyszukiwanie", () => {
    pokaz(kontakt());

    expect(screen.getByRole("link", { name: "biuro@wypozyczalnia.test" })).toHaveAttribute(
      "href",
      "mailto:biuro@wypozyczalnia.test",
    );
    // Spacje w numerze są dla CZŁOWIEKA; `tel:` ich nie przyjmuje.
    expect(screen.getByRole("link", { name: "+48 512 345 678" })).toHaveAttribute(
      "href",
      "tel:+48512345678",
    );
    const mapa = screen.getByRole("link", { name: "Polna 12, Kraków" });
    expect(mapa.getAttribute("href")).toContain(encodeURIComponent("Polna 12, Kraków"));
    // Odnośnik wychodzący — bez `noopener` obcy serwis dostaje uchwyt do karty.
    expect(mapa.getAttribute("rel")).toContain("noopener");
  });

  it("adres i godziny NIE są odnośnikami (nie ma dokąd nimi przejść)", () => {
    pokaz(kontakt());
    expect(screen.queryByRole("link", { name: /Polna 12\s+30-001/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "pon.–pt. 9–17" })).toBeNull();
    expect(screen.getByText("pon.–pt. 9–17")).toBeInTheDocument();
  });

  it("etykieta rodzaju wpisu idzie z JĘZYKA STRONY, nie z treści najemcy", () => {
    pokaz(kontakt());
    for (const label of [L.contactEmail, L.contactPhone, L.contactAddress, L.contactHours]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("formularz pojawia się pod DWOMA warunkami", () => {
  it("jest, gdy sekcja ma adresata i włączony przełącznik", () => {
    pokaz(kontakt(), wiazanie().binding);
    expect(screen.getByRole("button", { name: F.submit })).toBeInTheDocument();
  });

  it("BRAK ADRESU E-MAIL = brak formularza, ale dane kontaktowe zostają", () => {
    pokaz(
      kontakt({ items: [{ kind: "phone", value: "+48 512 345 678" }] } as Partial<ContactStructuredContent>),
      wiazanie().binding,
    );
    expect(screen.queryByRole("button", { name: F.submit })).toBeNull();
    expect(screen.getByRole("link", { name: "+48 512 345 678" })).toBeInTheDocument();
  });

  it("adres e-mail NIEPOPRAWNY nie jest adresatem — formularz nie wysyłałby donikąd", () => {
    pokaz(
      kontakt({
        items: [{ kind: "email", value: "biuro(at)wypozyczalnia.test" }],
      } as Partial<ContactStructuredContent>),
      wiazanie().binding,
    );
    expect(screen.queryByRole("button", { name: F.submit })).toBeNull();
  });

  it("wyłączony przełącznik zdejmuje formularz mimo poprawnego adresata", () => {
    pokaz(kontakt({ showForm: false }), wiazanie().binding);
    expect(screen.queryByRole("button", { name: F.submit })).toBeNull();
    expect(screen.getByRole("link", { name: "biuro@wypozyczalnia.test" })).toBeInTheDocument();
  });
});

describe("wysłanie mierzone WYWOŁANIEM akcji", () => {
  it("poprawne wejście woła akcję RAZ, z biletem, sekcją i pustą pułapką", async () => {
    const user = userEvent.setup();
    const { binding, submit } = wiazanie();
    pokaz(kontakt(), binding);

    await wypelnij(user);
    await user.click(screen.getByRole("button", { name: F.submit }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith({
      name: "Anna Kowalska",
      email: "anna@przyklad.test",
      message: "Dzień dobry, czy namiot 5x8 jest wolny w czerwcu?",
      sectionId: "sek-kontakt",
      ticket: BILET,
      trap: "",
    });
  });

  it("sukces zamienia formularz na komunikat W MOTYWIE, bez przeładowania", async () => {
    const user = userEvent.setup();
    const { binding } = wiazanie({ status: "sent" });
    pokaz(kontakt(), binding);

    await wypelnij(user);
    await user.click(screen.getByRole("button", { name: F.submit }));

    const potwierdzenie = await screen.findByRole("status");
    expect(potwierdzenie).toHaveTextContent(F.success);
    // Komunikat maluje ROLAMI motywu (karta + atrament), a nie własnym kolorem.
    expect(potwierdzenie.className).toContain("site-card");
    expect(screen.queryByRole("button", { name: F.submit })).toBeNull();
  });

  it("PUSTE POLA nie wołają akcji — komunikat siada przy polu i opisuje je", async () => {
    const user = userEvent.setup();
    const { binding, submit } = wiazanie();
    pokaz(kontakt(), binding);

    await user.click(screen.getByRole("button", { name: F.submit }));

    expect(submit).not.toHaveBeenCalled();
    const pole = screen.getByRole("textbox", { name: F.name });
    expect(pole).toHaveAttribute("aria-invalid", "true");
    // Komunikat MUSI być powiązany z polem — inaczej czytnik ekranu go nie poda.
    const opis = pole.getAttribute("aria-describedby");
    expect(opis).toBeTruthy();
    expect(document.getElementById(opis!)).toHaveTextContent(F.errors.required);
  });

  it("NIEPOPRAWNY adres e-mail zatrzymuje wysyłkę tą samą regułą, co serwer", async () => {
    const user = userEvent.setup();
    const { binding, submit } = wiazanie();
    pokaz(kontakt(), binding);

    await wypelnij(user, { email: "anna-bez-malpy" });
    await user.click(screen.getByRole("button", { name: F.submit }));

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: F.email })).toHaveAttribute("aria-invalid", "true");
  });

  it("PUŁAPKA jedzie na serwer nietknięta — klient jej NIE ocenia", async () => {
    const user = userEvent.setup();
    const { binding, submit } = wiazanie();
    pokaz(kontakt(), binding);

    // Bot wypełnia wszystko, co widzi w drzewie — łącznie z polem poza ekranem.
    const trap = document.querySelector<HTMLInputElement>('input[name="trap"]')!;
    await user.type(screen.getByRole("textbox", { name: F.name }), "Bot");
    await user.type(screen.getByRole("textbox", { name: F.email }), "bot@przyklad.test");
    await user.type(screen.getByRole("textbox", { name: F.message }), "Kup teraz tanie linki SEO.");
    trap.value = "https://spam.przyklad.test";
    await user.click(screen.getByRole("button", { name: F.submit }));

    // Gdyby przeglądarka odmawiała wysyłki, bot poznałby regułę po pierwszym
    // odbiciu. Rozstrzyga serwer — a odpowiedź jest nieodróżnialna od sukcesu.
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0]).toMatchObject({ trap: "https://spam.przyklad.test" });
  });

  it("pułapka jest poza ekranem i poza klawiaturą (człowiek jej nie wypełni)", () => {
    pokaz(kontakt(), wiazanie().binding);
    const trap = document.querySelector<HTMLInputElement>('input[name="trap"]')!;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
    expect(trap.getAttribute("autocomplete")).toBe("off");
  });
});

describe("odmowy serwera mówią po ludzku (i w motywie)", () => {
  const przypadki = [
    ["rate_limited", F.errors.rateLimited],
    ["captcha_failed", F.errors.captcha],
    ["expired", F.errors.expired],
    ["unavailable", F.errors.unavailable],
    ["server_error", F.errors.server],
  ] as const;

  it.each(przypadki)("status %s pokazuje własny komunikat", async (status, oczekiwany) => {
    const user = userEvent.setup();
    const { binding } = wiazanie({ status } as ContactSubmitResult);
    pokaz(kontakt(), binding);

    await wypelnij(user);
    await user.click(screen.getByRole("button", { name: F.submit }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(oczekiwany);
    // Sygnał błędu bierze rolę motywu, nie własny odcień czerwieni.
    expect(alert.className).toContain("site-error");
    // Formularz ZOSTAJE — odmowa nie może skasować napisanej wiadomości.
    expect(screen.getByRole("button", { name: F.submit })).toBeInTheDocument();
  });

  it("błędy pól z SERWERA siadają przy polach (klient przepuścił, serwer nie)", async () => {
    const user = userEvent.setup();
    const { binding } = wiazanie({
      status: "validation_error",
      fields: { message: "too_long" },
    });
    pokaz(kontakt(), binding);

    await wypelnij(user);
    await user.click(screen.getByRole("button", { name: F.submit }));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: F.message })).toHaveAttribute("aria-invalid", "true"),
    );
    expect(screen.getByText(F.errors.tooLong)).toBeInTheDocument();
  });

  it("wyjątek akcji (zerwane połączenie) to uczciwy błąd, nie cichy sukces", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async (_input: ContactSubmitInput) => {
      throw new Error("network");
    });
    pokaz(kontakt(), { ticket: BILET, submit } as unknown as ContactFormBinding);

    await wypelnij(user);
    await user.click(screen.getByRole("button", { name: F.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(F.errors.server);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("telefon pytany tylko wtedy, gdy operator o niego prosi", () => {
  it("wyłączony: pola nie ma, a wysyłka nie niesie telefonu", async () => {
    const user = userEvent.setup();
    const { binding, submit } = wiazanie();
    pokaz(kontakt({ askPhone: false }), binding);

    expect(screen.queryByRole("textbox", { name: F.phone })).toBeNull();
    await wypelnij(user);
    await user.click(screen.getByRole("button", { name: F.submit }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0]).not.toHaveProperty("phone");
  });

  it("włączony: pole jest WYMAGANE, a nie dodatkowe", async () => {
    const user = userEvent.setup();
    const { binding, submit } = wiazanie();
    pokaz(kontakt({ askPhone: true }), binding);

    await wypelnij(user);
    await user.click(screen.getByRole("button", { name: F.submit }));
    expect(submit, "puste pole telefonu przeszło mimo włączonego pytania").not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: F.phone }), "512 345 678");
    await user.click(screen.getByRole("button", { name: F.submit }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0]).toMatchObject({ phone: "512 345 678" });
  });
});

describe("notka RODO", () => {
  it("stoi pod formularzem ZAWSZE, a odnośnik dokłada się z treści sekcji", () => {
    const { unmount } = pokaz(kontakt(), wiazanie().binding);
    expect(screen.getByText(F.privacyNote)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: F.privacyLink })).toBeNull();
    unmount();

    pokaz(kontakt({ privacyHref: "/polityka-prywatnosci" }), wiazanie().binding);
    expect(screen.getByRole("link", { name: F.privacyLink })).toHaveAttribute(
      "href",
      "/polityka-prywatnosci",
    );
  });

  it("nie ma żadnego pola zgody — decyzja z planu Sekcje 2.0", () => {
    pokaz(kontakt(), wiazanie().binding);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});

describe("płótno kreatora dostaje TEN SAM formularz w podglądzie", () => {
  it("bez wiązania formularz jest inertny, ale kompletny", () => {
    pokaz(kontakt());
    const form = document.querySelector<HTMLFormElement>("[data-contact-form]")!;
    expect(form.dataset.contactForm).toBe("preview");
    expect(form.hasAttribute("inert"), "podgląd przyjmuje kliknięcia klienta").toBe(true);
    // Kompletny: te same pola i ten sam przycisk, co w sklepie.
    for (const label of [F.name, F.email, F.message]) {
      expect(screen.getByRole("textbox", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: F.submit })).toBeInTheDocument();
  });

  it("sklep dostaje ten sam formularz w trybie żywym", () => {
    pokaz(kontakt(), wiazanie().binding);
    const form = document.querySelector<HTMLFormElement>("[data-contact-form]")!;
    expect(form.dataset.contactForm).toBe("live");
    expect(form.hasAttribute("inert")).toBe(false);
  });

  it("CAPTCHA wchodzi WIĄZANIEM — pakiet UI nie zna dostawcy", () => {
    const { binding } = wiazanie();
    pokaz(kontakt(), { ...binding, captcha: <div data-atrapa-captcha /> });
    expect(document.querySelector("[data-atrapa-captcha]")).not.toBeNull();
  });
});

describe("przełącznik układu nie rusza treści (kontrakt bezstratności)", () => {
  it("oba układy pokazują te same dane i ten sam formularz", async () => {
    const content = kontakt();
    const { unmount } = pokaz(content, wiazanie().binding);
    const stacked = document.querySelector("[data-structured-section='contact']")!;
    expect(stacked.getAttribute("data-structured-layout")).toBe("stacked");
    const daneStacked = screen.getAllByRole("link").map((node) => node.getAttribute("href"));
    unmount();

    const przelaczony = withStructuredLayout(content, "split");
    pokaz(przelaczony, wiazanie().binding);
    const split = document.querySelector("[data-structured-section='contact']")!;
    expect(split.getAttribute("data-structured-layout")).toBe("split");
    expect(screen.getAllByRole("link").map((node) => node.getAttribute("href"))).toEqual(daneStacked);
    expect(screen.getByRole("button", { name: F.submit })).toBeInTheDocument();
    // Treść co do klucza ta sama — zmienił się JEDEN napis.
    expect({ ...przelaczony, layout: "stacked" }).toEqual(content);
  });
});
