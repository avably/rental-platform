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
 * PER BREAKPOINT — `desktop` jest źródłem prawdy, a `mobile` to delta.
 *
 * ================== CO ZMIENIŁ K4 (ADR-088) ==================
 *
 * 1. `layout.mobile` PRZESTAJE być pustą strukturą. Obecność tego pola znaczy
 *    dokładnie jedno: „operator poprawił ten element ręcznie na telefonie".
 *    Brak pola znaczy „licz z automatu" — i to jest stan domyślny KAŻDEGO
 *    elementu, także dodanego po latach na desktopie (patrz `mobile-layout.ts`).
 *    Osobna flaga „odpięty" byłaby drugim źródłem tej samej prawdy.
 *
 * 2. WYMIAR MOŻE BYĆ HUG (decyzja właściciela 2026-08-03). Do K3 pudełko
 *    elementu było zawsze prostokątem z geometrii, więc przycisk zajmował pas
 *    na całą szerokość pasa treści, a ramka zaznaczenia obejmowała pustkę wokół
 *    napisu. Od K4 wymiar jest ALBO jawny (jednostki siatki), ALBO wynika
 *    z TREŚCI ({@link elementSizeSchema}). Liczba w geometrii zostaje przy obu
 *    trybach — przy `hug` jest szacunkiem projektowym (miejsce w układzie,
 *    granice płótna), a prawdą jest sama treść: render wystawia `max-content`,
 *    a kreator mierzy pudełko w DOM-ie.
 */
import { z } from "zod";

import { USP_ICONS, uspIconSchema } from "./icons";
import { plainTextOf, richTextSchema } from "./rich-text";

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

/**
 * Margines boczny pasa treści w kolumnach i szerokość samego pasa. Mieszkają
 * TU, a nie w konwersji presetów, bo od K4 liczy z nich także auto-układ
 * mobilny — dwie kopie tej liczby znaczyłyby dwa różne pasy treści na jednej
 * stronie.
 */
export const CANVAS_PAD_COLUMNS = 12;
export const CANVAS_CONTENT_COLUMNS = CANVAS_COLUMNS - 2 * CANVAS_PAD_COLUMNS;

/**
 * SZEROKOŚĆ PROJEKTOWA PŁÓTNA MOBILNEGO (K4, ADR-088) — 390 px, czyli ta sama
 * liczba, którą przełącznik kreatora ustawia jako szerokość podglądu.
 *
 * Auto-układ musi być DETERMINISTYCZNY, a wysokości pudełek tekstowych zależą
 * od szerokości, przy której tekst się łamie. Gdyby liczyły się z realnej
 * szerokości urządzenia, ta sama treść dawałaby inny układ na 360 i na 430 px —
 * czyli układ, którego nie da się ani zapisać, ani porównać w teście. Jedna
 * liczba projektowa, a różnice urządzeń zbiera proporcja płótna.
 */
export const MOBILE_DESIGN_WIDTH_PX = 390;

/**
 * Próg breakpointu w `rem` — TA SAMA liczba, co dolny próg kontenera z K1b
 * (ADR-085). Poniżej niego renderer bierze geometrię mobilną, powyżej —
 * desktopową. Nowy próg to decyzja PM, nie skutek uboczny (kontrakt
 * `site-container-contract.test.tsx`).
 */
export const CANVAS_MOBILE_MAX_REM = 40;

/**
 * Ile razy sekcja rozłożona w JEDNĄ kolumnę może urosnąć w pionie względem
 * desktopu. Trzy, bo tyle kolumn ma najgęstsza siatka układu (atuty, galeria) —
 * zwinięcie ich w kolumnę zamienia szerokość na wysokość.
 */
export const MOBILE_STACK_FACTOR = 3;

