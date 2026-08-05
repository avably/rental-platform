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

import {
  imageSourceSchema,
  isSectionCanvas,
  linkHrefSchema,
  normalizeImageSource,
  SECTION_BACKGROUNDS,
  type ImageSource,
  type SectionCanvas,
} from "./elements";
import { GALLERY_PRESET_SLOTS, starterPhoto } from "./starter-photos";

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
// Galeria — pierwszy typ MEDIALNY (E3, aneks ADR-094)
// -----------------------------------------------------------------------

/**
 * Warianty układu galerii. Trzy, bo trzy są realnymi odpowiedziami na pytanie
 * „jak pokazać zdjęcia":
 *   • `grid` — równy rytm kafli o jednej proporcji (katalog realizacji);
 *   • `masonry` — kadry w NATURALNYCH proporcjach, dopasowane wysokością
 *     (pion i poziom obok siebie bez przycinania);
 *   • `carousel` — jeden pas przewijany w bok, gdy zdjęć jest dużo, a miejsca
 *     na stronie mało.
 *
 * Wszystkie trzy czytają TEN SAM `items` — przełącznik układu jest polem
 * treści, więc jego zmiana z definicji nie dosięga wpisów (patrz
 * {@link withStructuredLayout}).
 */
export const GALLERY_LAYOUTS = ["grid", "masonry", "carousel"] as const;
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number];

/**
 * Ile kafli w rzędzie na szerokim kontenerze. Dwójka jest podłogą, bo poniżej
 * progu 40 rem układ i tak schodzi do dwóch kolumn (decyzja właściciela
 * 2026-08-01), a czwórka sufitem: piąta kolumna robi z realizacji miniatury.
 */
export const GALLERY_COLUMNS = [2, 3, 4] as const;
export type GalleryColumns = (typeof GALLERY_COLUMNS)[number];

/**
 * Odstęp między kaflami — NAZWY, nie piksele. Operator wybiera gęstość, a nie
 * liczbę, więc zmiana skali rozstawu przestawia stronę razem z motywem.
 */
export const GALLERY_GAPS = ["tight", "regular", "roomy"] as const;
export type GalleryGap = (typeof GALLERY_GAPS)[number];

/** Górna granica zdjęć — lustro `maxItems` w rejestrze (test pilnuje zgody). */
const GALLERY_MAX_ITEMS = 60;

/**
 * Opis alternatywny kafla. W ODRÓŻNIENIU od `altText` sekcji v1 wolno mu być
 * PUSTY, i to jest decyzja dostępnościowa, a nie ustępstwo: zdjęcie czysto
 * dekoracyjne opisane zdaniem „zdjęcie 3" zaśmieca czytnik ekranu bardziej,
 * niż pomaga. Pustka renderuje się jako `alt=""` (WAI-ARIA: obraz dekoracyjny),
 * a nie jako brak atrybutu — brak atrybutu każe czytnikowi przeczytać nazwę
 * pliku.
 */
const galleryAlt = z.string().trim().max(300);

/** Podpis pod kafelkiem — widoczny tekst, więc pusty nie ma sensu (pole znika). */
const galleryCaption = z.string().trim().min(1).max(300);

