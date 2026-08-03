/**
 * KONWERSJA SEKCJI v1 → PŁÓTNO v2 (K2, ADR-084).
 *
 * Jedna funkcja obsługuje DWA zastosowania, i to jest w niej najważniejsze:
 *   1. NOWA SEKCJA z galerii — bierze preset treści (A2, ADR-082) i od razu
 *      rodzi się jako płótno z elementami, więc operator nigdy nie widzi
 *      „pustej sekcji do wypełnienia formularzem";
 *   2. WYGASZANIE v1 — ta sama funkcja przerobi ISTNIEJĄCĄ treść tenanta, gdy
 *      przyjdzie pora zdjąć dwutorowość (plan w ADR-084). Gdyby presety i
 *      migracja były osobnym kodem, przez pół roku rozjechałyby się w szczególe,
 *      którego nikt nie pilnuje.
 *
 * UKŁAD STARTOWY NAŚLADUJE v1, ale nie udaje go co do piksela: sekcja v1 układa
 * się przepływem (odstępy zależą od długości tekstu), a v2 kładzie pudełka na
 * współrzędnych. Wysokości pudełek tekstowych liczy {@link textRows} — prosty,
 * DETERMINISTYCZNY estymator, żeby dłuższa treść dostała wyższe pudełko, a nie
 * wylała się poza nie już w chwili konwersji.
 *
 * Wszystkie liczby są w JEDNOSTKACH SIATKI (patrz `elements.ts`): oś pozioma to
 * 144 kolumny szerokości płótna, oś pionowa to jednostki po 8 px.
 */
import {
  CANVAS_COLUMNS,
  CANVAS_CONTENT_COLUMNS,
  CANVAS_PAD_COLUMNS,
  HUG_SIZE,
  SECTION_CANVAS_VERSION,
  SECTION_MAX_ROWS,
  SECTION_MIN_ROWS,
  withSize,
  type CanvasElement,
  type Geometry,
  type ImageSource,
  type SectionBackground,
  type SectionCanvas,
} from "./elements";
import { hugBox, textRows } from "./text-metrics";
import type {
  ContactContent,
  CtaContent,
  DeliveryContent,
  DirectionsContent,
  FaqContent,
  FreeformContent,
  GalleryContent,
  HeroContent,
  PricingContent,
  SectionContent,
  SectionType,
  TestimonialsContent,
  UspContent,
} from "./index";

/** Margines boczny płótna w kolumnach — pas treści to 120 z 144 kolumn. */
const PAD = CANVAS_PAD_COLUMNS;
/** Lewa krawędź pasa treści. */
const CONTENT_X = PAD;
/** Szerokość pasa treści (parzysta — prowadnica środka działa, patrz geometry.ts). */
const CONTENT_W = CANVAS_CONTENT_COLUMNS;
/** Odstęp od górnej krawędzi sekcji do pierwszego elementu. */
const TOP = 10;
/** Zapas pod ostatnim elementem — bez niego sekcje sklejałyby się wizualnie. */
const BOTTOM = 10;

// Estymator wysokości pudełka tekstowego mieszka od K4 w `text-metrics.ts` —
// tam, gdzie liczy z niego także auto-układ mobilny. Tutaj zostaje re-eksport,
// bo `textRows` jest publicznym wejściem pakietu od K2.
export { textRows, type TextScale } from "./text-metrics";

function geometry(x: number, y: number, w: number, h: number, z = 0): Geometry {
  return { x, y, w, h, z };
}

/**
 * Etykieta przycisku ma twardy limit 80 znaków, a treść v1, z której powstaje
 * (adres, zapytanie do map), bywa dłuższa. Bez przycięcia konwersja
 * produkowałaby płótno, którego nie da się zapisać — i wywracała się dopiero na
 * walidacji, daleko od przyczyny.
 */
function asLabel(text: string): string {
  return text.trim().slice(0, 80);
}

/**
 * Element w budowie: rodzaj i treść podaje wołający, identyfikator i warstwę
 * geometrii dokłada bufor. `Omit` na unii nie rozdziela się sam, więc typ jest
 * rozpisany dystrybutywnie — inaczej zostałyby z niego wyłącznie klucze wspólne
 * (czyli `kind`) i cała reszta pól przestałaby być sprawdzana.
 */