/**
 * Sufit wysokości płótna MOBILNEGO w jednostkach. Dwa powody, dla których nie
 * jest to ta sama liczba, co {@link SECTION_MAX_ROWS}: jednostka siatki jest
 * ułamkiem szerokości płótna (na 390 px ma ~2,7 px zamiast 8 px), a jedna
 * kolumna jest z definicji wyższa niż trzy obok siebie. Sufit jest więc
 * PRZELICZONY — przepisany wprost obcinałby pierwszą lepszą sekcję hero.
 */
export const SECTION_MAX_ROWS_MOBILE = Math.ceil(
  (SECTION_MAX_ROWS * CANVAS_DESIGN_WIDTH_PX * MOBILE_STACK_FACTOR) / MOBILE_DESIGN_WIDTH_PX,
);

/**
 * Sufit POLA `y`/`h` w schemacie geometrii — wspólny dla obu breakpointów, więc
 * równy sufitowi mobilnemu. Wysokość płótna DESKTOPOWEGO nadal ogranicza
 * {@link SECTION_MAX_ROWS}: pilnuje tego `rows` sekcji i kontrola mieszczenia
 * się w płótnie niżej.
 */
export const GEOMETRY_MAX_ROWS = SECTION_MAX_ROWS_MOBILE;

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
    y: z.number().int().min(0).max(GEOMETRY_MAX_ROWS),
    w: z.number().int().min(1).max(CANVAS_COLUMNS),
    h: z.number().int().min(1).max(GEOMETRY_MAX_ROWS),
    z: z.number().int().min(0).max(999),
  })
  .strict();
export type Geometry = z.infer<typeof geometrySchema>;

/**
 * Geometria PER BREAKPOINT. `desktop` jest źródłem prawdy; `mobile` to RĘCZNA
 * POPRAWKA i jej obecność jest jedynym znacznikiem tego, że element został
 * „odpięty" od auto-układu (K4, ADR-088). Osobne pole zamiast osobnej sekcji,
 * bo to ten sam element, tylko inaczej ułożony.
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
// Tryb wymiaru — jawny albo z treści (K4, ADR-088)
// -----------------------------------------------------------------------

/**
 * TRYB WYMIARU OSI. `fixed` = tyle jednostek, ile mówi geometria; `hug` =
 * tyle, ile zajmuje TREŚĆ.
 *
 * Tryb jest PER OŚ, bo tak wygląda prawdziwa intencja układu: akapit ma zwykle
 * szerokość jawną (operator decyduje, gdzie łamie się wiersz) i wysokość
 * z treści (tyle, ile wyszło wierszy). Jeden wspólny przełącznik na oba wymiary
 * kazałby wybierać między „nie mogę ustawić szerokości" a „muszę pilnować
 * wysokości po każdej literze".
 */
export const SIZE_MODES = ["fixed", "hug"] as const;
export type SizeMode = (typeof SIZE_MODES)[number];

export const elementSizeSchema = z
  .object({
    w: z.enum(SIZE_MODES).default("fixed"),
    h: z.enum(SIZE_MODES).default("fixed"),
  })
  .strict();
export type ElementSize = z.infer<typeof elementSizeSchema>;

/** Brak pola `size` = zachowanie sprzed K4, czyli oba wymiary jawne. */
export const FIXED_SIZE: ElementSize = { w: "fixed", h: "fixed" };
export const HUG_SIZE: ElementSize = { w: "hug", h: "hug" };

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
 *
 * EKSPORTOWANY od E3: odnośnik pod kafelkiem galerii (treść v3) prowadzi tam,
 * gdzie przycisk płótna, więc musi go wpuszczać DOKŁADNIE ta sama allowlista.
 * Druga, „prawie taka sama" kopia reguły bezpieczeństwa rozjeżdża się z pierwszą
 * w dniu, w którym jedną z nich ktoś poprawi.
 */
export const linkHrefSchema = z
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

