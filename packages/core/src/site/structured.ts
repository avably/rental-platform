/**
 * SEKCJE STRUKTURALNE — TREŚĆ v3 (E1, ADR-094).
 *
 * ==================== PO CO TRZECIA GENERACJA ====================
 *
 * Sekcja v1 była formularzem pól, sekcja v2 (płótno, ADR-084) jest wolną
 * kompozycją pudełek. Obie mają wspólną wadę tam, gdzie typ sekcji ma WŁASNĄ
 * MECHANIKĘ: pytanie i odpowiedź FAQ, zdjęcie z podpisem, pozycja cennika to
 * nie są „nagłówek i akapit obok siebie", tylko WPISY listy. Konwersja do
 * płótna spłaszczała je bezpowrotnie — stąd FAQ bez accordionu, galeria bez
 * zdjęć i cennik, który nie zna pojęcia ceny.
 *
 * Sekcja strukturalna zamyka to w trzech zdaniach:
 *   1. TREŚĆ to dane typowane — tam, gdzie typ jest listowy, jest to LISTA
 *      WPISÓW (`items`), a nie zbiór luźnych elementów;
 *   2. WYGLĄD to `layout` — nazwa wariantu układu z REJESTRU tego typu.
 *      Przełączenie układu NIE DOTYKA danych (kontrakt bezstratności niżej);
 *   3. RENDER to jeden komponent na parę (typ, układ) — ten sam w sklepie i na
 *      płótnie kreatora, malujący WYŁĄCZNIE rolami motywu (ADR-090).
 *
 * ==================== ZERO MIGRACJI DB ====================
 *
 * Treść jedzie tym samym `jsonb` (`content_draft` / `content_published`), co
 * v1 i v2, i tym samym kanałem publikacji (ADR-091). Generację niesie SAMA
 * TREŚĆ — klucz `v: 3` — więc `app.get_published_site` zostaje nietknięta,
 * a koperta przenosi v3 co do bajta (dowód: pakiet bramki publikacji).
 * Zbiory rozpoznań są rozłączne: v1 nie ma `v` ani `version`, v2 ma `version`,
 * v3 ma `v`, a wszystkie schematy są `.strict()`.
 *
 * ==================== REJESTR, NIE LISTA PRZYPADKÓW ====================
 *
 * {@link STRUCTURED_SECTIONS} jest JEDYNYM miejscem, w którym typ strukturalny
 * istnieje. Dopisanie wpisu automatycznie:
 *   • rozszerza schematy zapisu/odczytu (`contentUnionFor` w ./index),
 *   • wchodzi do macierzy kontrastu (deklaracja `themeRoles` — patrz
 *     contrast-contract.test.ts),
 *   • wchodzi do kontraktu kompletności renderu (@avably/ui),
 *   • wchodzi do parytetu presetów PL/EN.
 * To jest ta sama noga rejestrowa, na której stoi rejestr motywów (ADR-090):
 * bramka liczy po ZBIORZE, nie po tablicy przypadków obok testu.
 */
import { z } from "zod";

import { SECTION_BACKGROUNDS } from "./elements";

/** Znacznik generacji w treści sekcji. Jedyny sposób rozpoznania v3. */
export const STRUCTURED_SECTION_VERSION = 3;

// -----------------------------------------------------------------------
// Cegiełki pól (te same zasady, co w ./index: trim, min. 1, skończone maks.)
// -----------------------------------------------------------------------

const heading = z.string().trim().min(1).max(200);
const question = z.string().trim().min(1).max(500);
const answer = z.string().trim().min(1).max(10_000);

// -----------------------------------------------------------------------
// Role motywu, którymi WOLNO malować sekcję strukturalną
// -----------------------------------------------------------------------