type ElementDraft = CanvasElement extends infer E
  ? E extends CanvasElement
    ? Omit<E, "id" | "layout" | "size"> & {
        geometry: Geometry;
        /**
         * Pudełko ma OBEJMOWAĆ TREŚĆ (K4, ADR-088). `geometry` jest wtedy
         * PASEM, w którym element ma stanąć — bufor podmienia jego szerokość
         * i wysokość na naturalny rozmiar treści, a `hugAlign` decyduje, czy
         * element przylega do lewej krawędzi pasa, czy stoi w jego środku.
         */
        hug?: boolean;
        hugAlign?: "left" | "center";
      }
    : never
  : never;

/**
 * Bufor budowy płótna: rozdaje kolejne identyfikatory i pilnuje, dokąd sięga
 * najniższy element (z tego wychodzi wysokość sekcji). Identyfikatory są
 * DETERMINISTYCZNE (`typ-rodzaj-n`), więc konwersja tej samej treści daje
 * bajtowo ten sam wynik — inaczej nie dałoby się jej porównać w teście ani
 * bezpiecznie powtórzyć przy wygaszaniu v1.
 */
function draft(type: SectionType) {
  const elements: CanvasElement[] = [];
  const counters = new Map<string, number>();

  function id(kind: string): string {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${type}-${kind}-${next}`;
  }

  return {
    elements,
    add(element: ElementDraft): void {
      const { geometry: box, hug, hugAlign, ...rest } = element;
      // Jedyne rzutowanie w tym pliku: rozsypanie unii przez spread gubi
      // dyskryminator dla TS-a, choć w czasie wykonania `kind` jest na miejscu.
      const built = { ...rest, id: id(rest.kind), layout: { desktop: box } } as CanvasElement;
      if (!hug) {
        elements.push(built);
        return;
      }
      // Naturalny rozmiar liczymy z GOTOWEGO elementu, więc estymator widzi
      // dokładnie tę treść i tę skalę, które trafią na stronę.
      const natural = hugBox(built) ?? { w: box.w, h: box.h };
      const x =
        hugAlign === "center"
          ? Math.max(0, box.x + Math.floor((box.w - natural.w) / 2))
          : box.x;
      elements.push(
        withSize(
          { ...built, layout: { desktop: { ...box, x, w: natural.w, h: natural.h } } } as CanvasElement,
          HUG_SIZE,
        ),
      );
    },
    /** Pierwsza wolna jednostka pod wszystkim, co już leży na płótnie. */
    bottom(): number {
      return elements.reduce(
        (lowest, element) => Math.max(lowest, element.layout.desktop.y + element.layout.desktop.h),
        0,
      );
    },
  };
}

function finish(
  built: ReturnType<typeof draft>,
  background: SectionBackground = "default",
  /**
   * Wysokość WYMUSZONA przez kompozycję. Sekcja z pełnokadrowym zdjęciem ma
   * wysokość, którą zadaje KADR, a nie długość napisu w niej — inaczej hero
   * z krótkim nagłówkiem byłby paskiem, a z długim plakatem.
   */
  forcedRows?: number,
): SectionCanvas {
  const rows = Math.min(
    SECTION_MAX_ROWS,
    Math.max(SECTION_MIN_ROWS, forcedRows ?? built.bottom() + BOTTOM),
  );
  return { version: SECTION_CANVAS_VERSION, rows, background, elements: built.elements };
}

/** Nagłówek sekcji (poziom 2) na pełnym pasie treści — wspólny początek sekcji. */
function addSectionHeading(built: ReturnType<typeof draft>, text: string | undefined, y: number): number {
  if (!text) return y;
  const h = textRows(text, "heading");
  built.add({ kind: "heading", text, level: 2, align: "left", geometry: geometry(CONTENT_X, y, CONTENT_W, h) });
  return y + h + 4;
}

/** Trzy kolumny pasa treści (galeria, atuty): 38 + 3 odstępu × 3 = 120. */
const COL3_W = 38;
const COL3_STEP = 41;
/** Dwie kolumny pasa treści: 58 + 4 odstępu × 2 = 120. */
const COL2_W = 58;
const COL2_STEP = 62;

function columnX(index: number, perRow: 2 | 3): number {
  const step = perRow === 3 ? COL3_STEP : COL2_STEP;
  return CONTENT_X + (index % perRow) * step;
}

// -----------------------------------------------------------------------
// Konwersje per typ
// -----------------------------------------------------------------------

function heroCanvas(content: HeroContent): SectionCanvas {
  const built = draft("hero");
  let y = TOP + 4;

  const headingRows = textRows(content.heading, "display");
  built.add({
    kind: "heading",
    text: content.heading,
    level: 1,
    align: "left",
    geometry: geometry(CONTENT_X, y, CONTENT_W, headingRows),
  });
  y += headingRows + 3;

  if (content.subheading) {
    const rows = textRows(content.subheading, "lead");
    built.add({
      kind: "text",
      text: content.subheading,
      variant: "lead",
      align: "left",
      geometry: geometry(CONTENT_X, y, CONTENT_W, rows),
    });
    y += rows + 3;
  }

  if (content.ctaText && content.ctaHref) {
    // Przycisk OBEJMUJE swoją etykietę (K4, ADR-088) — pas o szerokości 40
    // kolumn był pudełkiem na napis o dziesięciu znakach, a ramka zaznaczenia
    // obejmowała pustkę wokół niego.
    built.add({
      kind: "button",
      label: content.ctaText,
      href: content.ctaHref,
      variant: "solid",
      align: "left",
      geometry: geometry(CONTENT_X, y, 40, 7),
      hug: true,
    });
    y += 10;
  }

  if (content.imagePath) {
    // 16:9 z szerokości pasa treści: 120 kolumn = 960 px przy szerokości
    // projektowej, czyli 540 px wysokości = 68 jednostek.
    built.add({
      kind: "image",
      source: { kind: "storage", path: content.imagePath },
      alt: content.heading,
      fit: "cover",
      geometry: geometry(CONTENT_X, y, CONTENT_W, 68),
    });
  }

  return finish(built);
}

function productsCanvas(content: { heading?: string }): SectionCanvas {
  const built = draft("products");
  const y = addSectionHeading(built, content.heading, TOP);
  built.add({ kind: "catalog", geometry: geometry(CONTENT_X, y, CONTENT_W, 80) });
  return finish(built);
}

function pricingCanvas(content: PricingContent): SectionCanvas {
  const built = draft("pricing");
  const y = addSectionHeading(built, content.heading, TOP);
  if (content.note) {
    built.add({
      kind: "text",
      text: content.note,
      variant: "body",
      align: "left",
      geometry: geometry(CONTENT_X, y, CONTENT_W, textRows(content.note, "body")),
    });
  }
  return finish(built);
}

/**
 * FAQ traci składane pytania i to jest ŚWIADOMY koszt (ADR-084): przy geometrii
 * absolutnej rozwinięcie odpowiedzi nie miałoby czego zepchnąć w dół, więc
 * albo zasłoniłoby sąsiadów, albo zostawiłoby dziurę. Pytanie zostaje
 * nagłówkiem, odpowiedź tekstem — widoczne od razu, w pełni układalne.
 */
function faqCanvas(content: FaqContent): SectionCanvas {
  const built = draft("faq");
  let y = addSectionHeading(built, content.heading, TOP);
  for (const item of content.items) {
    const questionRows = textRows(item.q, "title");
    built.add({
      kind: "heading",
      text: item.q,
      level: 3,
      align: "left",
      geometry: geometry(CONTENT_X, y, CONTENT_W, questionRows),
    });
    y += questionRows + 1;
    const answerRows = textRows(item.a, "body");
    built.add({
      kind: "text",
      text: item.a,
      variant: "body",
      align: "left",
      geometry: geometry(CONTENT_X, y, CONTENT_W, answerRows),
    });
    y += answerRows + 4;
  }
  return finish(built);
}

function contactCanvas(content: ContactContent): SectionCanvas {
  const built = draft("contact");
  let y = addSectionHeading(built, content.heading, TOP);
  for (const line of [content.email, content.phone, content.address]) {
    if (!line) continue;
    const rows = textRows(line, "body");
    built.add({
      kind: "text",
      text: line,
      variant: "body",
      align: "left",
      geometry: geometry(CONTENT_X, y, CONTENT_W, rows),
    });
    y += rows + 1;
  }
  if (content.mapQuery) {
    // Zapytanie do map zamienia się w LINK (ta sama allowlista co przycisk CTA)
    // — v1 budował ten adres w renderze, v2 musi go mieć w treści, bo element
    // przycisku nie zna pojęcia „mapa".
    built.add({
      kind: "button",
      label: asLabel(content.mapQuery),
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(content.mapQuery)}`,
      variant: "outline",
      align: "left",
      geometry: geometry(CONTENT_X, y + 2, 44, 7),
      hug: true,
    });
  }
  return finish(built);
}