/**
 * WYPEŁNIENIA KSZTAŁTU. `scrim` doszło w K5 (ADR-090) i jest jedynym z nich,
 * które ma stać NAD ZDJĘCIEM: półprzezroczysta powłoka w kolorze najciemniejszego
 * pasa motywu, dzięki której tekst na pełnokadrowej fotografii ma policzalny
 * kontrast (tło pod nim jest nieznane, bo zdjęcie podmienia najemca — patrz
 * SCRIM_ALPHA w ./theme). Bez niego „ciemny luksus na pełnej fotografii" byłby
 * obietnicą, której żadna bramka nie potrafi sprawdzić.
 */
export const SHAPE_FILLS = ["none", "paper", "accent", "ink", "scrim"] as const;
export type ShapeFill = (typeof SHAPE_FILLS)[number];

/**
 * KOLOR TREŚCI — Z TOKENÓW MOTYWU, nigdy dowolny (K3, ADR-086).
 *
 * Operator wybiera ROLĘ koloru, a nie wartość: „akcent" wygląda inaczej
 * w każdym motywie i inaczej na każdym pasie tego samego motywu, a ma przejść
 * z nimi razem. Dowolny `#rrggbb` w treści zamroziłby jeden odcień na zawsze
 * i pierwsza zmiana motywu zostawiłaby stronę z kolorem, którego nikt już nie
 * umie odtworzyć — a przy okazji rozjechałby kontrast.
 */
/**
 * `onScrim` doszło w K5 v2 (ADR-090) i jest jedyną rolą, która NIE bierze
 * koloru z pasa sekcji. Tekst leżący na WELONIE (kształt `scrim` nad zdjęciem)
 * ma tło welonu, a nie tło pasa — a te bywają skrajnie różne: pastelowy motyw
 * ma pas kremowy i welon ciemny, więc napis w kolorze pasa robi się na welonie
 * niewidzialny. Rola celuje więc w kolor WELONU, którego kontrast liczy bramka
 * (patrz SCRIM_ALPHA w ./theme).
 */
export const ELEMENT_COLORS = ["default", "muted", "accent", "inverted", "onScrim"] as const;
export type ElementColor = (typeof ELEMENT_COLORS)[number];

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

/**
 * TREŚĆ SFORMATOWANA (K3, ADR-086) — pole `runs` obok zwykłego `text`.
 *
 * `text` zostaje WYMAGANY i jest tekstem PROSTYM: z niego biorą się metadane
 * strony i on jest treścią, gdy formatowania nie ma. `runs` są opcjonalne i
 * niosą pogrubienia, pochylenia i linki (patrz `rich-text.ts` — treść NIE jest
 * HTML-em, render składa znaczniki sam).
 *
 * Zgodności spłaszczonych runów z `text` pilnuje refinement PŁÓTNA (niżej), a
 * nie sam element: unia dyskryminowana przyjmuje wyłącznie zwykłe obiekty, więc
 * `superRefine` na członku unii rozbiłby dyskryminację. Jedno miejsce kontroli
 * jest zresztą lepsze niż dwa identyczne.
 */
export const headingElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("heading"),
    text: elementHeading,
    runs: richTextSchema.optional(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    align: alignment,
    color: z.enum(ELEMENT_COLORS).optional(),
    size: elementSizeSchema.optional(),
  })
  .strict();

export const textElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("text"),
    text: elementText,
    runs: richTextSchema.optional(),
    variant: z.enum(TEXT_VARIANTS).default("body"),
    align: alignment,
    color: z.enum(ELEMENT_COLORS).optional(),
    size: elementSizeSchema.optional(),
  })
  .strict();

export const buttonElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("button"),
    label: elementLabel,
    href: linkHrefSchema,
    variant: z.enum(BUTTON_VARIANTS).default("solid"),
    align: alignment,
    size: elementSizeSchema.optional(),
  })
  .strict();