/**
 * Role motywu (ADR-090) z progiem, jaki musi spełnić ich kontrast na pasie.
 * Komponent strukturalny nie zna ani jednego heksa — deklaruje w rejestrze,
 * KTÓRYCH ról używa, a macierz kontrastu liczy je po tej deklaracji.
 *
 * Progi: tekst → AA dla tekstu, kreska i wypełnienie → próg nietekstowy
 * (chodzi o rozpoznanie kształtu, nie o czytanie liter).
 */
export const STRUCTURED_THEME_ROLES = [
  "ink",
  "inkMuted",
  "border",
  "accentText",
  "accentFill",
] as const;
export type StructuredThemeRole = (typeof STRUCTURED_THEME_ROLES)[number];

// -----------------------------------------------------------------------
// FAQ — typ referencyjny (E1)
// -----------------------------------------------------------------------

/**
 * Warianty układu FAQ. `accordion` zwija odpowiedzi za przyciskami (W3C APG),
 * `open-list` pokazuje wszystko naraz i nie ma czego rozwijać — ten sam
 * `items`, dwa sposoby czytania.
 */
export const FAQ_LAYOUTS = ["accordion", "open-list"] as const;
export type FaqLayout = (typeof FAQ_LAYOUTS)[number];

/** Górna granica par FAQ — lustro `maxItems` w rejestrze (test pilnuje zgody). */
const FAQ_MAX_ITEMS = 50;

export const faqStructuredSchema = z
  .object({
    v: z.literal(STRUCTURED_SECTION_VERSION),
    type: z.literal("faq"),
    layout: z.enum(FAQ_LAYOUTS),
    /** Pas motywu — ta sama allowlista, co dla płótna v2 (jedno pojęcie tła). */
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    heading: heading.optional(),
    /**
     * Pary pytanie–odpowiedź. MINIMUM JEDNA: sekcja FAQ bez ani jednego pytania
     * nie jest sekcją FAQ, tylko pustym nagłówkiem — a to jest dokładnie ta
     * klasa atrap, którą E1 likwiduje.
     */
    items: z
      .array(z.object({ q: question, a: answer }).strict())
      .min(1)
      .max(FAQ_MAX_ITEMS),
    /**
     * Czy wolno mieć otwartą więcej niż jedną odpowiedź naraz (ustawienie
     * sekcji). Dotyczy WYŁĄCZNIE układu `accordion` — `open-list` z definicji
     * pokazuje wszystko.
     */
    allowMultiple: z.boolean().default(false),
  })
  .strict();

export type FaqStructuredContent = z.infer<typeof faqStructuredSchema>;

// -----------------------------------------------------------------------
// Opis edytora — mini-CMS czyta pola z DANYCH, nie z `if`-ów per typ
// -----------------------------------------------------------------------

/** Rodzaj kontrolki pola wpisu: jednowierszowa albo wielowierszowa. */
export type StructuredFieldKind = "text" | "multiline";

export interface StructuredFieldSpec {
  /** Klucz pola we wpisie — zarazem końcówka klucza tłumaczenia etykiety. */
  key: string;
  kind: StructuredFieldKind;
  /** Wysokość pola wielowierszowego (wiersze). */
  rows?: number;
}

/** Przełącznik logiczny w ustawieniach sekcji (np. „pozwól otworzyć wiele naraz"). */
export interface StructuredToggleSpec {
  key: string;
}

export interface StructuredSectionSpec<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: TSchema;
  /** Warianty układu — kolejność = kolejność w przełączniku szuflady. */
  layouts: readonly string[];
  defaultLayout: string;
  /** Pola JEDNEGO wpisu listy — framework szuflady renderuje je po kolei. */
  itemFields: readonly StructuredFieldSpec[];
  /** Ustawienia sekcji poza listą wpisów. */
  toggles: readonly StructuredToggleSpec[];
  minItems: number;
  maxItems: number;
  /** Role motywu malowane przez render tego typu — wejście macierzy kontrastu. */
  themeRoles: readonly StructuredThemeRole[];
  /** Treść startowa (preset) w obu językach — parytet pilnuje test. */
  preset: Record<"pl" | "en", unknown>;
  /** Świeży wpis dodawany przyciskiem „dodaj" — musi spełniać schemat. */
  newItem: Record<"pl" | "en", unknown>;
}