function freeformCanvas(content: FreeformContent): SectionCanvas {
  const built = draft("freeform");
  const y = addSectionHeading(built, content.heading, TOP);
  const rows = textRows(content.body, "body");
  built.add({
    kind: "text",
    text: content.body,
    variant: "body",
    align: "left",
    geometry: geometry(CONTENT_X, y, CONTENT_W, rows),
  });
  return finish(built);
}

/**
 * Wysokość WSPÓLNA dla wszystkich kafli w siatce. Kafle w jednym rzędzie muszą
 * być równe (inaczej rząd wygląda na rozsypany), a rzędy nie mogą na siebie
 * wchodzić — dlatego bierzemy najwyższy potrzebny blok, a nie stałą.
 */
function tallest(values: number[], floor: number): number {
  return values.reduce((highest, value) => Math.max(highest, value), floor);
}

function testimonialsCanvas(content: TestimonialsContent): SectionCanvas {
  const built = draft("testimonials");
  const top = addSectionHeading(built, content.heading, TOP);
  const inner = COL2_W - 6;
  const quoteRows = tallest(
    content.items.map((item) => textRows(item.quote, "lead", inner)),
    8,
  );
  // 3 (górny margines) + cytat + 2 (odstęp) + 4 (podpis) + 3 (dolny margines)
  const cardRows = quoteRows + 12;
  content.items.forEach((item, index) => {
    const x = columnX(index, 2);
    const y = top + Math.floor(index / 2) * (cardRows + 4);
    built.add({ kind: "shape", shape: "box", fill: "paper", geometry: geometry(x, y, COL2_W, cardRows) });
    built.add({
      kind: "text",
      text: item.quote,
      variant: "lead",
      align: "left",
      geometry: geometry(x + 3, y + 3, inner, quoteRows, 1),
    });
    built.add({
      kind: "text",
      text: item.role ? `${item.author} — ${item.role}` : item.author,
      variant: "small",
      align: "left",
      geometry: geometry(x + 3, y + 3 + quoteRows + 2, inner, 4, 1),
    });
  });
  return finish(built);
}