/**
 * ŹRÓDŁO ZDJĘCIA (K3, ADR-086) — unia dyskryminowana, bo to są dwa RÓŻNE
 * światy, a nie dwa zapisy tego samego.
 *
 * `storage` to ścieżka w naszym buckecie (bilety uploadu z ADR-082): plik jest
 * nasz, adres budujemy sami, CSP go zna. `unsplash` to HOTLINK do cudzego
 * hosta — zdjęcia nie kopiujemy do siebie, więc razem z adresem MUSI jechać
 * atrybucja autora (warunek licencyjny API) i adres wyzwalacza pobrania.
 * Gdyby to było jedno pole „url albo ścieżka", render musiałby ZGADYWAĆ, czy
 * dokleić prefiks bucketa i czy pokazać podpis autora — a zgadywanie w
 * warunkach licencyjnych kończy się ich złamaniem.
 */
export const imageSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("storage"), path: elementImagePath }).strict(),
  z
    .object({
      kind: z.literal("unsplash"),
      /** Bezpośredni adres zdjęcia u dostawcy (hotlink — wymóg licencji). */
      url: z.string().trim().url().max(2_000),
      /** Podpis autora — musi być widoczny przy zdjęciu. */
      authorName: z.string().trim().min(1).max(120),
      /** Profil autora z parametrami atrybucji. */
      authorUrl: z.string().trim().url().max(2_000),
      /** Adres wyzwalacza pobrania — wołany RAZ, w chwili wyboru zdjęcia. */
      downloadLocation: z.string().trim().url().max(2_000),
    })
    .strict(),
]);
export type ImageSource = z.infer<typeof imageSourceSchema>;

export const imageElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("image"),
    /** Brak źródła = kafel zastępczy. Element istnieje w układzie, zanim wejdzie zdjęcie. */
    source: imageSourceSchema.optional(),
    /**
     * Ścieżka Storage sprzed K3 (K2 nie znało innego źródła). Czytana dla
     * zgodności wstecz i normalizowana do `source` przy pierwszym zapisie —
     * patrz `normalizeImageSource`. Nowa treść JEJ NIE ZAPISUJE.
     */
    imagePath: elementImagePath.optional(),
    alt: elementAlt,
    fit: z.enum(IMAGE_FITS).default("cover"),
  })
  .strict();

/**
 * Jedno źródło prawdy o tym, skąd wziąć zdjęcie — niezależnie od tego, czy
 * element pochodzi sprzed K3, czy z pickera. Render i edytor pytają TĄ funkcją,
 * więc zgodność wstecz nie rozłazi się po `if`-ach w komponentach.
 */
export function normalizeImageSource(element: {
  source?: ImageSource;
  imagePath?: string;
}): ImageSource | undefined {
  if (element.source) return element.source;
  return element.imagePath ? { kind: "storage", path: element.imagePath } : undefined;
}

