// @vitest-environment jsdom

/**
 * DOJAZD STRUKTURALNY — MAPA ZA KLIKNIĘCIEM (E5, ADR-096).
 *
 * Pięć rzeczy, które psują się CICHO, więc mają tu własne zdania:
 *
 *   1. ZERO ŻĄDAŃ PRZED KLIKNIĘCIEM. To jest cała decyzja tej sekcji, a jej
 *      złamanie nie daje żadnego objawu: strona wygląda tak samo, tylko każdy
 *      odwiedzający zostaje po drodze zgłoszony obcemu serwisowi. Sprawdzamy
 *      więc BRAK ramki i brak `preconnect`/`dns-prefetch`/`prefetch` do
 *      dostawcy w całym drzewie — nie sam brak ramki, bo do żądania sieciowego
 *      prowadzi więcej niż jedna droga.
 *   2. KLIKNIĘCIE MONTUJE RAMKĘ O WŁAŚCIWYM ADRESIE. Ramka z adresem innego
 *      punktu wygląda jak działająca mapa.
 *   3. PRZEŁĄCZNIK PODMIENIA `src` BEZ DRUGIEGO KLIKNIĘCIA. Fikstura ma DWA
 *      punkty o RÓŻNYCH adresach — przy jednym punkcie (albo dwóch takich
 *      samych) test przechodziłby także dla implementacji, która przełącznika
 *      nie obsługuje wcale (lekcja E3).
 *   4. „PROWADŹ" JEST ODNOŚNIKIEM WYCHODZĄCYM. Bez `rel` obcy serwis dostaje
 *      uchwyt do karty klienta — a link wygląda identycznie.
 *   5. BEZ ZGODY NA OSADZENIE (płótno kreatora) RAMKA NIE POWSTAJE. Panel nie
 *      ma tego źródła w polityce CSP, więc zamiast pustej ramki ma stać zdanie.
 *
 * Elementy znajdujemy po ROLI i DOSTĘPNEJ NAZWIE — tak jak czytnik ekranu,
 * i dokładnie dlatego, że `data-*` przechodzi także wtedy, gdy jedyna droga do
 * kontrolki jest dla człowieka niewidoczna.
 */
import {
  MAP_PROVIDER_ORIGIN,
  structuredPresetFor,
  withStructuredLayout,
  type DirectionsStructuredContent,
} from "@avably/core/site";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SITE_LABELS, SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

const L = DEFAULT_SITE_LABELS;

afterEach(cleanup);

const MAGAZYN = "ul. Polna 12, 30-001 Kraków";
const PUNKT = "al. Wiosenna 3, 31-002 Kraków";

/**
 * TREŚĆ OPERATORA, NIE PRESETOWA — z DWOMA punktami o RÓŻNYCH adresach.
 * Fikstura ma odróżniać implementacje: przy jednym punkcie każdy test
 * przełącznika byłby zielony także bez przełącznika.
 */
function dojazd(patch: Partial<DirectionsStructuredContent> = {}): DirectionsStructuredContent {
  const preset = structuredPresetFor("directions", "pl") as DirectionsStructuredContent;
  return {
    ...preset,
    items: [
      { label: "Magazyn", address: MAGAZYN, hours: "pon.–pt. 8–17" },
      { label: "Punkt odbioru", address: PUNKT },
    ],
    ...patch,
  } as DirectionsStructuredContent;
}

function pokaz(content: DirectionsStructuredContent, options: { mapEmbed?: boolean } = {}) {
  const { mapEmbed = true } = options;
  const sections = [
    { id: "sek-dojazd", position: 0, type: "directions", content },
  ] as unknown as RenderSection[];
  return render(<SiteRenderer sections={sections} mapEmbed={mapEmbed} />);
}

/** Ramka mapy albo `null` — szukamy po TYTULE, czyli po dostępnej nazwie. */
function ramka(): HTMLIFrameElement | null {
  return document.querySelector("iframe");
}