/**
 * REJESTR TYPÓW STRUKTURALNYCH. E1 wnosi jeden wpis — FAQ jako typ
 * referencyjny end-to-end. Kolejne typy (galeria, kontakt, dojazd, cennik,
 * opinie, sprzęt, dostawa, atuty, CTA) dopisują się TUTAJ i nigdzie indziej.
 */
export const STRUCTURED_SECTIONS = {
  faq: {
    schema: faqStructuredSchema,
    layouts: FAQ_LAYOUTS,
    defaultLayout: "accordion",
    itemFields: [
      { key: "q", kind: "text" },
      { key: "a", kind: "multiline", rows: 4 },
    ],
    toggles: [{ key: "allowMultiple" }],
    minItems: 1,
    maxItems: FAQ_MAX_ITEMS,
    // Render FAQ maluje: tytuł pytania (ink), odpowiedź (inkMuted) i kreskę
    // rozdzielającą pary (border). Nic poza tym — zero heksów w komponencie.
    themeRoles: ["ink", "inkMuted", "border"],
    preset: {
      pl: {
        v: STRUCTURED_SECTION_VERSION,
        type: "faq",
        layout: "accordion",
        background: "default",
        heading: "Najczęstsze pytania",
        allowMultiple: false,
        items: [
          {
            q: "Jak zarezerwować sprzęt?",
            a: "Wybierz termin w katalogu i złóż rezerwację online — potwierdzenie dostaniesz mailem.",
          },
          {
            q: "Czy pobieracie kaucję?",
            a: "Tak. Kaucję zwracamy po sprawdzeniu zwróconego sprzętu, zwykle w ciągu dwóch dni roboczych.",
          },
          {
            q: "Co, jeśli sprzęt się zepsuje w trakcie najmu?",
            a: "Zadzwoń do nas od razu. Sprzęt wymieniamy albo naprawiamy, a czas przestoju odliczamy od najmu.",
          },
        ],
      },
      en: {
        v: STRUCTURED_SECTION_VERSION,
        type: "faq",
        layout: "accordion",
        background: "default",
        heading: "Frequently asked questions",
        allowMultiple: false,
        items: [
          {
            q: "How do I book equipment?",
            a: "Pick your dates in the catalog and book online — you'll get an email confirmation.",
          },
          {
            q: "Do you charge a deposit?",
            a: "Yes. We refund the deposit after checking the returned gear, usually within two business days.",
          },
          {
            q: "What if the equipment breaks during the rental?",
            a: "Call us right away. We replace or repair the gear and deduct the downtime from your rental.",
          },
        ],
      },
    },
    newItem: {
      pl: { q: "Nowe pytanie", a: "Odpowiedź na nowe pytanie." },
      en: { q: "New question", a: "Answer to the new question." },
    },
  },
} as const satisfies Record<string, StructuredSectionSpec>;

export type StructuredSectionType = keyof typeof STRUCTURED_SECTIONS;

/** Lustro kluczy rejestru — zbiór, po którym chodzą bramki i macierze. */
export const STRUCTURED_SECTION_TYPES = Object.keys(
  STRUCTURED_SECTIONS,
) as readonly StructuredSectionType[];

/**
 * Treść strukturalna DLA KONKRETNEGO typu sekcji — `never`, gdy typ nie ma
 * silnika strukturalnego. Dzięki temu unia treści sekcji w ./index zna prawdę
 * PER TYP: `hero` nie dostaje wariantu v3, którego nigdy nie będzie mieć,
 * a `faq` dostaje dokładnie swój. Rejestr jest tu jedynym źródłem — dopisanie
 * typu przestawia typy w całym systemie bez ani jednej zmiany obok.
 */