export const iconElementSchema = z
  .object({
    ...elementBase,
    kind: z.literal("icon"),
    /** Allowlista `lucide` wspólna z sekcją USP (ADR-082) — zamknięty zbiór. */
    name: uspIconSchema,
    tone: z.enum(ICON_TONES).default("accent"),
    size: elementSizeSchema.optional(),
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

/*
 * MAPA-LINK (K3, ADR-086) ZNIKŁA W E1 (ADR-094).
 *
 * Element nie wchodził do ŻADNEGO presetu ani szablonu startowego — istniał
 * wyłącznie jako kafel palety, którym operator składał ręcznie „adres + link".
 * Dojazd dostaje własną sekcję strukturalną z kartą mapy (etap E5), więc kafel
 * dublowałby ją gorszą wersją. Usunięcie jest CAŁKOWITE (schemat, paleta,
 * miary, render), bo element pozostawiony w unii to element, który trzeba
 * utrzymywać przy każdej zmianie płótna.
 */

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

/**
 * Rodzaje dostępne w PALECIE (K3). `catalog` jest poza nią świadomie: to nie
 * jest element, który operator „dokłada", tylko miejsce na listę z bazy —
 * powstaje przy konwersji sekcji produktów i dwie takie listy na jednej
 * stronie znaczyłyby ten sam katalog wyświetlony dwa razy.
 */
export const PALETTE_ELEMENT_KINDS = [
  "heading",
  "text",
  "button",
  "image",
  "icon",
  "shape",
] as const satisfies readonly CanvasElementKind[];
export type PaletteElementKind = (typeof PALETTE_ELEMENT_KINDS)[number];

/**
 * Rodzaje, których pudełko UMIE objąć treść (K4, ADR-088). Zbiór jest
 * zamknięty i wynika z pytania „czy element ma własny, naturalny rozmiar":
 *   • napis, akapit, etykieta przycisku i adres mapy — mają (tekst i jego skala);
 *   • ikona — ma (kwadrat o boku ze skali interfejsu);
 *   • ZDJĘCIE, KSZTAŁT i KATALOG — NIE mają. Zdjęcie o proporcjach z pliku
 *     rozjeżdżałoby układ przy każdej podmianie, kształt JEST geometrią (nie ma
 *     w nim treści do objęcia), a katalog to lista z bazy o zmiennej długości —
 *     jego „naturalna" wysokość zmieniałaby się przy każdym dodanym produkcie.
 */
export const HUG_KINDS = [
  "heading",
  "text",
  "button",
  "icon",
] as const satisfies readonly CanvasElementKind[];
export type HugElementKind = (typeof HUG_KINDS)[number];

/** Czy rodzaj elementu w ogóle zna tryb `hug` — jedno pytanie na cały system. */
export function supportsHug(kind: CanvasElementKind): kind is HugElementKind {
  return (HUG_KINDS as readonly CanvasElementKind[]).includes(kind);
}

/**
 * Tryb wymiaru elementu. Element bez pola `size` (cała treść sprzed K4) i każdy
 * rodzaj bez wsparcia dla hug dostają wymiar JAWNY — dzięki temu wprowadzenie
 * hug nie rusza ani jednego zapisanego piksela.
 */
export function sizeOf(element: CanvasElement): ElementSize {
  if (!supportsHug(element.kind)) return FIXED_SIZE;
  return "size" in element && element.size ? element.size : FIXED_SIZE;
}

/** Element z ustawionym trybem wymiaru — bez mutacji wejścia. */
export function withSize(element: CanvasElement, size: ElementSize): CanvasElement {
  if (!supportsHug(element.kind)) return element;
  return { ...element, size } as CanvasElement;
}

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
      // Sformatowana treść MUSI spłaszczać się dokładnie do `text` (K3,
      // ADR-086). Rozjazd znaczy, że strona pokazuje co innego, niż idzie do
      // metadanych i do podglądu — a tego nie widać, dopóki ktoś nie zajrzy
      // do bazy.
      if ("runs" in element && element.runs && plainTextOf(element.runs) !== element.text) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["elements", index, "runs"],
          message: "Sformatowana treść nie zgadza się z tekstem elementu.",
        });
      }

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
        /*
         * OŚ PIONOWA: sprawdzana WYŁĄCZNIE dla desktopu (K4, ADR-088).
         *
         * `rows` opisuje wysokość płótna DESKTOPOWEGO — mobilnej nie ma
         * w treści, bo wynika z auto-układu (`mobile-layout.ts`) i z ręcznych
         * poprawek RAZEM. Porównanie mobilnej geometrii z desktopowym `rows`
         * odrzucałoby poprawne poprawki (na telefonie jednostka jest trzy razy
         * mniejsza, więc ta sama treść zajmuje trzy razy więcej jednostek),
         * a porównanie z liczbą wyliczoną tutaj byłoby błędnym kołem: wysokość
         * mobilna OBEJMUJE te poprawki z definicji. Zamiast kontroli, której
         * nie da się uczciwie postawić, mamy gwarancję KONSTRUKCYJNĄ — dowodzi
         * jej kontrakt „każda poprawka mieści się w płótnie mobilnym".
         */
        if (breakpoint === "desktop" && geometry.y + geometry.h > canvas.rows) {
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
