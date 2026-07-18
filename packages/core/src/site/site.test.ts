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
  SECTION_TYPES,
  faqContentSchema,
  freeformContentSchema,
  heroContentSchema,
  parsePublishedSite,
  sectionInputSchema,
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