export type StructuredContentOf<T extends string> = T extends StructuredSectionType
  ? z.infer<(typeof STRUCTURED_SECTIONS)[T]["schema"]>
  : never;

/** Treść sekcji strukturalnej DOWOLNEGO typu z rejestru. */
export type StructuredSectionContent = z.infer<
  (typeof STRUCTURED_SECTIONS)[StructuredSectionType]["schema"]
>;

/**
 * Schemat treści strukturalnej danego typu albo `undefined`, gdy typ nie jest
 * (jeszcze) strukturalny. Jedyna droga, którą reszta systemu pyta rejestr.
 */
export function structuredSchemaFor(type: string): z.ZodTypeAny | undefined {
  return (STRUCTURED_SECTIONS as Record<string, StructuredSectionSpec | undefined>)[type]?.schema;
}

/** Czy typ sekcji ma silnik strukturalny. */
export function isStructuredType(type: string): type is StructuredSectionType {
  return Object.hasOwn(STRUCTURED_SECTIONS, type);
}

/**
 * Czy treść jest sekcją strukturalną (v3). Rozpoznanie CELOWO płytkie — jak
 * `isSectionCanvas`: treść w kształcie v3, ale niepoprawna, ma zostać
 * odrzucona jako zepsute v3, a nie przepuszczona do renderu innej generacji.
 */
export function isStructuredSection(content: unknown): content is StructuredSectionContent {
  return (
    typeof content === "object" &&
    content !== null &&
    (content as { v?: unknown }).v === STRUCTURED_SECTION_VERSION
  );
}

/** Opis typu z rejestru — wołający wie już, że typ jest strukturalny. */
export function structuredSpecOf(type: StructuredSectionType): StructuredSectionSpec {
  return STRUCTURED_SECTIONS[type];
}

/**
 * PRZEŁĄCZENIE UKŁADU BEZ DOTYKANIA DANYCH (kontrakt bezstratności).
 *
 * Układ jest JEDNYM polem treści, więc jego zmiana z definicji nie może
 * dosięgnąć wpisów — i to jest cały sens trzymania go w danych zamiast
 * w kształcie treści. Funkcja istnieje po to, żeby ta gwarancja miała jedno
 * miejsce i jeden test (`layout A → B → A` daje treść identyczną co do klucza),
 * a nie żeby każdy wołający pisał własny spread.
 *
 * Układ spoza rejestru typu jest ignorowany: przełącznik szuflady bierze
 * warianty z rejestru, więc niezgodna nazwa znaczy błąd wołającego, a nie
 * decyzję operatora, którą trzeba zapisać.
 */
export function withStructuredLayout<T extends StructuredSectionContent>(
  content: T,
  layout: string,
): T {
  const spec = (STRUCTURED_SECTIONS as Record<string, StructuredSectionSpec | undefined>)[
    content.type
  ];
  if (!spec || !spec.layouts.includes(layout)) return content;
  if (content.layout === layout) return content;
  return { ...content, layout } as T;
}

/** Języki presetów — lustro PRESET_LOCALES z ./presets (parytet w CI). */
const STRUCTURED_PRESET_LOCALES = ["pl", "en"] as const;
type StructuredPresetLocale = (typeof STRUCTURED_PRESET_LOCALES)[number];

function localeOf(locale: string): StructuredPresetLocale {
  return (STRUCTURED_PRESET_LOCALES as readonly string[]).includes(locale)
    ? (locale as StructuredPresetLocale)
    : "pl";
}

/**
 * Treść startowa sekcji strukturalnej — GŁĘBOKA KOPIA (wołający ją mutuje
 * w stanie edytora, więc referencja do stałej modułu byłaby cichym błędem).
 */
export function structuredPresetFor(
  type: StructuredSectionType,
  locale: string,
): StructuredSectionContent {
  return structuredClone(
    STRUCTURED_SECTIONS[type].preset[localeOf(locale)],
  ) as unknown as StructuredSectionContent;
}

