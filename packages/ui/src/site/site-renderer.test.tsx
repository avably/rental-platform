import {
  SECTION_TYPES,
  SITE_THEMES,
  presetContentFor,
  themeTokens,
  type SectionType,
} from "@avably/core/site";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import type { RenderSection, SectionContent, StorefrontProduct } from "./types";

/** Styl motywu w jego własnym domyślnym ustawieniu — rejestr, nie literały. */
function styleOf(theme: Parameters<typeof themeTokens>[0]) {
  const tokens = themeTokens(theme);
  return { theme, accent: tokens.defaultAccent, fontPair: tokens.fontPair };
}

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
    render(<SiteRenderer sections={[hero()]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Wynajmij sprzęt" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz" })).toHaveAttribute("href", "#produkty");
  });

  it("sekcja products pokazuje przekazany katalog", () => {
    const section: RenderSection = { id: "s-prod", position: 1, type: "products", content: { heading: "Nasz sprzęt" } };
    render(<SiteRenderer sections={[section]} products={products} />);
    expect(screen.getByText("Wiertarka")).toBeInTheDocument();
    expect(screen.getByText("Betoniarka")).toBeInTheDocument();
  });

  it("karta z href jest linkiem do podstrony; bez href zostaje statyczna", () => {
    const section: RenderSection = { id: "s-prod", position: 1, type: "products", content: { heading: "Nasz sprzęt" } };
    const linked: StorefrontProduct[] = [
      { id: "p1", name: "Wiertarka", description: null, priceLabel: "od 40,00 zł / doba", imageUrl: null, imageAlt: "Wiertarka", href: "/product/p1" },
    ];
    const { rerender } = render(<SiteRenderer sections={[section]} products={linked} />);
    expect(screen.getByRole("link", { name: /Wiertarka/ })).toHaveAttribute("href", "/product/p1");
    // Podgląd panelu (bez href) nie robi z karty linku.
    rerender(<SiteRenderer sections={[section]} products={products} />);
    expect(screen.queryByRole("link", { name: /Wiertarka/ })).toBeNull();
  });

  it("sekcja products bez katalogu pokazuje etykietę pustego stanu", () => {
    const section: RenderSection = { id: "s-prod", position: 1, type: "products", content: { heading: "Nasz sprzęt" } };
    render(
      <SiteRenderer
        sections={[section]}
        products={[]}
        labels={{ productsEmpty: "Brak produktów", contactEmail: "E:", contactPhone: "T:", contactAddress: "A:", contactMap: "Mapa", directionsAddress: "A:", directionsHours: "G:", directionsMap: "Mapa", galleryZoom: "Powiększ", galleryClose: "Zamknij", galleryPrev: "Poprzednie", galleryNext: "Następne", galleryPosition: "{current}/{total}" }}
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
    const { container } = render(<SiteRenderer sections={[section]} />);
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
    render(<SiteRenderer sections={[section]} />);
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
    const { container } = render(<SiteRenderer sections={[section]} />);
    expect(container.querySelector("p b")).toBeNull();
    expect(screen.getByText(/surowy/)).toBeInTheDocument();
  });
});

