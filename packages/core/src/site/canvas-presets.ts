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
  SECTION_CANVAS_VERSION,
  SECTION_MAX_ROWS,
  SECTION_MIN_ROWS,
  type CanvasElement,
  type Geometry,
  type SectionBackground,
  type SectionCanvas,
} from "./elements";
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
const PAD = 12;
/** Lewa krawędź pasa treści. */
const CONTENT_X = PAD;
/** Szerokość pasa treści (parzysta — prowadnica środka działa, patrz geometry.ts). */
const CONTENT_W = CANVAS_COLUMNS - 2 * PAD;
/** Odstęp od górnej krawędzi sekcji do pierwszego elementu. */
const TOP = 10;
/** Zapas pod ostatnim elementem — bez niego sekcje sklejałyby się wizualnie. */
const BOTTOM = 10;

/**
 * SKALE TEKSTU — ile znaków mieści się w wierszu na PEŁNEJ szerokości pasa
 * treści i ile jednostek siatki zajmuje jeden wiersz.
 *
 * Liczby są zmierzone na żywym renderze (szablon `classic`, płótno przy
 * szerokości projektowej), a nie zgadnięte. Pierwsza wersja konwersji miała
 * JEDNĄ gęstość dla wszystkich skal (~90 znaków w wierszu) i dlatego nagłówek
 * hero — idący skalą `landing-display`, czyli 72 px, gdzie w wierszu mieszczą
 * się ~22 znaki — wychodził poza swoje pudełko i NACHODZIŁ na tekst pod nim.
 * Widać to było dopiero na sklepie, przy szerokości, na której nagłówek łamie
 * się na dwa wiersze; w panelu, przy węższym płótnie, mieścił się w jednym.
 */
const TEXT_SCALES = {
  /** Nagłówek hero (`landing-display`, do 72 px). */
  display: { charsPerLine: 22, rowsPerLine: 10 },
  /** Nagłówek sekcji (`landing-heading`, do 48 px). */
  heading: { charsPerLine: 34, rowsPerLine: 7 },
  /** Tytuł bloku (poziom 3, ~18–20 px). */
  title: { charsPerLine: 44, rowsPerLine: 4 },
  /** Wprowadzenie (`lead`, ~20 px). */
  lead: { charsPerLine: 70, rowsPerLine: 4 },
  /** Akapit (16 px). */
  body: { charsPerLine: 90, rowsPerLine: 3 },
  /** Drobny tekst (14 px). */
  small: { charsPerLine: 100, rowsPerLine: 3 },
} as const;
export type TextScale = keyof typeof TEXT_SCALES;

/**
 * Wysokość pudełka tekstowego w jednostkach siatki. Estymator jest CELOWO
 * zgrubny — ma dać pudełko z zapasem, a nie zmierzyć font, którego ten pakiet
 * nie zna. Wąskie pudełko mieści proporcjonalnie mniej znaków w wierszu.
 */
export function textRows(
  text: string,
  scale: TextScale = "body",
  columns = CONTENT_W,
  minRows = 0,
): number {
  const { charsPerLine, rowsPerLine } = TEXT_SCALES[scale];
  const perLine = Math.max(8, Math.round((columns / CONTENT_W) * charsPerLine));
  const lines = Math.max(1, Math.ceil(text.trim().length / perLine));
  return Math.max(minRows, rowsPerLine, lines * rowsPerLine);
}

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
    ? Omit<E, "id" | "layout"> & { geometry: Geometry }
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
      const { geometry: box, ...rest } = element;
      // Jedyne rzutowanie w tym pliku: rozsypanie unii przez spread gubi
      // dyskryminator dla TS-a, choć w czasie wykonania `kind` jest na miejscu.
      elements.push({ ...rest, id: id(rest.kind), layout: { desktop: box } } as CanvasElement);
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
): SectionCanvas {
  const rows = Math.min(
    SECTION_MAX_ROWS,
    Math.max(SECTION_MIN_ROWS, built.bottom() + BOTTOM),
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
    built.add({
      kind: "button",
      label: content.ctaText,
      href: content.ctaHref,
      variant: "solid",
      align: "left",
      geometry: geometry(CONTENT_X, y, 40, 7),
    });
    y += 10;
  }

  if (content.imagePath) {
    // 16:9 z szerokości pasa treści: 120 kolumn = 960 px przy szerokości
    // projektowej, czyli 540 px wysokości = 68 jednostek.
    built.add({
      kind: "image",
      imagePath: content.imagePath,
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
      imagePath: item.imagePath,
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
    built.add({ kind: "icon", name: item.icon, tone: "accent", geometry: geometry(x, y, iconRows, iconRows) });
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

  built.add({
    kind: "button",
    label: content.buttonLabel,
    href: content.buttonHref,
    variant: "solid",
    align: "center",
    geometry: geometry(innerX, y, inner, 7, 1),
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
