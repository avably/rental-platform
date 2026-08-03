/**
 * Schematy sekcji storefrontu (@avably/core/site, ADR-041). Testy pilnują osi
 * bezpieczeństwa i kontraktu z 2.3b, nie każdego pola z osobna:
 *   - allowlista ctaHref (javascript:/data: nie przechodzą do opublikowanego CTA),
 *   - imagePath jest ścieżką Storage, nie URL-em,
 *   - .strict() odrzuca nieznane klucze (literówka pola = błąd, nie cichy balast),
 *   - parsePublishedSite: powłoka fail-closed, sekcje degradują się indywidualnie.
 */
import { describe, expect, it } from "vitest";

import {
  SECTION_CONTENT_SCHEMAS,
  SECTION_DRAFT_SCHEMAS,
  SECTION_TYPES,
  USP_ICONS,
  ctaContentSchema,
  deliveryContentSchema,
  directionsContentSchema,
  faqContentSchema,
  freeformContentSchema,
  galleryContentSchema,
  heroContentSchema,
  parsePublishedSite,
  presetContentFor,
  sectionCanvasFrom,
  sectionInputSchema,
  testimonialsContentSchema,
  uspContentSchema,
} from "./index";

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("schematy treści sekcji", () => {
  it("każdy typ sekcji ma schemat treści (kontrakt z CHECK-iem 0019 i edytorem 2.3b)", () => {
    for (const type of SECTION_TYPES) {
      expect(SECTION_CONTENT_SCHEMAS[type], `brak schematu dla typu "${type}"`).toBeDefined();
    }
  });

  it("hero: przyjmuje komplet pól z http(s) CTA i ścieżką Storage", () => {
    const result = heroContentSchema.safeParse({
      heading: "Wypożycz sprzęt na weekend",
      subheading: "Odbiór w Warszawie albo kurierem",
      ctaText: "Zobacz katalog",
      ctaHref: "https://example.com/katalog",
      imagePath: "3f8a/hero/okladka.webp",
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "  javascript:alert(1)"])(
    "hero: ctaHref odrzuca wektor XSS %s",
    (href) => {
      const result = heroContentSchema.safeParse({ heading: "X", ctaHref: href });
      expect(result.success, "schemat przepuścił niedozwolony scheme do CTA").toBe(false);
    },
  );

  it.each(["/cennik", "#kontakt", "http://example.com/a"])(
    "hero: ctaHref dopuszcza %s (ścieżka względna / kotwica / http)",
    (href) => {
      expect(heroContentSchema.safeParse({ heading: "X", ctaHref: href }).success).toBe(true);
    },
  );

  it("hero: imagePath odrzuca URL i wyjście z przestrzeni ścieżek (..)", () => {
    expect(heroContentSchema.safeParse({ heading: "X", imagePath: "https://evil.example/x.png" }).success).toBe(false);
    expect(heroContentSchema.safeParse({ heading: "X", imagePath: "../cudzy-tenant/x.png" }).success).toBe(false);
  });

  it("strict: nieznany klucz jest błędem, nie balastem", () => {
    const result = heroContentSchema.safeParse({ heading: "X", headding: "literówka" });
    expect(result.success).toBe(false);
  });

  it("faq: wymaga items, limituje do 50 pozycji", () => {
    expect(faqContentSchema.safeParse({ items: [{ q: "Jak?", a: "Tak." }] }).success).toBe(true);
    const tooMany = { items: Array.from({ length: 51 }, () => ({ q: "Q", a: "A" })) };
    expect(faqContentSchema.safeParse(tooMany).success).toBe(false);
  });

  it("freeform: body jest wymagane i nie może być puste po trim", () => {
    expect(freeformContentSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(freeformContentSchema.safeParse({ body: "Regulamin wypożyczalni…" }).success).toBe(true);
  });

  it("sectionInputSchema: para (type, content) musi być spójna", () => {
    // Treść hero pod typem faq — discriminated union odrzuca.
    const result = sectionInputSchema.safeParse({ type: "faq", content: { heading: "X" } });
    expect(result.success, "treść niezgodna z typem sekcji przeszła walidację").toBe(false);
  });

  it("sectionInputSchema: nowe typy 0043 są rozpoznawane (para type↔content)", () => {
    expect(
      sectionInputSchema.safeParse({
        type: "cta",
        content: { heading: "Zarezerwuj", buttonLabel: "Katalog", buttonHref: "#produkty" },
      }).success,
    ).toBe(true);
    // Treść cta pod typem usp — niespójna, discriminated union odrzuca.
    expect(
      sectionInputSchema.safeParse({
        type: "usp",
        content: { heading: "X", buttonLabel: "Y", buttonHref: "#z" },
      }).success,
    ).toBe(false);
  });
});

describe("nowe typy sekcji (0043, ADR-082)", () => {
  it("testimonials: lista opinii z podpisem; nadmiar pozycji odrzucony", () => {
    expect(
      testimonialsContentSchema.safeParse({
        heading: "Opinie",
        items: [{ quote: "Super sprzęt.", author: "Jan", role: "DJ" }],
      }).success,
    ).toBe(true);
    // role opcjonalne — brak jest OK.
    expect(
      testimonialsContentSchema.safeParse({ items: [{ quote: "OK", author: "Jan" }] }).success,
    ).toBe(true);
    const tooMany = { items: Array.from({ length: 21 }, () => ({ quote: "Q", author: "A" })) };
    expect(testimonialsContentSchema.safeParse(tooMany).success).toBe(false);
  });

  it("gallery: imagePath jest ścieżką Storage (nie URL), alt wymagany", () => {
    expect(
      galleryContentSchema.safeParse({ items: [{ imagePath: "3f8a/site/1.webp", alt: "Namiot" }] })
        .success,
    ).toBe(true);
    // URL zamiast ścieżki Storage — odrzucony (jak w hero.imagePath).
    expect(
      galleryContentSchema.safeParse({ items: [{ imagePath: "https://evil/x.png", alt: "x" }] })
        .success,
    ).toBe(false);
    // alt pusty po trim — pozycja galerii bez opisu alternatywnego to regres a11y.
    expect(
      galleryContentSchema.safeParse({ items: [{ imagePath: "3f8a/site/1.webp", alt: "  " }] })
        .success,
    ).toBe(false);
  });

  it.each(USP_ICONS)("usp: ikona %s z allowlisty przechodzi", (icon) => {
    expect(uspContentSchema.safeParse({ items: [{ icon, title: "T", text: "X" }] }).success).toBe(
      true,
    );
  });

  it("usp: ikona spoza allowlisty jest odrzucona", () => {
    expect(
      uspContentSchema.safeParse({ items: [{ icon: "skull", title: "T", text: "X" }] }).success,
    ).toBe(false);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "  javascript:void(0)"])(
    "cta: buttonHref odrzuca wektor XSS %s",
    (href) => {
      expect(
        ctaContentSchema.safeParse({ heading: "H", buttonLabel: "L", buttonHref: href }).success,
      ).toBe(false);
    },
  );

  it("cta: komplet pól z bezpiecznym href przechodzi; heading i przycisk wymagane", () => {
    expect(
      ctaContentSchema.safeParse({
        heading: "Zarezerwuj termin",
        text: "Sprawdź dostępność.",
        buttonLabel: "Katalog",
        buttonHref: "/katalog",
      }).success,
    ).toBe(true);
    expect(ctaContentSchema.safeParse({ heading: "H", buttonLabel: "L" }).success).toBe(false);
  });

  it("directions: adres wymagany, mapsUrl przez allowlistę (bez javascript:)", () => {
    expect(directionsContentSchema.safeParse({ address: "ul. Testowa 1" }).success).toBe(true);
    expect(
      directionsContentSchema.safeParse({ address: "ul. Testowa 1", mapsUrl: "https://maps.example" })
        .success,
    ).toBe(true);
    expect(
      directionsContentSchema.safeParse({ address: "ul. Testowa 1", mapsUrl: "javascript:x" })
        .success,
    ).toBe(false);
    // BEZ osadzania obcych skryptów — brak pola na iframe/embed HTML (strict).
    expect(
      directionsContentSchema.safeParse({ address: "ul. Testowa 1", embed: "<iframe>" }).success,
    ).toBe(false);
  });

  it("delivery: nagłówek i tekst wymagane; pozycje opcjonalne", () => {
    expect(
      deliveryContentSchema.safeParse({ heading: "Dostawa", text: "Dowozimy pod adres." }).success,
    ).toBe(true);
    expect(
      deliveryContentSchema.safeParse({
        heading: "Dostawa",
        text: "Dowozimy.",
        items: [{ title: "Lokalnie", text: "Tego samego dnia." }],
      }).success,
    ).toBe(true);
    expect(deliveryContentSchema.safeParse({ heading: "Dostawa" }).success).toBe(false);
  });
});

describe("parsePublishedSite — kontrakt odczytu publicznego", () => {
  const validSection = {
    id: uuid(1),
    type: "hero",
    position: 0,
    content: { heading: "Nagłówek" },
  };

  it("parsuje poprawną odpowiedź RPC", () => {
    const site = parsePublishedSite({
      template: "classic",
      published_at: "2026-07-18T10:00:00+00:00",
      sections: [validSection],
    });
    expect(site).not.toBeNull();
    expect(site?.template).toBe("classic");
    expect(site?.sections).toHaveLength(1);
    expect(site?.sections[0]?.type).toBe("hero");
  });

  it("powłoka fail-closed: zły kształt / null → null", () => {
    expect(parsePublishedSite(null)).toBeNull();
    expect(parsePublishedSite({ template: "neon", published_at: "x", sections: [] })).toBeNull();
    expect(parsePublishedSite({ template: "classic", sections: [] })).toBeNull();
  });

  it("niepoprawna sekcja jest POMIJANA, nie wywraca strony (degradacja per sekcja)", () => {
    const site = parsePublishedSite({
      template: "bold",
      published_at: "2026-07-18T10:00:00+00:00",
      sections: [
        validSection,
        { id: uuid(2), type: "hero", position: 1, content: {} }, // hero bez heading — stary/zepsuty kształt
        { id: uuid(3), type: "freeform", position: 2, content: { body: "OK" } },
      ],
    });
    expect(site).not.toBeNull();
    expect(site?.sections.map((s) => s.id)).toEqual([uuid(1), uuid(3)]);
  });

  it("zachowuje kolejność sekcji z bazy (position, id rozstrzyga baza, nie parser)", () => {
    const site = parsePublishedSite({
      template: "classic",
      published_at: "2026-07-18T10:00:00+00:00",
      sections: [
        { id: uuid(2), type: "freeform", position: 5, content: { body: "B" } },
        { id: uuid(1), type: "hero", position: 7, content: { heading: "A" } },
      ],
    });
    expect(site?.sections.map((s) => s.id)).toEqual([uuid(2), uuid(1)]);
  });
});

/**
 * ODCZYT SZKICU ZNA OBIE GENERACJE TREŚCI (K4, ADR-088).
 *
 * Wada, którą ten blok zamyka, była obecna od K2 i NIE wywalała niczego na
 * czerwono: edytor panelu parsował `content_draft` schematami wyłącznie v1,
 * więc zapisane płótno odpadało na walidacji, a w jego miejsce wchodził preset
 * typu. Zapis szedł do bazy poprawnie, odczyt wracał wyprany — i ponieważ
 * preset wygląda dokładnie jak świeżo dodana sekcja, objawem nie był błąd,
 * tylko układ cofający się do stanu startowego po każdym przeładowaniu.
 *
 * Kontrakt pyta o zgodność TRZECH dróg treści: zapisu, odczytu publicznego
 * i odczytu szkicu. Rozjazd którejkolwiek z nich znaczy treść, którą da się
 * zapisać, a której nie da się odczytać (albo odwrotnie).
 */
describe("odczyt szkicu: płótno v2 przeżywa podróż do bazy i z powrotem", () => {
  it.each(SECTION_TYPES)("%s: schemat szkicu przyjmuje treść v1", (type) => {
    const parsed = SECTION_DRAFT_SCHEMAS[type].safeParse(presetContentFor(type, "pl"));
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it.each(SECTION_TYPES)("%s: schemat szkicu przyjmuje PŁÓTNO v2", (type) => {
    const canvas = sectionCanvasFrom(type, presetContentFor(type, "pl"));
    const parsed = SECTION_DRAFT_SCHEMAS[type].safeParse(canvas);
    expect(
      parsed.success ? null : parsed.error.issues,
      `płótno ${type} nie przechodzi odczytu szkicu — edytor podstawi preset`,
    ).toBeNull();
  });

  it.each(SECTION_TYPES)("%s: odczyt szkicu oddaje płótno BEZ ZMIANY", (type) => {
    // Sedno: nie chodzi o „przeszło walidację", tylko o „wróciło to samo".
    const canvas = sectionCanvasFrom(type, presetContentFor(type, "pl"));
    const parsed = SECTION_DRAFT_SCHEMAS[type].parse(canvas);
    expect(parsed).toEqual(canvas);
  });

  it("odczyt szkicu zachowuje RĘCZNĄ poprawkę mobilną i tryb wymiaru", () => {
    // Dwie rzeczy, które K4 dokłada do treści. Schemat, który je milcząco
    // gubi, kasowałby pracę operatora przy pierwszym odczycie.
    const canvas = sectionCanvasFrom("hero", presetContentFor("hero", "pl"));
    const zPoprawka = {
      ...canvas,
      elements: canvas.elements.map((element, index) =>
        index === 0
          ? { ...element, layout: { ...element.layout, mobile: { x: 12, y: 300, w: 100, h: 40, z: 0 } } }
          : element,
      ),
    };
    const parsed = SECTION_DRAFT_SCHEMAS.hero.parse(zPoprawka) as typeof zPoprawka;
    expect(parsed.elements[0]!.layout.mobile).toEqual({ x: 12, y: 300, w: 100, h: 40, z: 0 });
    const przycisk = parsed.elements.find((element) => element.kind === "button")!;
    expect("size" in przycisk ? przycisk.size : undefined).toEqual({ w: "hug", h: "hug" });
  });

  it("schemat v1 SAM W SOBIE płótna nie przyjmuje (kontrola pozytywna wady)", () => {
    // Kontrola, bez której cały blok broniłby oczywistości: gdyby schematy v1
    // od zawsze przyjmowały płótno, nie byłoby czego naprawiać.
    const canvas = sectionCanvasFrom("hero", presetContentFor("hero", "pl"));
    expect(SECTION_CONTENT_SCHEMAS.hero.safeParse(canvas).success).toBe(false);
  });
});