describe("PRZED kliknięciem nie ma ANI JEDNEJ drogi do dostawcy map", () => {
  it("zero ramek i zero wstępnych połączeń w drzewie", () => {
    const { container } = pokaz(dojazd());

    expect(container.querySelectorAll("iframe"), "ramka mapy stoi przed kliknięciem").toHaveLength(
      0,
    );
    // `preconnect`/`dns-prefetch` też jest żądaniem do obcego serwisu — i też
    // wykonanym, zanim ktokolwiek o mapę poprosił.
    for (const link of container.querySelectorAll("link")) {
      expect(link.getAttribute("href") ?? "", `<link rel="${link.rel}"> do dostawcy map`).not.toContain(
        "google",
      );
    }
    // Adres dostawcy MOŻE stać w drzewie wyłącznie jako odnośnik „Prowadź",
    // który niczego nie ładuje sam z siebie.
    const zDostawca = [...container.querySelectorAll("[src], [href]")].filter((node) =>
      (node.getAttribute("src") ?? node.getAttribute("href") ?? "").includes(MAP_PROVIDER_ORIGIN),
    );
    for (const node of zDostawca) {
      expect(node.tagName, "coś innego niż odnośnik wskazuje na dostawcę map").toBe("A");
    }
  });

  it("adresy i godziny są w drzewie od razu — bez JS-a i bez mapy", () => {
    pokaz(dojazd());

    expect(screen.getByText(MAGAZYN)).toBeInTheDocument();
    expect(screen.getByText(PUNKT)).toBeInTheDocument();
    expect(screen.getByText("pon.–pt. 8–17")).toBeInTheDocument();
  });
});

describe("kliknięcie „Pokaż mapę” montuje ramkę WYBRANEGO punktu", () => {
  it("ramka ma adres pierwszego punktu, tytuł z jego nazwą i leniwe ładowanie", async () => {
    const user = userEvent.setup();
    pokaz(dojazd());

    await user.click(screen.getByRole("button", { name: L.directionsShowMap }));

    const frame = ramka();
    expect(frame, "kliknięcie nie zamontowało ramki").not.toBeNull();
    expect(frame!.getAttribute("src")).toBe(
      `${MAP_PROVIDER_ORIGIN}/maps?q=${encodeURIComponent(MAGAZYN)}&output=embed`,
    );
    // Tytuł jest JEDYNYM, co czytnik ekranu mówi o ramce (WCAG 4.1.2).
    expect(frame!.getAttribute("title")).toBe(
      L.directionsMapTitle.replace("{location}", "Magazyn"),
    );
    expect(frame!.getAttribute("loading")).toBe("lazy");
  });

  it("przycisk znika po kliknięciu — mapa zajmuje jego miejsce", async () => {
    const user = userEvent.setup();
    pokaz(dojazd());

    await user.click(screen.getByRole("button", { name: L.directionsShowMap }));

    expect(screen.queryByRole("button", { name: L.directionsShowMap })).toBeNull();
  });
});