function galleryCanvas(content: GalleryContent): SectionCanvas {
  const built = draft("gallery");
  const top = addSectionHeading(built, content.heading, TOP);
  // 4:3 z kolumny 38 jednostek (304 px przy szerokości projektowej) = 28 jednostek.
  const tileRows = 28;
  content.items.forEach((item, index) => {
    built.add({
      kind: "image",
      source: { kind: "storage", path: item.imagePath },
      alt: item.alt,
      fit: "cover",
      geometry: geometry(columnX(index, 3), top + Math.floor(index / 3) * (tileRows + 3), COL3_W, tileRows),
    });
  });
  return finish(built);
}

function uspCanvas(content: UspContent): SectionCanvas {
  const built = draft("usp");
  const top = addSectionHeading(built, content.heading, TOP);
  const titleRows = tallest(content.items.map((item) => textRows(item.title, "title", COL3_W)), 4);
  const textRowsMax = tallest(content.items.map((item) => textRows(item.text, "small", COL3_W)), 6);
  const iconRows = 6;
  content.items.forEach((item, index) => {
    const x = columnX(index, 3);
    const blockRows = iconRows + 2 + titleRows + 1 + textRowsMax;
    const y = top + Math.floor(index / 3) * (blockRows + 4);
    built.add({
      kind: "icon",
      name: item.icon,
      tone: "accent",
      geometry: geometry(x, y, iconRows, iconRows),
      hug: true,
    });
    built.add({
      kind: "heading",
      text: item.title,
      level: 3,
      align: "left",
      geometry: geometry(x, y + iconRows + 2, COL3_W, titleRows),
    });
    built.add({
      kind: "text",
      text: item.text,
      variant: "small",
      align: "left",
      geometry: geometry(x, y + iconRows + 2 + titleRows + 1, COL3_W, textRowsMax),
    });
  });
  return finish(built);
}

function ctaCanvas(content: CtaContent): SectionCanvas {
  const built = draft("cta");
  const bannerTop = TOP;
  const inner = CONTENT_W - 16;
  const innerX = CONTENT_X + 8;
  let y = bannerTop + 6;

  const headingRows = textRows(content.heading, "heading", inner);
  built.add({
    kind: "heading",
    text: content.heading,
    level: 2,
    align: "center",
    geometry: geometry(innerX, y, inner, headingRows, 1),
  });
  y += headingRows + 2;

  if (content.text) {
    const rows = textRows(content.text, "body", inner);
    built.add({
      kind: "text",
      text: content.text,
      variant: "body",
      align: "center",
      geometry: geometry(innerX, y, inner, rows, 1),
    });
    y += rows + 2;
  }

  // Baner ma przycisk na ŚRODKU: przy pudełku obejmującym treść wyrównanie nie
  // ma już czego przesuwać wewnątrz pudełka, więc środkuje się SAMO PUDEŁKO.
  built.add({
    kind: "button",
    label: content.buttonLabel,
    href: content.buttonHref,
    variant: "solid",
    align: "center",
    geometry: geometry(innerX, y, inner, 7, 1),
    hug: true,
    hugAlign: "center",
  });
  y += 7;

  // Baner rysuje się POD treścią (warstwa 0), więc powstaje na końcu — dopiero
  // wtedy znana jest wysokość, którą ma objąć.
  built.add({
    kind: "shape",
    shape: "box",
    fill: "paper",
    geometry: geometry(CONTENT_X, bannerTop, CONTENT_W, y - bannerTop + 6, 0),
  });
  return finish(built);
}

