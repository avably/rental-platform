import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import type { RenderSection, StorefrontProduct } from "./types";

function hero(): RenderSection {
  return {
    id: "s-hero",
    position: 0,
    type: "hero",
    content: { heading: "Wynajmij sprzęt", subheading: "Szybko i lokalnie", ctaText: "Zobacz", ctaHref: "#produkty" },
  };
}

const products: StorefrontProduct[] = [
  { id: "p1", name: "Wiertarka", description: "Mocna", priceLabel: "od 40,00 zł / doba", imageUrl: null, imageAlt: "Wiertarka" },
  { id: "p2", name: "Betoniarka", description: null, priceLabel: "od 120,00 zł / doba", imageUrl: null, imageAlt: "Betoniarka" },
];

describe("SiteRenderer — render per typ sekcji", () => {
  it("renderuje hero z nagłówkiem i CTA (ctaText/ctaHref)", () => {
    render(<SiteRenderer sections={[hero()]} template="classic" />);
    expect(screen.getByRole("heading", { level: 1, name: "Wynajmij sprzęt" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz" })).toHaveAttribute("href", "#produkty");
  });

  it("sekcja products pokazuje przekazany katalog", () => {
    const section: RenderSection = { id: "s-prod", position: 1, type: "products", content: { heading: "Nasz sprzęt" } };
    render(<SiteRenderer sections={[section]} template="classic" products={products} />);
    expect(screen.getByText("Wiertarka")).toBeInTheDocument();
    expect(screen.getByText("Betoniarka")).toBeInTheDocument();
  });

  it("karta z href jest linkiem do podstrony; bez href zostaje statyczna", () => {
    const section: RenderSection = { id: "s-prod", position: 1, type: "products", content: { heading: "Nasz sprzęt" } };
    const linked: StorefrontProduct[] = [
      { id: "p1", name: "Wiertarka", description: null, priceLabel: "od 40,00 zł / doba", imageUrl: null, imageAlt: "Wiertarka", href: "/product/p1" },
    ];
    const { rerender } = render(<SiteRenderer sections={[section]} template="classic" products={linked} />);
    expect(screen.getByRole("link", { name: /Wiertarka/ })).toHaveAttribute("href", "/product/p1");
    // Podgląd panelu (bez href) nie robi z karty linku.
    rerender(<SiteRenderer sections={[section]} template="classic" products={products} />);
    expect(screen.queryByRole("link", { name: /Wiertarka/ })).toBeNull();
  });

  it("sekcja products bez katalogu pokazuje etykietę pustego stanu", () => {
    const section: RenderSection = { id: "s-prod", position: 1, type: "products", content: { heading: "Nasz sprzęt" } };
    render(
      <SiteRenderer
        sections={[section]}
        template="classic"
        products={[]}
        labels={{ productsEmpty: "Brak produktów", contactEmail: "E:", contactPhone: "T:", contactAddress: "A:", contactMap: "Mapa" }}
      />,
    );
    expect(screen.getByText("Brak produktów")).toBeInTheDocument();
  });

  it("faq renderuje pozycje {q,a} jako details/summary (bez JS)", () => {
    const section: RenderSection = {
      id: "s-faq",
      position: 0,
      type: "faq",
      content: { heading: "Pytania", items: [{ q: "Jak zwrócić?", a: "Osobiście." }] },
    };
    const { container } = render(<SiteRenderer sections={[section]} template="classic" />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).getByText("Jak zwrócić?")).toBeInTheDocument();
  });

  it("contact renderuje e-mail jako mailto i mapQuery jako link do mapy", () => {
    const section: RenderSection = {
      id: "s-contact",
      position: 0,
      type: "contact",
      content: { heading: "Kontakt", email: "sklep@acme.pl", mapQuery: "Kwiatowa 5, Warszawa" },
    };
    render(<SiteRenderer sections={[section]} template="classic" />);
    expect(screen.getByRole("link", { name: "sklep@acme.pl" })).toHaveAttribute(
      "href",
      "mailto:sklep@acme.pl",
    );
    expect(screen.getByRole("link", { name: "Zobacz na mapie" }).getAttribute("href")).toContain(
      "Kwiatowa",
    );
  });

  it("freeform renderuje treść bezpiecznie (escapowaną)", () => {
    const section: RenderSection = {
      id: "s-free",
      position: 0,
      type: "freeform",
      content: { heading: "O nas", body: "<b>surowy</b> tekst" },
    };
    const { container } = render(<SiteRenderer sections={[section]} template="classic" />);
    expect(container.querySelector("p b")).toBeNull();
    expect(screen.getByText(/surowy/)).toBeInTheDocument();
  });
});

describe("SiteRenderer — szablony", () => {
  it("classic i bold dają różne klasy nagłówka hero", () => {
    const { container: classic } = render(<SiteRenderer sections={[hero()]} template="classic" />);
    const { container: bold } = render(<SiteRenderer sections={[hero()]} template="bold" />);
    const classicH1 = classic.querySelector("h1")!.className;
    const boldH1 = bold.querySelector("h1")!.className;
    expect(classicH1).not.toEqual(boldH1);
    expect(classicH1).toContain("landing-display");
    expect(boldH1).toContain("font-extrabold");
  });
});