describe("SiteRenderer — szablony", () => {
  it("motyw NIE zmienia klas nagłówka hero — zmienia wartości zmiennych (ADR-090)", () => {
    // Do K5 ten test żądał, żeby `classic` i `bold` dały RÓŻNE klasy: wyglądem
    // rządził kod. Od ADR-090 jest odwrotnie i to jest teza całego zadania —
    // klasy są jedne, a świat wizualny niesie rejestr motywów jako zmienne.
    // Odwrócenie asercji jest więc zmianą modelu, a nie osłabieniem kontraktu:
    // różnicy dowodzimy tam, gdzie ona naprawdę jest.
    const first = render(<SiteRenderer sections={[hero()]} style={styleOf("industrial-noir")} />);
    const second = render(<SiteRenderer sections={[hero()]} style={styleOf("confetti")} />);
    expect(first.container.querySelector("h1")!.className).toEqual(
      second.container.querySelector("h1")!.className,
    );
    expect(first.container.querySelector("h1")!.className).toContain("landing-display");
    // jsdom normalizuje wartości w atrybucie `style` do małych liter — stąd
    // porównanie po obu stronach sprowadzone do jednego rejestru znaków.
    const niesieKolor = (container: HTMLElement, hex: string) =>
      container
        .querySelector<HTMLElement>(".site-root")!
        .getAttribute("style")!
        .toLowerCase()
        .includes(hex.toLowerCase());
    expect(niesieKolor(first.container, themeTokens("industrial-noir").bands.default.surface)).toBe(true);
    expect(niesieKolor(second.container, themeTokens("confetti").bands.default.surface)).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Nowe typy sekcji (0043) — render w OBU szablonach + osie specyficzne.
// -----------------------------------------------------------------------

function sectionOf(type: SectionType, content: SectionContent): RenderSection {
  return { id: `s-${type}`, position: 0, type, content } as RenderSection;
}

describe("SiteRenderer — każdy typ sekcji renderuje się w KAŻDYM motywie", () => {
  // Kontrakt spójności między typami (brief A2), rozszerzony w ADR-090 z dwóch
  // szablonów na CAŁY REJESTR MOTYWÓW: macierz rośnie sama przy dopisaniu
  // motywu nr 7, bo idzie po `SITE_THEMES`, a nie po liście przypadków.
  it.each(SECTION_TYPES.flatMap((type) => SITE_THEMES.map((theme) => [type, theme] as const)))(
    "typ %s w motywie %s",
    (type, theme) => {
      const { container } = render(
        <SiteRenderer sections={[sectionOf(type, presetContentFor(type, "pl"))]} style={styleOf(theme)} />,
      );
      // Sekcja wyrenderowała treść, nie pustkę. Stopka (K6, ADR-092) niesie
      // rolę dokumentu, a nie sekcję treści — stąd `<footer>` zamiast
      // `<section>`; asercja pyta o którykolwiek z landmarków, żeby nie
      // udawać, że każdy typ jest sekcją.
      expect(container.querySelector("section, footer")).not.toBeNull();
    },
  );
});

// Ten plik nie ma auto-cleanup RTL (brak globals), a testy wyżej unikają
// kolizji unikalnymi napisami. Nowe testy zawężają zapytania do WŁASNEGO
// kontenera (within), więc nie zależą od sprzątania między testami.
describe("SiteRenderer — osie nowych typów", () => {
  it("testimonials: cytat, autor i rola", () => {
    const section = sectionOf("testimonials", {
      heading: "Opinie",
      items: [{ quote: "Świetny sprzęt", author: "Jan Test", role: "DJ" }],
    });
    const { container } = render(<SiteRenderer sections={[section]} />);
    const q = within(container);
    expect(q.getByText("Świetny sprzęt")).toBeInTheDocument();
    expect(q.getByText("Jan Test")).toBeInTheDocument();
    expect(q.getByText("DJ")).toBeInTheDocument();
  });

  it("gallery: z siteImageBase buduje publiczny URL; bez bazy placeholder", () => {
    const section = sectionOf("gallery", {
      heading: "Galeria",
      items: [{ imagePath: "t/s/foto.webp", alt: "Namiot imprezowy" }],
    });
    const { container: withBase } = render(
      <SiteRenderer sections={[section]} siteImageBase="https://cdn.example/storage/v1/object/public/site-images" />,
    );
    const img = withBase.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      "https://cdn.example/storage/v1/object/public/site-images/t/s/foto.webp",
    );
    expect(img).toHaveAttribute("alt", "Namiot imprezowy");

    const { container: noBase } = render(<SiteRenderer sections={[section]} />);
    expect(noBase.querySelector("img")).toBeNull();
  });

  it("usp: renderuje ikonę (svg), tytuł i tekst", () => {
    const section = sectionOf("usp", {
      items: [{ icon: "truck", title: "Dostawa", text: "Pod adres" }],
    });
    const { container } = render(<SiteRenderer sections={[section]} />);
    const q = within(container);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(q.getByText("Dostawa")).toBeInTheDocument();
    expect(q.getByText("Pod adres")).toBeInTheDocument();
  });

  it("cta: przycisk jest linkiem do buttonHref", () => {
    const section = sectionOf("cta", {
      heading: "Zarezerwuj",
      text: "Sprawdź dostępność",
      buttonLabel: "Katalog",
      buttonHref: "#produkty",
    });
    const { container } = render(<SiteRenderer sections={[section]} />);
    expect(within(container).getByRole("link", { name: "Katalog" })).toHaveAttribute("href", "#produkty");
  });

  it("directions: adres + link do map, BEZ iframe/embed", () => {
    const section = sectionOf("directions", {
      address: "ul. Testowa 1, Warszawa",
      mapsUrl: "https://maps.example/x",
      hours: "Pon–Pt 9–17",
    });
    const { container } = render(<SiteRenderer sections={[section]} />);
    const q = within(container);
    expect(q.getByText("ul. Testowa 1, Warszawa")).toBeInTheDocument();
    const mapLink = q.getByRole("link", { name: "Zobacz na mapie" });
    expect(mapLink).toHaveAttribute("href", "https://maps.example/x");
    expect(mapLink).toHaveAttribute("rel", expect.stringContaining("noopener"));
    // Żadnego osadzania obcych treści.
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("delivery: nagłówek, tekst i pozycje", () => {
    const section = sectionOf("delivery", {
      heading: "Dostawa",
      text: "Dowozimy pod adres.",
      items: [{ title: "Lokalnie", text: "Tego samego dnia" }],
    });
    const { container } = render(<SiteRenderer sections={[section]} />);
    const q = within(container);
    expect(q.getByRole("heading", { name: "Dostawa" })).toBeInTheDocument();
    expect(q.getByText("Dowozimy pod adres.")).toBeInTheDocument();
    expect(q.getByText("Lokalnie")).toBeInTheDocument();
  });

  it("hero: z imagePath + siteImageBase renderuje zdjęcie", () => {
    const section = sectionOf("hero", { heading: "Hero", imagePath: "t/s/hero.png" });
    const { container } = render(
      <SiteRenderer sections={[section]} siteImageBase="https://cdn.example/bucket" />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/bucket/t/s/hero.png");
  });
});

/**
 * SZEW WARSTWY EDYCYJNEJ (`sectionWrapper`, K1 / ADR-083).
 *
 * Kreator obkłada sekcje obrysem, paskiem narzędzi i miejscami na „+”, NIE
 * dotykając renderera — dostaje na to jedno wejście i to wejście jest tutaj
 * opisane. Domyślnie (sklep, podgląd) owijka jest sama kotwicą sekcji.
 */
describe("SiteRenderer — szew owijki sekcji", () => {
  it("bez owijki każda sekcja dostaje kotwicę data-section-id i nic więcej", () => {
    const sections = [sectionOf("hero", { heading: "A" }), sectionOf("cta", { heading: "B", buttonLabel: "Idź", buttonHref: "#x" })];
    sections[1]!.id = "s-2";
    const { container } = render(<SiteRenderer sections={sections} />);

    const anchors = container.querySelectorAll("[data-section-id]");
    expect(anchors).toHaveLength(2);
    // Owijka jest PRZEZROCZYSTA: żadnych klas, żadnych innych atrybutów.
    for (const anchor of anchors) {
      expect(anchor.getAttributeNames().sort()).toEqual(["data-section-id"]);
    }
  });

  it("podana owijka obejmuje treść sekcji, a nie zastępuje jej", () => {
    const { container } = render(
      <SiteRenderer
        sections={[sectionOf("hero", { heading: "Wynajmij sprzęt" })]}
        sectionWrapper={(section, children) => (
          <div data-canvas-section={section.id} data-section-type={section.type}>
            <button type="button" data-drag-handle aria-label="Przeciągnij" />
            {children}
          </div>
        )}
      />,
    );

    const wrapper = container.querySelector("[data-canvas-section]");
    expect(wrapper?.getAttribute("data-section-type")).toBe("hero");
    expect(wrapper?.querySelector("[data-drag-handle]")).not.toBeNull();
    // Treść sekcji zostaje TA SAMA — owijka nie jest forkiem renderu.
    expect(
      within(container).getByRole("heading", { level: 1, name: "Wynajmij sprzęt" }),
    ).toBeInTheDocument();
    // Domyślna kotwica ustępuje owijce: jedna owijka na sekcję, nie dwie.
    expect(container.querySelectorAll("[data-section-id]")).toHaveLength(0);
  });

  it("owijka dostaje KAŻDĄ sekcję, w kolejności wejścia", () => {
    const seen: string[] = [];
    const sections = [sectionOf("hero", { heading: "A" }), sectionOf("pricing", { heading: "B" }), sectionOf("faq", { heading: "C", items: [] })];
    sections[1]!.id = "s-b";
    sections[2]!.id = "s-c";

    render(
      <SiteRenderer
        sections={sections}
        sectionWrapper={(section, children) => {
          seen.push(section.type);
          return <div key={section.id}>{children}</div>;
        }}
      />,
    );

    expect(seen).toEqual(["hero", "pricing", "faq"]);
  });
});