function directionsCanvas(content: DirectionsContent): SectionCanvas {
  const built = draft("directions");
  let y = TOP;
  for (const line of [content.address, content.hours]) {
    if (!line) continue;
    const rows = textRows(line, "body");
    built.add({
      kind: "text",
      text: line,
      variant: "body",
      align: "left",
      geometry: geometry(CONTENT_X, y, CONTENT_W, rows),
    });
    y += rows + 1;
  }
  if (content.mapsUrl) {
    built.add({
      kind: "button",
      label: asLabel(content.address),
      href: content.mapsUrl,
      variant: "outline",
      align: "left",
      geometry: geometry(CONTENT_X, y + 2, 44, 7),
      hug: true,
    });
  }
  return finish(built);
}

function deliveryCanvas(content: DeliveryContent): SectionCanvas {
  const built = draft("delivery");
  let y = addSectionHeading(built, content.heading, TOP);
  const leadRows = textRows(content.text, "lead");
  built.add({
    kind: "text",
    text: content.text,
    variant: "lead",
    align: "left",
    geometry: geometry(CONTENT_X, y, CONTENT_W, leadRows),
  });
  y += leadRows + 4;

  const items = content.items ?? [];
  const inner = COL2_W - 6;
  const titleRows = tallest(items.map((item) => textRows(item.title, "title", inner)), 4);
  const bodyRows = tallest(items.map((item) => textRows(item.text, "small", inner)), 6);
  // 3 (górny margines) + tytuł + 1 (odstęp) + opis + 3 (dolny margines)
  const cardRows = titleRows + bodyRows + 7;
  for (const [index, item] of items.entries()) {
    const x = columnX(index, 2);
    const top = y + Math.floor(index / 2) * (cardRows + 4);
    built.add({ kind: "shape", shape: "box", fill: "paper", geometry: geometry(x, top, COL2_W, cardRows) });
    built.add({
      kind: "heading",
      text: item.title,
      level: 3,
      align: "left",
      geometry: geometry(x + 3, top + 3, inner, titleRows, 1),
    });
    built.add({
      kind: "text",
      text: item.text,
      variant: "small",
      align: "left",
      geometry: geometry(x + 3, top + 3 + titleRows + 1, inner, bodyRows, 1),
    });
  }
  return finish(built);
}

/**
 * Treść sekcji v1 → płótno v2. Typ jest tu WIĄŻĄCY (mówi, jak czytać treść),
 * a wynik zawsze spełnia `sectionCanvasSchema` — pilnuje tego kontrakt, który
 * parsuje wynik konwersji KAŻDEGO z dwunastu typów.
 */