export const galleryStructuredSchema = z
  .object({
    v: z.literal(STRUCTURED_SECTION_VERSION),
    type: z.literal("gallery"),
    layout: z.enum(GALLERY_LAYOUTS),
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    heading: heading.optional(),
    /**
     * Zdjęcia. MINIMUM JEDNO — galeria bez ani jednego kadru jest pustym
     * nagłówkiem, czyli dokładnie tą atrapą, którą ADR-094 usuwa z produktu.
     *
     * `image` to `imageSourceSchema` (ten sam, co element płótna): plik w
     * naszym buckecie albo hotlink u dostawcy Z ATRYBUCJĄ. Jedno pole „ścieżka
     * albo adres" kazałoby renderowi ZGADYWAĆ, czy dokleić prefiks bucketa
     * i czy pokazać podpis autora — a zgadywanie w warunkach licencyjnych
     * kończy się ich złamaniem.
     */
    items: z
      .array(
        z
          .object({
            image: imageSourceSchema,
            alt: galleryAlt.default(""),
            caption: galleryCaption.optional(),
            /** Dokąd prowadzi kafel. Ta sama allowlista, co przycisk płótna. */
            link: linkHrefSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(GALLERY_MAX_ITEMS),
    /** Kafle w rzędzie (siatka i mozaika) — patrz {@link GALLERY_COLUMNS}. */
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
    gap: z.enum(GALLERY_GAPS).default("regular"),
    /**
     * Powiększanie zdjęcia po kliknięciu. DOMYŚLNIE WŁĄCZONE (pinezka
     * właściciela): galeria, w której kliknięcie kafla nic nie robi, wygląda
     * na zepsutą — a wyłączyć ją trzeba móc, bo strona z kaflami-odnośnikami
     * ma inne zadanie niż album.
     */
    lightbox: z.boolean().default(true),
  })
  .strict();

export type GalleryStructuredContent = z.infer<typeof galleryStructuredSchema>;
export type GalleryStructuredItem = GalleryStructuredContent["items"][number];

/**
 * WPISY GALERII WYPROWADZONE ZE STAREJ TREŚCI (konwersja E3).
 *
 * FAQ konwersji nie ma i mieć nie może: treść spłaszczona do płótna nie niesie
 * już informacji, który napis był pytaniem, a który odpowiedzią (ADR-094,
 * decyzja o konwersji ręcznej). GALERIA jest przeciwnym przypadkiem — zdjęcie
 * pozostaje zdjęciem w każdej generacji, a jego opis alternatywny jedzie razem
 * z nim. Tu nie ma czego zgadywać, więc konwersja przenosi kadry CO DO JEDNEGO
 * i to jest jedyna różnica wobec E1 (sam przycisk zostaje ręczny).
 *
 * Kolejność wpisów bierzemy z kolejności CZYTANIA płótna (od góry, potem od
 * lewej), a nie z kolejności w tablicy elementów: tamta jest kolejnością
 * DODAWANIA i po kilku poprawkach nie ma nic wspólnego z tym, co operator widzi.
 */
export function galleryItemsFromLegacy(content: unknown): GalleryStructuredItem[] {
  if (isSectionCanvas(content)) return galleryItemsFromCanvas(content);
  return galleryItemsFromV1(content);
}

function galleryItemsFromCanvas(canvas: SectionCanvas): GalleryStructuredItem[] {
  return canvas.elements
    .filter((element) => element.kind === "image")
    .slice()
    .sort((a, b) => {
      const first = a.layout.desktop;
      const second = b.layout.desktop;
      return first.y - second.y || first.x - second.x;
    })
    .map((element) => {
      const image = normalizeImageSource(element as { source?: ImageSource; imagePath?: string });
      if (!image) return null;
      // Element płótna WYMAGA opisu alternatywnego, więc przenosimy go wprost;
      // kafel bez opisu nie powstanie tą drogą.
      return { image, alt: (element as { alt?: string }).alt ?? "" };
    })
    .filter((item): item is GalleryStructuredItem => item !== null)
    .slice(0, GALLERY_MAX_ITEMS);
}

/** Sekcja galerii SPRZED płótna: `items[].imagePath` + `alt` (schemat v1). */
function galleryItemsFromV1(content: unknown): GalleryStructuredItem[] {
  if (typeof content !== "object" || content === null) return [];
  const items = (content as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const path = (item as { imagePath?: unknown }).imagePath;
      if (typeof path !== "string" || path.length === 0) return null;
      const alt = (item as { alt?: unknown }).alt;
      return {
        image: { kind: "storage", path } as ImageSource,
        alt: typeof alt === "string" ? alt : "",
      };
    })
    .filter((item): item is GalleryStructuredItem => item !== null)
    .slice(0, GALLERY_MAX_ITEMS);
}

// -----------------------------------------------------------------------
// Opis edytora — mini-CMS czyta pola z DANYCH, nie z `if`-ów per typ
// -----------------------------------------------------------------------

/**
 * Rodzaj kontrolki pola wpisu. `image` NIE jest polem tekstowym: wartością
 * jest źródło zdjęcia, a nie napis, więc szuflada rysuje w tym miejscu
 * miniaturę, a nie `<input>` ze ścieżką do Storage.
 */
export type StructuredFieldKind = "text" | "multiline" | "image";

/**
 * Co znaczy PUSTE pole. Brak deklaracji = pustki NIE ZAPISUJEMY w ogóle (E1:
 * pytanie bez treści nie jest pytaniem, a błąd walidacji przy każdym skasowanym
 * znaku jest gorszy niż brak zapisu). Dwie jawne alternatywy:
 *   • `"value"` — pustka jest ZNACZĄCA i zostaje w treści (`alt: ""` to
 *     zdjęcie dekoracyjne, czyli decyzja, a nie brak decyzji);
 *   • `"unset"` — pustka ZDEJMUJE pole opcjonalne (podpis, odnośnik), bo
 *     schemat nie przyjmie pustego napisu, a operator ma prawo je usunąć.
 */
export type StructuredFieldEmpty = "value" | "unset";

export interface StructuredFieldSpec {
  /** Klucz pola we wpisie — zarazem końcówka klucza tłumaczenia etykiety. */
  key: string;
  kind: StructuredFieldKind;
  /** Wysokość pola wielowierszowego (wiersze). */
  rows?: number;
  empty?: StructuredFieldEmpty;
}

/** Przełącznik logiczny w ustawieniach sekcji (np. „pozwól otworzyć wiele naraz"). */
export interface StructuredToggleSpec {
  key: string;
}

/**
 * Ustawienie sekcji o ZAMKNIĘTYM zbiorze wartości (liczba kafli w rzędzie,
 * gęstość odstępu). Wartości są tu DANYMI o oryginalnym typie — dzięki temu
 * szuflada oddaje do treści liczbę tam, gdzie schemat oczekuje liczby, zamiast
 * zgadywać po kształcie napisu z `<select>`.
 */
export interface StructuredChoiceSpec {
  key: string;
  /** Wartości do wyboru — kolejność = kolejność na liście. */
  values: readonly (string | number)[];
  /**
   * Układy, przy których to ustawienie ma sens (brak = wszystkie). Liczba kafli
   * w rzędzie nie znaczy nic w karuzeli, a widoczna kontrolka bez skutku uczy
   * operatora, że ustawienia sekcji bywają ozdobą.
   */
  layouts?: readonly string[];
}

/**
 * KSZTAŁT SZUFLADY. `single` to jedna kolumna pól (FAQ: trzy przełączniki
 * i lista par). `split` rozdziela TREŚĆ od WYGLĄDU na dwie zakładki — bo typ
 * medialny ma obu naraz tyle, że jedna ściana pól przestaje być czytelna
 * (research planu „Sekcje 2.0": zarządzanie zdjęciami i wygląd galerii to
 * w narzędziach rynkowych dwa osobne ekrany).
 */
export type StructuredEditorShape = "single" | "split";

export interface StructuredSectionSpec<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: TSchema;
  /** Warianty układu — kolejność = kolejność w przełączniku szuflady. */
  layouts: readonly string[];
  defaultLayout: string;
  /** Pola JEDNEGO wpisu listy — framework szuflady renderuje je po kolei. */
  itemFields: readonly StructuredFieldSpec[];
  /** Ustawienia sekcji poza listą wpisów. */
  toggles: readonly StructuredToggleSpec[];
  /** Ustawienia wyglądu o zamkniętym zbiorze wartości. */
  choices: readonly StructuredChoiceSpec[];
  editor: StructuredEditorShape;
  minItems: number;
  maxItems: number;
  /** Role motywu malowane przez render tego typu — wejście macierzy kontrastu. */
  themeRoles: readonly StructuredThemeRole[];
  /** Treść startowa (preset) w obu językach — parytet pilnuje test. */
  preset: Record<"pl" | "en", unknown>;
  /**
   * Świeży wpis dodawany przyciskiem „dodaj" — musi spełniać schemat.
   * NIEOBECNY dla typów, w których wpis rodzi się z WGRANIA PLIKU: pusty kafel
   * galerii bez zdjęcia nie jest „wpisem do uzupełnienia", tylko treścią,
   * której schemat i tak nie przyjmie.
   */
  newItem?: Record<"pl" | "en", unknown>;
  /**
   * Treść v3 wyprowadzona z treści STAREJ generacji tej samej sekcji (v1 albo
   * płótno v2) — albo `null`, gdy wyprowadzenie wymagałoby zgadywania.
   * Nieobecność jest RÓWNIE mocną deklaracją co obecność: znaczy „tej treści
   * nie da się przenieść bez wymyślania" (FAQ — patrz ADR-094).
   */
  fromLegacy?: (content: unknown) => unknown | null;
}

/**
 * PRESET GALERII — kadry z kuracji szablonów, opisy z języka wypożyczalni.
 *
 * Zdjęcia są DANYMI z jednego miejsca ({@link GALLERY_PRESET_SLOTS}), a opisy
 * i podpisy tekstem UI-owym per język. Slot bez kadru wypada — a że preset bez
 * ani jednego zdjęcia nie przeszedłby schematu, kontrakt rdzenia liczy wpisy
 * wprost i zapala się, gdy kuracja zniknie.
 */
function galleryPreset(
  headingText: string,
  texts: readonly { alt: string; caption: string }[],
): unknown {
  const items = GALLERY_PRESET_SLOTS.map((slot, index) => {
    const image = starterPhoto(slot);
    return image ? { image, alt: texts[index]!.alt, caption: texts[index]!.caption } : null;
  }).filter((item): item is { image: ImageSource; alt: string; caption: string } => item !== null);

  return {
    v: STRUCTURED_SECTION_VERSION,
    type: "gallery",
    layout: "grid",
    background: "default",
    heading: headingText,
    columns: 3,
    gap: "regular",
    lightbox: true,
    items,
  };
}

/**
 * REJESTR TYPÓW STRUKTURALNYCH. E1 wniósł jeden wpis — FAQ jako typ
 * referencyjny end-to-end; E3 dokłada GALERIĘ, czyli pierwszy typ medialny.
 * Kolejne typy (kontakt, dojazd, cennik, opinie, sprzęt, dostawa, atuty, CTA)
 * dopisują się TUTAJ i nigdzie indziej.
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
    // FAQ nie ma ustawień wyglądu poza układem — pusto JAWNIE, żeby „nie ma"
    // było decyzją widoczną w rejestrze, a nie brakiem, którego nikt nie
    // rozpatrzył.
    choices: [],
    editor: "single",
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
    // Bez `fromLegacy` ŚWIADOMIE: treść FAQ spłaszczona do płótna nie niesie
    // już informacji, który napis był pytaniem, a który odpowiedzią (ADR-094).
  },

  gallery: {
    schema: galleryStructuredSchema,
    layouts: GALLERY_LAYOUTS,
    defaultLayout: "grid",
    itemFields: [
      { key: "image", kind: "image" },
      // Pusty opis alternatywny to DECYZJA („zdjęcie dekoracyjne"), więc
      // zostaje w treści jako `""` — patrz `galleryAlt`.
      { key: "alt", kind: "text", empty: "value" },
      { key: "caption", kind: "text", empty: "unset" },
      { key: "link", kind: "text", empty: "unset" },
    ],
    toggles: [{ key: "lightbox" }],
    choices: [
      { key: "columns", values: GALLERY_COLUMNS, layouts: ["grid", "masonry"] },
      { key: "gap", values: GALLERY_GAPS },
    ],
    // Zdjęcia i wygląd to dwie różne prace przy jednej sekcji — patrz
    // `StructuredEditorShape`.
    editor: "split",
    minItems: 1,
    maxItems: GALLERY_MAX_ITEMS,
    // Render galerii maluje: nagłówek sekcji (ink, z powłoki), podpis pod
    // kafelkiem i licznik lightboxa (inkMuted) oraz obrys kafla, przycisków
    // karuzeli i panelu lightboxa (border). Zero akcentu — kafel ma pokazywać
    // zdjęcie, nie konkurować z nim kolorem.
    themeRoles: ["ink", "inkMuted", "border"],
    preset: {
      pl: galleryPreset("Nasze realizacje", [
        {
          alt: "Nakryty stół na przyjęciu weselnym w namiocie",
          caption: "Wesele na 120 osób — namiot, stoły i nakrycia",
        },
        {
          alt: "Parkiet taneczny z oświetleniem pod namiotem",
          caption: "Parkiet i oświetlenie sceniczne",
        },
        {
          alt: "Rzędy krzeseł ustawione na ceremonię w plenerze",
          caption: "Ceremonia w plenerze — krzesła i nagłośnienie",
        },
      ]),
      en: galleryPreset("Our work", [
        {
          alt: "Banquet table set for a wedding reception in a marquee",
          caption: "Wedding for 120 — marquee, tables and place settings",
        },
        {
          alt: "Dance floor with stage lighting under a marquee",
          caption: "Dance floor and stage lighting",
        },
        {
          alt: "Rows of chairs set up for an outdoor ceremony",
          caption: "Outdoor ceremony — chairs and sound system",
        },
      ]),
    },
    // Bez `newItem` ŚWIADOMIE: kafel galerii rodzi się z WGRANIA PLIKU, a nie
    // z przycisku „dodaj wpis". Pusty kafel bez zdjęcia nie przeszedłby
    // schematu, więc przycisk obiecywałby operację, która kończy się błędem.
    fromLegacy: (content: unknown) => {
      const items = galleryItemsFromLegacy(content);
      if (items.length === 0) return null;
      const heading = (content as { heading?: unknown } | null)?.heading;
      return {
        v: STRUCTURED_SECTION_VERSION,
        type: "gallery",
        layout: "grid",
        background: "default",
        ...(typeof heading === "string" && heading.trim().length > 0 ? { heading } : {}),
        columns: 3,
        gap: "regular",
        lightbox: true,
        items,
      };
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

/**
 * Świeży wpis listy dla przycisku „dodaj" w mini-CMS — albo `undefined`, gdy
 * typ tworzy wpisy inną drogą (galeria: wgranie pliku). Szuflada pyta TĄ
 * funkcją, więc brak przycisku wynika z rejestru, a nie z `if`-a po nazwie typu.
 */
export function structuredNewItemFor(
  type: StructuredSectionType,
  locale: string,
): unknown | undefined {
  const { newItem } = STRUCTURED_SECTIONS[type] as StructuredSectionSpec;
  return newItem ? structuredClone(newItem[localeOf(locale)]) : undefined;
}

/**
 * KONWERSJA STAREJ TREŚCI NA v3 (E3) — treść wyprowadzona z sekcji poprzedniej
 * generacji albo PRESET, gdy tej treści nie da się przenieść bez zgadywania.
 *
 * Wołający (kreator) nie rozgałęzia się po typie: pyta rejestr i dostaje albo
 * przeniesione zdjęcia, albo świeży preset. Wynik jest PARSOWANY schematem
 * typu — przeniesienie, które dałoby treść niepoprawną, degraduje do presetu
 * zamiast zapisać do bazy coś, czego render nie narysuje.
 */
export function structuredFromLegacy(
  type: StructuredSectionType,
  content: unknown,
  locale: string,
): StructuredSectionContent {
  const spec = STRUCTURED_SECTIONS[type] as StructuredSectionSpec;
  const converted = spec.fromLegacy?.(content) ?? null;
  if (converted !== null) {
    const parsed = spec.schema.safeParse(converted);
    if (parsed.success) return parsed.data as StructuredSectionContent;
  }
  return structuredPresetFor(type, locale);
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

/**
 * Jedno pole jednego wpisu — edycja w mini-CMS. `undefined` ZDEJMUJE pole
 * (podpis i odnośnik kafla są opcjonalne, a schemat nie przyjmie pustego
 * napisu): bez tej drogi jedynym sposobem usunięcia podpisu byłoby skasowanie
 * całego zdjęcia.
 */
export function patchStructuredItem<T extends StructuredSectionContent>(
  content: T,
  index: number,
  key: string,
  value: string | undefined,
): T {
  const items = itemsOf(content);
  if (index < 0 || index >= items.length) return content;
  const next = items.map((item, i) => {
    if (i !== index) return item;
    const patched = { ...(item as Record<string, unknown>) };
    if (value === undefined) delete patched[key];
    else patched[key] = value;
    return patched;
  });
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
