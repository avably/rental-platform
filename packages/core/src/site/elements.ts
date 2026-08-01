/**
 * SCHEMAT TREŚCI SEKCJI v2 — PŁÓTNO Z ELEMENTAMI (K2, ADR-084).
 *
 * Do K1 sekcja była FORMULARZEM: typ narzucał układ, a operator wypełniał pola.
 * Od K2 sekcja jest PŁÓTNEM: niesie listę elementów, z których każdy ma własną
 * geometrię `{x,y,w,h,z}`. Kształt mieszka tu, bo to model domenowy — panel nim
 * waliduje zapis do `content_draft`, storefront parsuje nim `content_published`,
 * a renderer (@avably/ui) rysuje dokładnie to, co przeszło przez te schematy.
 *
 * BEZ MIGRACJI. Treść sekcji to `jsonb` (0019), więc v2 wchodzi tą samą kolumną
 * co v1; rozpoznanie wersji niesie SAMA TREŚĆ (`version: 2`), a nie kolumna
 * obok. Sekcje zapisane przed K2 zostają w kształcie v1 i renderują się starymi
 * komponentami — dwutorowość i plan wygaszenia opisuje ADR-084.
 *
 * ================== MIARA GEOMETRII ==================
 *
 * Oś POZIOMA jest PROPORCJONALNA: `x`/`w` to kolumny płótna (0…144), a render
 * przelicza je na procent szerokości płótna. Oś PIONOWA jest STAŁA: `y`/`h` to
 * jednostki po {@link GRID_UNIT_PX} px. Przy szerokości projektowej płótna
 * ({@link CANVAS_DESIGN_WIDTH_PX} = 144 × 8 px) siatka jest KWADRATOWA, więc
 * „jeden w prawo" i „jeden w dół" znaczą to samo.
 *
 * Miarą osi poziomej jest PŁÓTNO SEKCJI (kontener), nigdy okno — to ta sama
 * zasada, którą K1b wprowadził dla wariantów responsywnych (ADR-085). Gdyby
 * geometria liczyła się z szerokości okna, płótno kreatora zwężone do 390 px
 * znowu pokazywałoby co innego niż sklep na telefonie.
 *
 * Cena absolutu jest znana i przyjęta świadomie (plan Kreatora 2.0, decyzja 3):
 * układ desktopowy zwężony do telefonu robi się ciasny, dlatego geometria jest
 * PER BREAKPOINT — `desktop` jest źródłem prawdy, a `mobile` to delta, którą
 * EDYTUJE dopiero K4. K2 zapisuje wyłącznie `desktop`.
 */
import { z } from "zod";

import { USP_ICONS, uspIconSchema } from "./icons";

// -----------------------------------------------------------------------
// Siatka płótna — parametry gęstości (ADR-084)
// -----------------------------------------------------------------------

/**
 * Liczba kolumn płótna. 144 = 16 × 9, więc połówki (72), tercje (48), ćwiartki
 * (36), szóstki, ósemki i dwunastki wypadają na LICZBACH CAŁKOWITYCH — element
 * „na pół szerokości" nie wymaga ułamka, a prowadnica środka trafia dokładnie
 * w kolumnę. Gęstsza siatka (np. 960 „pikseli") kusi precyzją, ale odbiera
 * przyciąganiu sens: wszystko jest wtedy „prawie równo".
 */
export const CANVAS_COLUMNS = 144;

/**
 * Jednostka siatki w pikselach przy szerokości projektowej. Osiem pikseli to
 * ta sama baza, na której stoi rozstaw interfejsu — a przy 144 kolumnach daje
 * płótno 1152 px (72 rem), czyli szerokość projektową o znanej wartości.
 */
export const GRID_UNIT_PX = 8;

/**
 * Szerokość PROJEKTOWA płótna: przy niej kolumna ma dokładnie
 * {@link GRID_UNIT_PX} px i siatka jest kwadratowa. Renderer ogranicza płótno
 * do tej szerokości i centruje je — bez sufitu ta sama strona na monitorze
 * 2560 px rozciągałaby wiersze tekstu do nieczytelnej długości, a operator
 * projektowałby układ, którego nigdy nie zobaczy.
 */