/** Świeży wpis listy dla przycisku „dodaj" w mini-CMS. */
export function structuredNewItemFor(type: StructuredSectionType, locale: string): unknown {
  return structuredClone(STRUCTURED_SECTIONS[type].newItem[localeOf(locale)]);
}

// -----------------------------------------------------------------------
// Operacje listy wpisów — czyste, wspólne dla wszystkich typów
// -----------------------------------------------------------------------

interface WithItems {
  items: unknown[];
}

function itemsOf(content: StructuredSectionContent): unknown[] {
  return (content as unknown as WithItems).items;
}

/** Wpis dopisany na końcu listy. Sufit z rejestru — powyżej zwraca wejście. */
export function appendStructuredItem<T extends StructuredSectionContent>(
  content: T,
  item: unknown,
): T {
  const spec = STRUCTURED_SECTIONS[content.type as StructuredSectionType];
  const items = itemsOf(content);
  if (items.length >= spec.maxItems) return content;
  return { ...content, items: [...items, item] } as T;
}

/** Wpis usunięty. Podłoga z rejestru — poniżej zwraca wejście (lista nie zniknie). */
export function removeStructuredItem<T extends StructuredSectionContent>(
  content: T,
  index: number,
): T {
  const spec = STRUCTURED_SECTIONS[content.type as StructuredSectionType];
  const items = itemsOf(content);
  if (index < 0 || index >= items.length || items.length <= spec.minItems) return content;
  return { ...content, items: items.filter((_, i) => i !== index) } as T;
}

/** Wpis przeniesiony na inną pozycję (strzałki i przeciąganie za uchwyt). */
export function moveStructuredItem<T extends StructuredSectionContent>(
  content: T,
  from: number,
  to: number,
): T {
  const items = itemsOf(content);
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return content;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...content, items: next } as T;
}

/** Jedno pole jednego wpisu — edycja w mini-CMS. */
export function patchStructuredItem<T extends StructuredSectionContent>(
  content: T,
  index: number,
  key: string,
  value: string,
): T {
  const items = itemsOf(content);
  if (index < 0 || index >= items.length) return content;
  const next = items.map((item, i) =>
    i === index ? { ...(item as Record<string, unknown>), [key]: value } : item,
  );
  return { ...content, items: next } as T;
}

// -----------------------------------------------------------------------
// FAQPage (schema.org) — NIESZKODLIWY DODATEK
// -----------------------------------------------------------------------

/**
 * Blok `FAQPage` dla opublikowanej strony albo `null`, gdy strona nie ma ani
 * jednej strukturalnej sekcji FAQ.
 *
 * ŚWIADOMIE BEZ OBIETNIC: wyszukiwarka wycofała bogate wyniki FAQ dla
 * większości stron (2026-05-07), więc ten blok NIE jest funkcją sprzedażową,
 * nie ma go w interfejsie operatora i nie ma o nim narracji w dokumentacji
 * produktu. Zostaje, bo poprawnie opisane dane pytań i odpowiedzi kosztują
 * kilkanaście linii i przydają się czytnikom oraz asystentom — a nie dlatego,
 * że coś obiecujemy.
 *
 * Serializację do `<script type="application/ld+json">` robi wołający
 * (storefront ma bramkę uciekania `serializeJsonLd`) — ten moduł zwraca DANE.
 */
export function faqPageJsonLd(
  sections: readonly { content: unknown }[],
): Record<string, unknown> | null {
  const pairs: { q: string; a: string }[] = [];
  for (const section of sections) {
    const content = section.content;
    if (!isStructuredSection(content) || content.type !== "faq") continue;
    for (const item of (content as FaqStructuredContent).items) {
      pairs.push({ q: item.q, a: item.a });
    }
  }
  if (pairs.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((pair) => ({
      "@type": "Question",
      name: pair.q,
      acceptedAnswer: { "@type": "Answer", text: pair.a },
    })),
  };
}