export function sectionCanvasFrom(type: SectionType, content: SectionContent): SectionCanvas {
  switch (type) {
    case "hero":
      return heroCanvas(content as HeroContent);
    case "products":
      return productsCanvas(content as { heading?: string });
    case "pricing":
      return pricingCanvas(content as PricingContent);
    case "faq":
      return faqCanvas(content as FaqContent);
    case "contact":
      return contactCanvas(content as ContactContent);
    case "freeform":
      return freeformCanvas(content as FreeformContent);
    case "testimonials":
      return testimonialsCanvas(content as TestimonialsContent);
    case "gallery":
      return galleryCanvas(content as GalleryContent);
    case "usp":
      return uspCanvas(content as UspContent);
    case "cta":
      return ctaCanvas(content as CtaContent);
    case "directions":
      return directionsCanvas(content as DirectionsContent);
    case "delivery":
      return deliveryCanvas(content as DeliveryContent);
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

// -----------------------------------------------------------------------
// KOMPOZYCJE — układ, który niesie ZDJĘCIE (K5 v2, ADR-090)
// -----------------------------------------------------------------------
//
// Sześć szablonów startowych ma być sześcioma RÓŻNYMI ŚWIATAMI, a nie jednym
// układem w sześciu skórkach. Kolor i krój załatwia motyw; drugą połową
// różnicy jest KADR — to, czy strona zaczyna się od nagłówka na pełnoekranowym
// zdjęciu, od zdjęcia obok tekstu, czy od samego tekstu.
//
// Kompozycje są ZAMKNIĘTYM SŁOWNIKIEM i mieszkają tu, a nie w szablonach,
// z tego samego powodu, dla którego motyw jest rejestrem: szablon nr 7 ma
// wybrać archetyp NAZWĄ, a nie wnieść własną geometrię. Ręcznie wpisane
// współrzędne w szablonie byłyby drugą, nietestowaną definicją układu —
// rozjechałyby się po cichu z estymatorem pudełek i pierwsza poprawka copy
// wsadzałaby nagłówek w akapit pod nim.
//
// WSZYSTKIE liczby niżej przechodzą przez ten sam estymator (`textRows`), co
// reszta konwersji, więc pudełka obejmują treść, a auto-układ mobilny (ADR-088)
// wyprowadza z nich kolumnę bez jednej dodatkowej liczby.

/** Archetypy kadru. `stack` to zachowanie sprzed K5 v2 — sam tekst w kolumnie. */
export const SECTION_COMPOSITIONS = ["stack", "overlay", "split", "band"] as const;
export type SectionComposition = (typeof SECTION_COMPOSITIONS)[number];

/**
 * Zdjęcie sekcji. `source` jest OPCJONALNE i to jest celowe: układ ma być
 * identyczny, zanim zdjęcie zostanie wyselekcjonowane, i po tym, jak wejdzie.
 * Element bez źródła renderuje się jako kafel zastępczy, więc geometria
 * szablonu nie zależy od tego, czy kuracja zdjęć już się odbyła.
 */
export interface SectionMedia {
  alt: string;
  source?: ImageSource;
}

/** Wysokość pełnokadrowego hero w jednostkach siatki (≈ 1160 px przy szerokości projektowej). */
const OVERLAY_MIN_ROWS = 96;
/** Wysokość hero rozdzielonego (tekst obok zdjęcia). */
const SPLIT_MIN_ROWS = 76;
/** Szerokość pasa tekstu w kompozycji `split` — reszta idzie na kadr. */
const SPLIT_TEXT_W = 60;
/** Lewa krawędź zdjęcia w `split`: kadr dochodzi do prawej krawędzi płótna. */
const SPLIT_MEDIA_X = 80;
/** Wysokość pasa zdjęciowego pod treścią (`band`) — 16:9 z pasa treści. */
const BAND_MEDIA_ROWS = 56;

/**
 * ZAPAS NA KRÓJ MOTYWU (K5 v2, ADR-090).
 *
 * Estymator wierszy (`textRows`, ADR-088) liczy je dla znaku o średniej
 * szerokości kroju BAZOWEGO. Motywy wnoszą kroje plakatowe — Archivo 800,
 * Space Grotesk 700, Playfair 500 — których znaki są szersze o kilkanaście
 * procent przy tym samym stopniu pisma. Nagłówek zawija się więc WCZEŚNIEJ,
 * niż wynika z estymatora, i wchodzi w akapit pod sobą.
 *
 * Odpowiedzią NIE jest poprawka estymatora: liczy on wysokość pudełek dla
 * całej zapisanej treści tenantów i zmiana jego stałych przeliczyłaby wstecz
 * układy, których nikt nie ogląda. Kompozycje liczą zamiast tego wysokość dla
 * pasa WĘŻSZEGO, niż jest naprawdę — dostają wtedy pudełko z zapasem, a sam
 * estymator zostaje nietknięty.
 */
const TYPE_SAFETY = 0.92;

/**
 * Szerokość, dla której liczymy wysokość tekstu: pas przemnożony przez zapas
 * i przez WZGLĘDNĄ SZEROKOŚĆ ZNAKU kroju nagłówkowego (`metricRatio` z rejestru
 * krojów). Bez drugiego czynnika jeden zapas obsługiwałby oba skrajne
 * przypadki naraz — plakatowy Archivo wychodziłby poza pudełko, a wąski
 * Instrument Serif zostawiał pod nagłówkiem pół ekranu pustki.
 */
function estimateWidth(columns: number, metricRatio = 1): number {
  return Math.max(8, Math.round(columns * TYPE_SAFETY * metricRatio));
}

/** Warstwy kompozycji: zdjęcie na spodzie, welon nad nim, treść na wierzchu. */
const Z_MEDIA = 0;
const Z_SCRIM = 1;
const Z_CONTENT = 2;

/**
 * Blok tekstowy hero: nagłówek, podtytuł i przycisk w zadanym pasie.
 * Wspólny dla WSZYSTKICH kompozycji hero — różni je kadr, nie treść, więc
 * odstępy i skale mają być dosłownie tym samym kodem.
 */
function heroTextBlock(
  built: ReturnType<typeof draft>,
  content: HeroContent,
  box: { x: number; w: number; top: number; z: number; color?: "onScrim" },
  metricRatio = 1,
): number {
  let y = box.top;

  const headingRows = textRows(content.heading, "display", estimateWidth(box.w, metricRatio));
  built.add({
    kind: "heading",
    text: content.heading,
    level: 1,
    align: "left",
    ...(box.color ? { color: box.color } : {}),
    geometry: geometry(box.x, y, box.w, headingRows, box.z),
  });
  y += headingRows + 3;

  if (content.subheading) {
    // Lead idzie krojem TEKSTOWYM (nie nagłówkowym), więc bez współczynnika rodziny.
    const rows = textRows(content.subheading, "lead", estimateWidth(box.w));
    built.add({
      kind: "text",
      text: content.subheading,
      variant: "lead",
      align: "left",
      // Na welonie lead idzie kolorem PODSTAWOWYM welonu, nie przygaszonym:
      // przygaszenie na zdjęciu jest jedynym miejscem, którego bramka nie
      // potrafi obronić liczbą (patrz SCRIM_ALPHA).
      ...(box.color ? { color: box.color } : {}),
      geometry: geometry(box.x, y, box.w, rows, box.z),
    });
    y += rows + 3;
  }

  if (content.ctaText && content.ctaHref) {
    built.add({
      kind: "button",
      label: content.ctaText,
      href: content.ctaHref,
      variant: "solid",
      align: "left",
      geometry: geometry(box.x, y, 40, 7, box.z),
      hug: true,
    });
    y += 10;
  }

  return y;
}

/**
 * HERO NA PEŁNYM KADRZE. Zdjęcie od krawędzi do krawędzi, na nim WELON
 * (kształt `scrim`), na welonie tekst.
 *
 * Welon nie jest ozdobą: tło pod tekstem jest wtedy ZDJĘCIEM, którego najemca
 * może podmienić na dowolne, więc kontrast tekstu byłby nie do policzenia.
 * Welon zamienia nieznane tło w znane i dopiero to daje się obronić bramką
 * (patrz SCRIM_ALPHA w ./theme oraz kontrakt kontrastu).
 *
 * Tekst siedzi w DOLNEJ części kadru — tak, jak w plakacie: górna połowa
 * zostaje zdjęciu, dolna niesie obietnicę i przycisk.
 */
function heroOverlayCanvas(content: HeroContent, media: SectionMedia | undefined, metricRatio: number): SectionCanvas {
  const built = draft("hero");

  // Wysokość liczymy z treści, ale nie schodzimy poniżej kadru kinowego.
  const probe = draft("hero");
  const contentRows = heroTextBlock(probe, content, { x: CONTENT_X, w: CONTENT_W, top: 0, z: Z_CONTENT }, metricRatio);
  const rows = Math.max(OVERLAY_MIN_ROWS, contentRows + 30);

  built.add({
    kind: "image",
    ...(media?.source ? { source: media.source } : {}),
    alt: media?.alt ?? content.heading,
    fit: "cover",
    geometry: geometry(0, 0, CANVAS_COLUMNS, rows, Z_MEDIA),
  });
  built.add({
    kind: "shape",
    shape: "box",
    fill: "scrim",
    geometry: geometry(0, 0, CANVAS_COLUMNS, rows, Z_SCRIM),
  });
  heroTextBlock(
    built,
    content,
    { x: CONTENT_X, w: CONTENT_W, top: rows - contentRows - 14, z: Z_CONTENT, color: "onScrim" },
    metricRatio,
  );

  return finish(built, "default", rows);
}

/**
 * HERO ROZDZIELONY: tekst w lewym pasie, kadr od jego prawej krawędzi do
 * krawędzi płótna. Tekst liczy się w SWOJEJ szerokości — dlatego blok dostaje
 * `SPLIT_TEXT_W`, a nie pas treści: gdyby liczył się w pełnej szerokości,
 * nagłówek zawijałby się na stronie inaczej niż w estymatorze i wchodził
 * w akapit pod sobą.
 */
function heroSplitCanvas(content: HeroContent, media: SectionMedia | undefined, metricRatio: number): SectionCanvas {
  const built = draft("hero");

  const probe = draft("hero");
  const contentRows = heroTextBlock(
    probe,
    content,
    { x: CONTENT_X, w: SPLIT_TEXT_W, top: 0, z: Z_CONTENT },
    metricRatio,
  );
  const rows = Math.max(SPLIT_MIN_ROWS, contentRows + 24);

  built.add({
    kind: "image",
    ...(media?.source ? { source: media.source } : {}),
    alt: media?.alt ?? content.heading,
    fit: "cover",
    geometry: geometry(SPLIT_MEDIA_X, 0, CANVAS_COLUMNS - SPLIT_MEDIA_X, rows, Z_MEDIA),
  });
  heroTextBlock(
    built,
    content,
    { x: CONTENT_X, w: SPLIT_TEXT_W, top: Math.max(TOP, Math.floor((rows - contentRows) / 2)), z: Z_CONTENT },
    metricRatio,
  );

  return finish(built, "default", rows);
}

/**
 * PAS ZDJĘCIOWY POD TREŚCIĄ — kompozycja dla sekcji, które nie są hero.
 * Zdjęcie idzie na pasie treści (nie od krawędzi), bo pełni tu rolę ilustracji,
 * a nie kadru otwierającego.
 *
 * Zdjęć może być kilka: dwa albo trzy kafle w rzędzie dzielą pas treści tak
 * samo, jak siatka atutów i galerii wyżej (te same stałe kolumn), więc rząd
 * zdjęć w szablonie jest tym samym układem, co rząd zdjęć dodany ręcznie.
 */
function withMediaBand(
  canvas: SectionCanvas,
  media: readonly SectionMedia[],
  type: SectionType,
): SectionCanvas {
  if (media.length === 0) return canvas;

  const bottom = canvas.elements.reduce(
    (lowest, element) => Math.max(lowest, element.layout.desktop.y + element.layout.desktop.h),
    0,
  );
  const y = bottom + 6;
  const perRow = media.length >= 3 ? 3 : media.length === 2 ? 2 : 1;
  const width = perRow === 3 ? COL3_W : perRow === 2 ? COL2_W : CONTENT_W;
  const step = perRow === 3 ? COL3_STEP : perRow === 2 ? COL2_STEP : 0;
  // Proporcja kadru zachowana przy każdej liczbie kafli: wysokość idzie za
  // szerokością (16:9 dla pełnego pasa, 4:3 dla kolumn), więc rząd nie
  // rozjeżdża się przy dwóch zdjęciach zamiast trzech.
  const rows = perRow === 1 ? BAND_MEDIA_ROWS : Math.round((width * 3) / 4);

  const tiles: CanvasElement[] = media.map((item, index) => ({
    id: `${type}-image-band-${index + 1}`,
    kind: "image",
    ...(item.source ? { source: item.source } : {}),
    alt: item.alt,
    fit: "cover",
    layout: { desktop: geometry(CONTENT_X + index * step, y, width, rows) },
  }));

  return {
    ...canvas,
    rows: Math.min(SECTION_MAX_ROWS, y + rows + BOTTOM),
    elements: [...canvas.elements, ...tiles],
  };
}

/**
 * Treść sekcji v1 + ARCHETYP KADRU → płótno v2.
 *
 * Trzecim argumentem posługują się WYŁĄCZNIE szablony startowe; galeria „dodaj
 * sekcję" woła tę funkcję jak dotąd, dwuargumentowo, i dostaje dokładnie to samo
 * płótno co przed K5 v2 (`stack`). Dzięki temu kompozycje nie zmieniają ani
 * jednego piksela w istniejącej ścieżce dodawania sekcji.
 */
export function sectionCanvasWith(
  type: SectionType,
  content: SectionContent,
  options: {
    composition?: SectionComposition;
    media?: readonly SectionMedia[];
    /** Względna szerokość znaku kroju nagłówkowego motywu (patrz `metricRatio`). */
    metricRatio?: number;
  } = {},
): SectionCanvas {
  const { composition = "stack", media, metricRatio = 1 } = options;

  if (type === "hero" && composition === "overlay") {
    return heroOverlayCanvas(content as HeroContent, media?.[0], metricRatio);
  }
  if (type === "hero" && composition === "split") {
    return heroSplitCanvas(content as HeroContent, media?.[0], metricRatio);
  }

  const base = sectionCanvasFrom(type, content);
  if (composition === "band" && media) return withMediaBand(base, media, type);
  return base;
}