export const CANVAS_DESIGN_WIDTH_PX = CANVAS_COLUMNS * GRID_UNIT_PX;

/** Najniższa sensowna sekcja: 8 jednostek = 64 px (pasek, separator). */
export const SECTION_MIN_ROWS = 8;

/** Sufit wysokości sekcji: 240 jednostek = 1920 px. Sekcja, nie cała strona. */
export const SECTION_MAX_ROWS = 240;

/** Sufit liczby elementów w JEDNEJ sekcji — strona, nie edytor grafiki. */
export const MAX_ELEMENTS_PER_SECTION = 60;

/**
 * Zasięg przyciągania do krawędzi i środków sąsiadów, w jednostkach siatki.
 * Jedna jednostka = 8 px przy szerokości projektowej — tyle, ile trzeba, by
 * „prawie równo" samo skoczyło na „równo", i za mało, by przyciąganie zaczęło
 * wyrywać element z ręki.
 */
export const GUIDE_TOLERANCE_UNITS = 1;

/** Wersja kształtu treści sekcji. Rozpoznanie v1/v2 idzie po TEJ liczbie. */
export const SECTION_CANVAS_VERSION = 2;

// -----------------------------------------------------------------------
// Geometria
// -----------------------------------------------------------------------

/**
 * Geometria elementu w jednostkach siatki. Wszystko całkowite — ułamek
 * jednostki nie jest ani widoczny, ani odtwarzalny po zaokrągleniu w renderze,
 * a psuje porównywanie geometrii w testach i przyciąganie.
 *
 * `z` to warstwa (wyżej = na wierzchu). Zamknięty zakres, bo z-index bez sufitu
 * potrafi przykryć warstwę edycyjną kreatora albo dialogi panelu.
 */
export const geometrySchema = z
  .object({
    x: z.number().int().min(0).max(CANVAS_COLUMNS),
    y: z.number().int().min(0).max(SECTION_MAX_ROWS),
    w: z.number().int().min(1).max(CANVAS_COLUMNS),
    h: z.number().int().min(1).max(SECTION_MAX_ROWS),
    z: z.number().int().min(0).max(999),
  })
  .strict();
export type Geometry = z.infer<typeof geometrySchema>;

/**
 * Geometria PER BREAKPOINT. `desktop` jest źródłem prawdy i jedynym, co
 * zapisuje K2; `mobile` to opcjonalna DELTA — struktura jest gotowa, edycję
 * wnosi K4 (auto-wyprowadzenie układu + ręczne poprawki). Osobne pole zamiast
 * osobnej sekcji, bo to ten sam element, tylko inaczej ułożony.
 */
export const elementLayoutSchema = z
  .object({
    desktop: geometrySchema,
    mobile: geometrySchema.optional(),
  })
  .strict();
export type ElementLayout = z.infer<typeof elementLayoutSchema>;

/** Breakpointy geometrii. `desktop` źródłowy — patrz nagłówek pliku. */
export const CANVAS_BREAKPOINTS = ["desktop", "mobile"] as const;
export type CanvasBreakpoint = (typeof CANVAS_BREAKPOINTS)[number];

// -----------------------------------------------------------------------
// Cegiełki treści elementów
// -----------------------------------------------------------------------

const elementId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Identyfikator elementu: małe litery, cyfry i myślniki.");

const elementHeading = z.string().trim().min(1).max(200);
const elementText = z.string().trim().min(1).max(10_000);
const elementLabel = z.string().trim().min(1).max(80);
const elementAlt = z.string().trim().min(1).max(300);

/**
 * Cel przycisku — ta sama allowlista schematów co `ctaHref` w v1: http(s),
 * ścieżka względna albo kotwica. `javascript:` i `data:` odpadają z definicji,
 * a nie z listy zakazów, więc przyszły egzotyczny schemat też nie przejdzie.
 */