describe("przełącznik punktów podmienia mapę, a nie montuje drugiej", () => {
  it("wybór drugiego punktu PO otwarciu mapy zmienia `src` bez kolejnego kliknięcia", async () => {
    const user = userEvent.setup();
    pokaz(dojazd());

    await user.click(screen.getByRole("button", { name: L.directionsShowMap }));
    expect(ramka()!.getAttribute("src")).toContain(encodeURIComponent(MAGAZYN));

    await user.click(screen.getByRole("radio", { name: "Punkt odbioru" }));

    // Asercja na ZAKODOWANY adres WYBRANEGO punktu: implementacja, która
    // ignoruje wybór, zostawiłaby tu adres pierwszego.
    expect(document.querySelectorAll("iframe"), "powstała druga ramka").toHaveLength(1);
    expect(ramka()!.getAttribute("src")).toBe(
      `${MAP_PROVIDER_ORIGIN}/maps?q=${encodeURIComponent(PUNKT)}&output=embed`,
    );
    expect(ramka()!.getAttribute("title")).toBe(
      L.directionsMapTitle.replace("{location}", "Punkt odbioru"),
    );
    // Zgoda została wyrażona raz — drugi przycisk byłby pytaniem o nią ponownie.
    expect(screen.queryByRole("button", { name: L.directionsShowMap })).toBeNull();
  });

  it("wybór PRZED otwarciem mapy decyduje, którą mapę zobaczy odwiedzający", async () => {
    const user = userEvent.setup();
    pokaz(dojazd());

    await user.click(screen.getByRole("radio", { name: "Punkt odbioru" }));
    expect(ramka(), "wybór punktu sam z siebie zamontował ramkę").toBeNull();

    await user.click(screen.getByRole("button", { name: L.directionsShowMap }));
    expect(ramka()!.getAttribute("src")).toContain(encodeURIComponent(PUNKT));
  });

  it("JEDEN punkt nie dostaje przełącznika — nie ma między czym wybierać", () => {
    pokaz(dojazd({ items: [{ label: "Magazyn", address: MAGAZYN }] }));

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("button", { name: L.directionsShowMap })).toBeInTheDocument();
  });

  it("punkt BEZ nazwy woła się adresem — chip bez etykiety byłby nie do kliknięcia świadomie", async () => {
    const user = userEvent.setup();
    pokaz(dojazd({ items: [{ address: MAGAZYN }, { address: PUNKT }] }));

    await user.click(screen.getByRole("radio", { name: PUNKT }));
    await user.click(screen.getByRole("button", { name: L.directionsShowMap }));

    expect(ramka()!.getAttribute("title")).toBe(
      L.directionsMapTitle.replace("{location}", PUNKT),
    );
  });
});

describe("„Prowadź” prowadzi do nawigacji i nie oddaje uchwytu do karty", () => {
  it("każdy punkt ma własny odnośnik z ZAKODOWANYM adresem, `rel` i nową kartą", () => {
    pokaz(dojazd());

    const linki = screen.getAllByRole("link", { name: L.directionsRoute });
    expect(linki).toHaveLength(2);
    expect(linki[0]).toHaveAttribute(
      "href",
      `${MAP_PROVIDER_ORIGIN}/maps/dir/?api=1&destination=${encodeURIComponent(MAGAZYN)}`,
    );
    expect(linki[1]!.getAttribute("href")).toContain(encodeURIComponent(PUNKT));
    for (const link of linki) {
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAttribute("target", "_blank");
    }
  });
});

describe("bez zgody na osadzenie (płótno kreatora) ramka NIE powstaje", () => {
  it("kliknięcie pokazuje zdanie zamiast ramki uciętej przez politykę panelu", async () => {
    const user = userEvent.setup();
    pokaz(dojazd(), { mapEmbed: false });

    await user.click(screen.getByRole("button", { name: L.directionsShowMap }));

    expect(ramka(), "panel osadził ramkę, której jego CSP nie wpuszcza").toBeNull();
    expect(screen.getByText(L.directionsMapPreview)).toBeInTheDocument();
  });

  it("mechanika stoi tak samo — operator widzi, co dostanie klient", () => {
    pokaz(dojazd(), { mapEmbed: false });

    expect(screen.getByRole("button", { name: L.directionsShowMap })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: L.directionsRoute })).toHaveLength(2);
  });
});

describe("OBA układy niosą tę samą mechanikę", () => {
  it.each(["stacked", "split"] as const)("%s: adresy, przełącznik i mapa za kliknięciem", async (layout) => {
    const user = userEvent.setup();
    pokaz(withStructuredLayout(dojazd(), layout));

    expect(
      document.querySelector(`[data-structured-layout="${layout}"]`),
      "sekcja nie zamontowała się w tym układzie",
    ).not.toBeNull();
    expect(ramka()).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Punkt odbioru" }));
    await user.click(screen.getByRole("button", { name: L.directionsShowMap }));

    expect(ramka()!.getAttribute("src")).toContain(encodeURIComponent(PUNKT));
  });
});