const elementHref = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine(
    (value) => {
      if (value.startsWith("/") || value.startsWith("#")) return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Dozwolone: adres http(s), ścieżka względna (/...) albo kotwica (#...)" },
  );

/** Ścieżka w buckecie `site-images` (konwencja 0018) — nie dowolny URL. */
const elementImagePath = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine((value) => !value.includes("..") && !value.includes("://"), {
    message: "Ścieżka Storage, nie URL",
  });

/** Wyrównanie treści w PUDEŁKU elementu (pudełko wyznacza geometria). */
export const ELEMENT_ALIGNMENTS = ["left", "center", "right"] as const;
export type ElementAlignment = (typeof ELEMENT_ALIGNMENTS)[number];
const alignment = z.enum(ELEMENT_ALIGNMENTS).default("left");

/**
 * Poziomy nagłówka. Trzy, nie sześć: to skala WIZUALNA szablonu (display /
 * nagłówek sekcji / tytuł bloku), a nie drzewo dokumentu — poziom 1 zostaje
 * jeden na stronę, bo taki nagłówek niesie preset hero.
 */
export const HEADING_LEVELS = [1, 2, 3] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export const TEXT_VARIANTS = ["lead", "body", "small"] as const;
export type TextVariant = (typeof TEXT_VARIANTS)[number];

export const BUTTON_VARIANTS = ["solid", "outline"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const IMAGE_FITS = ["cover", "contain"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

export const SHAPE_KINDS = ["box", "divider"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SHAPE_FILLS = ["none", "paper", "accent", "ink"] as const;
export type ShapeFill = (typeof SHAPE_FILLS)[number];

export const ICON_TONES = ["accent", "muted"] as const;
export type IconTone = (typeof ICON_TONES)[number];

/** Tło płótna sekcji — pas jasny, przygaszony albo odwrócony (ciemny). */
export const SECTION_BACKGROUNDS = ["default", "muted", "inverted"] as const;
export type SectionBackground = (typeof SECTION_BACKGROUNDS)[number];

// -----------------------------------------------------------------------
// Elementy — unia dyskryminowana po `kind`
// -----------------------------------------------------------------------
//
// Zbiór jest MINIMALNY i wynika wprost z konwersji dwunastu typów sekcji
// (ADR-084): wszystko, co dawne sekcje rysowały statycznie, składa się z
// nagłówka, tekstu, przycisku, obrazu, ikony i kształtu. Siódmy rodzaj —
// `catalog` — jest jedynym, którego treść pochodzi z BAZY, a nie od operatora:
// listy produktów nie da się ułożyć ręcznie, bo jej długość zmienia się po
// stronie katalogu, a nie po stronie strony.

const elementBase = { id: elementId, layout: elementLayoutSchema } as const;

export const headingElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("heading"),
    text: elementHeading,
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    align: alignment,
  })
  .strict();

export const textElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("text"),
    text: elementText,
    variant: z.enum(TEXT_VARIANTS).default("body"),
    align: alignment,
  })
  .strict();

export const buttonElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("button"),
    label: elementLabel,
    href: elementHref,
    variant: z.enum(BUTTON_VARIANTS).default("solid"),
    align: alignment,
  })
  .strict();

export const imageElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("image"),
    /** Brak ścieżki = kafel zastępczy. Element istnieje w układzie, zanim wejdzie zdjęcie. */
    imagePath: elementImagePath.optional(),
    alt: elementAlt,
    fit: z.enum(IMAGE_FITS).default("cover"),
  })
  .strict();

export const iconElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("icon"),
    /** Allowlista `lucide` wspólna z sekcją USP (ADR-082) — zamknięty zbiór. */
    name: uspIconSchema,
    tone: z.enum(ICON_TONES).default("accent"),
  })
  .strict();

export const shapeElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("shape"),
    shape: z.enum(SHAPE_KINDS).default("box"),
    fill: z.enum(SHAPE_FILLS).default("paper"),
  })
  .strict();

/**
 * Siatka produktów z katalogu tenanta. Element NIE niesie pozycji — niesie
 * MIEJSCE, w którym render wstawia katalog. Nagłówek sekcji produktów jest
 * osobnym elementem `heading`, więc operator może go przesunąć niezależnie.
 */
export const catalogElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("catalog"),
  })
  .strict();

export const canvasElementSchema = z.discriminatedUnion("kind", [
  headingElementSchema,
  textElementSchema,
  buttonElementSchema,
  imageElementSchema,
  iconElementSchema,
  shapeElementSchema,
  catalogElementSchema,
]);
export type CanvasElement = z.infer<typeof canvasElementSchema>;
export type CanvasElementKind = CanvasElement["kind"];

/** Rodzaje elementów — lustro unii wyżej (kolejność = kolejność w palecie K3). */
export const ELEMENT_KINDS = [
  "heading",
  "text",
  "button",
  "image",
  "icon",
  "shape",
  "catalog",
] as const satisfies readonly CanvasElementKind[];

// -----------------------------------------------------------------------
// Płótno sekcji
// -----------------------------------------------------------------------

/**
 * Treść sekcji w wersji 2. `rows` to wysokość płótna w jednostkach siatki —
 * sekcja ma WŁASNĄ wysokość, bo przy geometrii absolutnej nie wynika ona z
 * treści. `version` jest jedynym znacznikiem, po którym render i edytor
 * rozpoznają v2 (patrz {@link isSectionCanvas}).
 *
 * `superRefine` pilnuje dwóch rzeczy, których pojedyncze pola nie widzą:
 * UNIKALNOŚCI identyfikatorów (dwa elementy o tym samym id znaczyłyby, że
 * przeciągnięcie jednego rusza oba) i MIESZCZENIA SIĘ w płótnie. Element
 * wystający poza płótno rozjechałby publiczną stronę — a schemat jest jedynym
 * miejscem, przez które treść przechodzi w OBIE strony (zapis i odczyt).
 */
export const sectionCanvasSchema = z
  .object({
    version: z.literal(SECTION_CANVAS_VERSION),
    rows: z.number().int().min(SECTION_MIN_ROWS).max(SECTION_MAX_ROWS),
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    elements: z.array(canvasElementSchema).max(MAX_ELEMENTS_PER_SECTION),
  })
  .strict()
  .superRefine((canvas, ctx) => {
    const seen = new Set<string>();
    for (const [index, element] of canvas.elements.entries()) {
      if (seen.has(element.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["elements", index, "id"],
          message: "Zduplikowany identyfikator elementu.",
        });
      }
      seen.add(element.id);

      for (const breakpoint of CANVAS_BREAKPOINTS) {
        const geometry = element.layout[breakpoint];
        if (!geometry) continue;
        if (geometry.x + geometry.w > CANVAS_COLUMNS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["elements", index, "layout", breakpoint, "w"],
            message: "Element wychodzi poza prawą krawędź płótna.",
          });
        }
        if (geometry.y + geometry.h > canvas.rows) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["elements", index, "layout", breakpoint, "h"],
            message: "Element wychodzi poza dolną krawędź płótna.",
          });
        }
      }
    }
  });
export type SectionCanvas = z.infer<typeof sectionCanvasSchema>;

/**
 * Czy treść sekcji jest płótnem v2. JEDYNY punkt rozpoznania wersji w całym
 * systemie — render, edytor i walidacja pytają tym samym pytaniem, więc nie da
 * się rozpoznać wersji „prawie tak samo" w trzech miejscach.
 *
 * Sprawdzenie jest CELOWO płytkie (klucz `version`), a nie pełnym parsowaniem:
 * treść w kształcie v2, ale niepoprawna, ma zostać ODRZUCONA jako zepsute v2,
 * a nie po cichu przepuszczona do renderu v1, który i tak jej nie zrozumie.
 */
export function isSectionCanvas(content: unknown): content is SectionCanvas {
  return (
    typeof content === "object" &&
    content !== null &&
    (content as { version?: unknown }).version === SECTION_CANVAS_VERSION
  );
}

/** Ikony dostępne dla elementu `icon` — lustro allowlisty USP (ADR-082). */
export const ELEMENT_ICONS = USP_ICONS;
