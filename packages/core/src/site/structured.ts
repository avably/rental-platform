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

import { formatMoney, type CurrencyCode } from "../money";
import {
  imageSourceSchema,
  isSectionCanvas,
  linkHrefSchema,
  normalizeImageSource,
  SECTION_BACKGROUNDS,
  type CanvasElement,
  type ImageSource,
  type SectionCanvas,
} from "./elements";
import { USP_ICONS } from "./icons";
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
  /**
   * SYGNAŁ BŁĘDU (E4). Doszedł razem z pierwszym typem, który ma FORMULARZ:
   * „to pole jest wymagane" musi być czytelne na każdym pasie każdego motywu,
   * a jest to jedyny komunikat sekcji, którego nieprzeczytanie zatrzymuje
   * odwiedzającego. Kolor niesie rejestr motywów (`danger`, K6/ADR-092), więc
   * sekcja nie wnosi ani jednego heksa — dokłada wyłącznie POMIAR.
   */
  "dangerText",
  /**
   * ETYKIETA NA WYPEŁNIENIU AKCENTU (E7). Doszła razem z pierwszym typem,
   * którego CAŁA POWIERZCHNIA bywa akcentem (wariant `accent` sekcji CTA) —
   * ale luka, którą zamyka, istniała wcześniej i w trzech typach naraz.
   *
   * `accentFill` mierzy WYPEŁNIENIE względem pasa (czy kształt widać),
   * `accentText` — akcentowy TEKST na pasie (czy da się go przeczytać). Ani
   * jedno, ani drugie nie liczy pary, która na przycisku jest najważniejsza:
   * NAPISU NA TYM WYPEŁNIENIU. Do E6 ta para miała pomiar wyłącznie w bloku
   * chrome sklepu — czyli poza macierzą typów strukturalnych, więc sekcja
   * z przyciskiem wchodziła do rejestru bez policzenia jedynej pary, której
   * nieprzeczytanie zatrzymuje odwiedzającego na przycisku.
   *
   * Deklarują ją odtąd WSZYSTKIE typy malujące klasę `site-cta` (kontakt,
   * dojazd, CTA) — pilnuje tego skan `structured-role-usage.test.tsx`, który
   * zestawia role NAMALOWANE z ZADEKLAROWANYMI w obie strony.
   */
  "accentOnFill",
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
// Kontakt — pierwszy typ z AKCJĄ (E4, ADR-095)
// -----------------------------------------------------------------------

/**
 * Warianty układu kontaktu. Dwa, bo tyle jest realnych odpowiedzi na pytanie
 * „co robi odwiedzający na tej sekcji":
 *   • `stacked` — dane kontaktowe, a pod nimi formularz. Kolumna czytana od
 *     góry: kto chce zadzwonić, dzwoni i nie schodzi niżej;
 *   • `split` — dane i formularz OBOK SIEBIE na szerokim kontenerze (poniżej
 *     progu schodzą w tę samą kolumnę, co `stacked`). Formularz jest wtedy
 *     widoczny od razu, bez przewijania pod dane.
 *
 * Oba czytają TEN SAM `items` i tę samą parę przełączników — przełącznik
 * układu jest polem treści, więc jego zmiana z definicji nie dosięga wpisów.
 */
export const CONTACT_LAYOUTS = ["stacked", "split"] as const;
export type ContactLayout = (typeof CONTACT_LAYOUTS)[number];

/**
 * RODZAJE DANYCH KONTAKTOWYCH. Rodzaj nie jest etykietą — jest DECYZJĄ
 * O ZACHOWANIU: `email` renderuje się jako `mailto:`, `phone` jako `tel:`,
 * `map` jako odnośnik do wyszukiwarki map, a `address` i `hours` jako tekst.
 * Gdyby wpis niósł sam napis, render musiałby ZGADYWAĆ po jego kształcie,
 * czy zrobić z niego odnośnik — a numer wpisany nietypowo (albo adres
 * zawierający „@") przestawałby być klikalny bez żadnego komunikatu.
 *
 * Zamknięty zbiór ma też drugi skutek: etykieta wpisu idzie z JĘZYKA STRONY
 * (`SiteRenderLabels`), a nie z pola tekstowego najemcy, więc sklep po
 * angielsku nie pokazuje polskiego „Telefon:" przy numerze.
 */
export const CONTACT_ENTRY_KINDS = ["email", "phone", "address", "hours", "map"] as const;
export type ContactEntryKind = (typeof CONTACT_ENTRY_KINDS)[number];

/** Górna granica wpisów — lustro `maxItems` w rejestrze (test pilnuje zgody). */
const CONTACT_MAX_ITEMS = 8;

/**
 * Wartość wpisu — JEDEN typ dla wszystkich rodzajów, i to jest decyzja, a nie
 * uproszczenie. Kusi, żeby `email` walidować schematem adresu (repo robi tak
 * wszędzie indziej), ale wpis powstaje POD KLAWISZAMI operatora: przy trzecim
 * znaku „ko" adres nie jest jeszcze adresem, więc autozapis szkicu odbijałby
 * się o schemat przy każdej literze i sekcja stawałaby się nieedytowalna.
 *
 * Konsekwencja jest zamknięta tam, gdzie realnie boli: adresata formularza
 * wyprowadza {@link contactRecipient}, który sprawdza adres schematem i przy
 * niepoprawnym oddaje `null` — czyli sekcja renderuje się BEZ formularza,
 * zamiast wysyłać wiadomość donikąd.
 */
const contactValue = z.string().trim().min(1).max(200);

/** Adres, na który wolno wysłać wiadomość z formularza (bramka nadawania). */
const contactEmailValue = z.string().trim().email().max(254);

export const contactStructuredSchema = z
  .object({
    v: z.literal(STRUCTURED_SECTION_VERSION),
    type: z.literal("contact"),
    layout: z.enum(CONTACT_LAYOUTS),
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    heading: heading.optional(),
    /**
     * Dane kontaktowe. MINIMUM JEDEN wpis — sekcja kontaktowa, w której nie ma
     * ani jednego sposobu kontaktu, jest pustym nagłówkiem (klasa atrap
     * usuwana przez ADR-094). Lista, a nie cztery pola stałe, bo wypożyczalnia
     * realnie ma DWA numery (biuro i serwis) albo dwa adresy (magazyn i punkt
     * odbioru), a kolejność jest jej decyzją.
     */
    items: z
      .array(z.object({ kind: z.enum(CONTACT_ENTRY_KINDS), value: contactValue }).strict())
      .min(1)
      .max(CONTACT_MAX_ITEMS),
    /**
     * Czy pod danymi stoi formularz. DOMYŚLNIE WŁĄCZONY: sekcja kontaktowa bez
     * możliwości napisania z poziomu strony odsyła odwiedzającego do własnego
     * programu pocztowego, czyli poza sklep — a wyłączyć ją trzeba móc, bo
     * najemca bez obsłużonej skrzynki wolałby telefon.
     *
     * Sam przełącznik NIE WYSTARCZA, żeby formularz się pojawił: potrzebny
     * jest jeszcze adresat ({@link contactFormVisible}).
     */
    showForm: z.boolean().default(true),
    /**
     * Czy formularz pyta o telefon. DOMYŚLNIE WYŁĄCZONY (minimalizacja danych:
     * do odpowiedzi na wiadomość wystarcza adres e-mail). Włączony znaczy pole
     * WYMAGANE, nie „dodatkowe": operator włącza je wtedy, gdy zamierza
     * oddzwaniać, a pole opcjonalne zostawałoby puste i przełącznik byłby
     * ozdobą.
     */
    askPhone: z.boolean().default(false),
    /**
     * Dokąd prowadzi notka RODO pod formularzem. Pole SEKCJI, bo w modelu nie
     * ma dziś miejsca na „politykę prywatności strony" (byłaby to migracja),
     * a wyprowadzanie adresu z odnośników stopki po ich NAZWIE („polityka",
     * „privacy"…) byłoby zgadywaniem — najemca nazywa je po swojemu.
     *
     * Brak = notka bez odnośnika. Zdanie o tym, co robimy z danymi, jest
     * wtedy nadal na stronie; nie ma tylko dokąd z niego przejść.
     */
    privacyHref: linkHrefSchema.optional(),
  })
  .strict();

export type ContactStructuredContent = z.infer<typeof contactStructuredSchema>;
export type ContactStructuredItem = ContactStructuredContent["items"][number];

/**
 * ADRESAT WIADOMOŚCI Z FORMULARZA — pierwszy wpis rodzaju `email` o wartości,
 * która przechodzi schemat adresu; `null`, gdy takiego nie ma.
 *
 * ==================== DLACZEGO WŁAŚNIE TEN ADRES ====================
 *
 * Kandydatem był adres powiadomień najemcy (`tenant_settings.email_sender.
 * reply_to`, ADR-042) — ten sam, na który idą powiadomienia o zamówieniach.
 * Odpada z twardego powodu: publiczny katalog (0020) JAWNIE nie wypuszcza
 * `email_sender` („zero danych wrażliwych"), storefront nie ma klucza
 * service-role, a wystawienie tego ustawienia anonowi byłoby zmianą schematu
 * bezpieczeństwa, nie dodaniem sekcji.
 *
 * Adres z TREŚCI sekcji jest za to danymi, które storefront już legalnie ma —
 * i które sekcja i tak wypisuje na stronie jako `mailto:`. Wiadomość idzie
 * więc dokładnie tam, gdzie najemca kazał do siebie pisać, a operator ma
 * jedno miejsce prawdy zamiast dwóch, które mogą się rozjechać.
 *
 * PIERWSZY, nie „wszystkie": dwa adresy w sekcji znaczą dwa działy, a nie
 * dwóch odbiorców jednej wiadomości; rozsyłanie kopii byłoby decyzją, której
 * nikt nie podjął.
 */
export function contactRecipient(content: ContactStructuredContent): string | null {
  for (const item of content.items) {
    if (item.kind !== "email") continue;
    const parsed = contactEmailValue.safeParse(item.value);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * Czy sekcja pokazuje formularz. DWA warunki, oba konieczne: przełącznik
 * operatora i istnienie adresata. Brak adresu to STAN, nie błąd — sekcja
 * renderuje wtedy same dane kontaktowe, zamiast wystawiać formularz, którego
 * wysłanie nie miałoby dokąd trafić.
 */
export function contactFormVisible(content: ContactStructuredContent): boolean {
  return content.showForm && contactRecipient(content) !== null;
}

/**
 * Numer w postaci, którą przyjmuje `tel:` — bez spacji. Ta sama normalizacja,
 * co w renderze sekcji v1 (`sections.tsx`), i celowo NIE ostrzejsza: „+48",
 * nawiasy i myślniki są w `tel:` legalne, a zdejmowanie ich zmieniałoby numer
 * najemcy w coś, czego on sam nie zapisał.
 */
export function contactTelHref(value: string): string {
  return `tel:${value.replace(/\s+/g, "")}`;
}

/** Prefiks wyszukiwania w mapach — ten sam, którym konwersja v1→v2 robi z zapytania przycisk. */
const MAP_SEARCH_PREFIX = "https://www.google.com/maps/search/?api=1&query=";

/** Odnośnik do map z zapytania wpisanego przez najemcę (tekst, nie URL). */
export function contactMapHref(value: string): string {
  return `${MAP_SEARCH_PREFIX}${encodeURIComponent(value)}`;
}

/**
 * WPISY KONTAKTU WYPROWADZONE ZE STAREJ TREŚCI (konwersja E4).
 *
 * Kontakt jest — inaczej niż FAQ — konwertowalny w OBU generacjach:
 *
 *   • v1 niesie osobne pola (`email`, `phone`, `address`, `mapQuery`), więc
 *     rodzaj wpisu jest w nich zapisany wprost i nie ma czego zgadywać;
 *   • PŁÓTNO v2 spłaszczyło je do napisów, ale rodzaj da się odczytać
 *     z KSZTAŁTU wartości, a nie z jej znaczenia: „@" pomiędzy niepustymi
 *     członami to adres e-mail, ciąg cyfr z separatorami to numer, reszta to
 *     adres. To jest rozpoznanie, nie interpretacja — dlatego wolno je zrobić
 *     maszynie, podczas gdy „który napis był pytaniem, a który odpowiedzią"
 *     (FAQ) wolno wyłącznie człowiekowi.
 *
 * Kolejność bierzemy z kolejności CZYTANIA płótna (od góry, potem od lewej),
 * tak samo jak w galerii: kolejność w tablicy elementów jest kolejnością
 * DODAWANIA i po kilku poprawkach nie ma nic wspólnego z tym, co widać.
 */
export function contactEntriesFromLegacy(content: unknown): ContactStructuredItem[] {
  if (isSectionCanvas(content)) return contactEntriesFromCanvas(content);
  return contactEntriesFromV1(content);
}

/** Adres e-mail „na oko": jeden `@` między niepustymi członami, kropka w domenie. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Numer telefonu „na oko": zaczyna się od `+`, cyfry albo nawiasu i dalej ma
 * WYŁĄCZNIE cyfry i separatory. Litera w środku dyskwalifikuje — dzięki temu
 * „00-001 Warszawa" zostaje adresem, mimo że zaczyna się od cyfry.
 */
const PHONE_SHAPE = /^[+(\d][\d\s()./+-]{5,}$/;

function contactKindOf(value: string): ContactEntryKind {
  if (EMAIL_SHAPE.test(value)) return "email";
  if (PHONE_SHAPE.test(value)) return "phone";
  return "address";
}

/** Zapytanie mapy z adresu przycisku płótna albo `null`, gdy to inny odnośnik. */
function mapQueryOf(href: string): string | null {
  if (!href.startsWith(MAP_SEARCH_PREFIX)) return null;
  try {
    const query = new URL(href).searchParams.get("query");
    return query && query.trim().length > 0 ? query : null;
  } catch {
    return null;
  }
}

function contactEntriesFromCanvas(canvas: SectionCanvas): ContactStructuredItem[] {
  const ordered = canvas.elements.slice().sort((a, b) => {
    const first = a.layout.desktop;
    const second = b.layout.desktop;
    return first.y - second.y || first.x - second.x;
  });

  const items: ContactStructuredItem[] = [];
  for (const element of ordered) {
    if (element.kind === "text") {
      const value = element.text.trim();
      if (value.length > 0) items.push({ kind: contactKindOf(value), value: value.slice(0, 200) });
      continue;
    }
    if (element.kind === "button") {
      const query = mapQueryOf(element.href);
      if (query) items.push({ kind: "map", value: query.slice(0, 200) });
    }
  }
  return items.slice(0, CONTACT_MAX_ITEMS);
}

/** Nagłówek sekcji z płótna — pierwszy element nagłówkowy w kolejności czytania. */
function canvasHeading(canvas: SectionCanvas): string | undefined {
  const headings = canvas.elements
    .filter((element): element is Extract<CanvasElement, { kind: "heading" }> => element.kind === "heading")
    .slice()
    .sort((a, b) => a.layout.desktop.y - b.layout.desktop.y || a.layout.desktop.x - b.layout.desktop.x);
  const first = headings[0]?.text.trim();
  return first && first.length > 0 ? first.slice(0, 200) : undefined;
}

/**
 * Pierwszy akapit płótna w kolejności czytania — bliźniak {@link canvasHeading}
 * dla treści, która w v1 była jednym napisem (notka cennika). Wspólny, bo
 * dwie kopie tego samego sortowania rozjechałyby się przy pierwszej poprawce
 * reguły „od góry, potem od lewej".
 */
function canvasFirstText(canvas: SectionCanvas): string | undefined {
  const texts = canvas.elements
    .filter((element): element is Extract<CanvasElement, { kind: "text" }> => element.kind === "text")
    .slice()
    .sort(
      (a, b) =>
        a.layout.desktop.y - b.layout.desktop.y || a.layout.desktop.x - b.layout.desktop.x,
    );
  const first = texts[0]?.text.trim();
  return first && first.length > 0 ? first : undefined;
}

/** Sekcja kontaktu SPRZED płótna: osobne pola adresu, telefonu, e-maila i mapy. */
function contactEntriesFromV1(content: unknown): ContactStructuredItem[] {
  if (typeof content !== "object" || content === null) return [];
  const source = content as Record<string, unknown>;
  const items: ContactStructuredItem[] = [];
  // Kolejność wpisów = kolejność, w jakiej render v1 rysował pola. Konwersja
  // ma dać stronę WYGLĄDAJĄCĄ tak samo, a nie posortowaną po naszym uznaniu.
  for (const [key, kind] of [
    ["email", "email"],
    ["phone", "phone"],
    ["address", "address"],
    ["mapQuery", "map"],
  ] as const) {
    const value = source[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) items.push({ kind, value: trimmed.slice(0, 200) });
  }
  return items.slice(0, CONTACT_MAX_ITEMS);
}

// -----------------------------------------------------------------------
// Wiadomość z formularza kontaktu — JEDNA reguła po obu stronach (E4)
// -----------------------------------------------------------------------

/** Pola wiadomości — klucze mapy błędów walidacji. */
export const CONTACT_MESSAGE_FIELDS = ["name", "email", "phone", "message"] as const;
export type ContactMessageField = (typeof CONTACT_MESSAGE_FIELDS)[number];

/**
 * Rodzaj błędu pola. Komunikat składa STRONA (w języku sklepu) — rdzeń nie zna
 * tłumaczeń, a odsyłanie gotowych zdań z serwera zamroziłoby język formularza
 * na tym, w którym akurat stoi kod (wzorzec kontraktu waitlisty).
 */
export type ContactMessageFieldError = "required" | "invalid" | "too_long";
export type ContactMessageFieldErrors = Partial<Record<ContactMessageField, ContactMessageFieldError>>;

export interface ContactMessageInput {
  name: string;
  email: string;
  phone?: string;
  message: string;
}

/** Dolna granica treści — jedno słowo nie jest wiadomością, na którą da się odpowiedzieć. */
const CONTACT_MESSAGE_MIN = 10;
const CONTACT_MESSAGE_MAX = 5_000;

/**
 * Schemat wiadomości. Zależy od USTAWIENIA sekcji, bo telefon jest wymagany
 * dokładnie wtedy, gdy operator o niego pyta — a to jest pole treści, nie
 * stała. Ta sama funkcja stoi w przeglądarce i w akcji serwerowej: gdyby
 * reguły były dwie, formularz przepuszczałby wejście, które serwer odrzuca
 * (albo odwrotnie — i wtedy walidacja przeglądarki byłaby dekoracją).
 */
export function contactMessageSchema(askPhone: boolean) {
  return z
    .object({
      name: z.string().trim().min(2).max(120),
      email: contactEmailValue,
      phone: askPhone
        ? z.string().trim().min(4).max(40)
        : z.string().trim().max(40).optional(),
      message: z.string().trim().min(CONTACT_MESSAGE_MIN).max(CONTACT_MESSAGE_MAX),
    })
    .strict();
}

/**
 * WYNIK WALIDACJI WIADOMOŚCI. Rozstrzygnięcie „poprawne / niepoprawne" jest tu
 * OSOBNYM polem, a nie pustką w mapie błędów — bo te dwie rzeczy nie są tym
 * samym. Wejście z nieznanym kluczem odpada na `.strict()`, ale żadne POLE nie
 * jest wtedy winne, więc mapa błędów zostaje pusta; wołający czytający „pusta
 * mapa = w porządku" przepuściłby takie wejście dalej.
 */
export type ContactMessageParse =
  | { ok: true; data: ContactMessageInput }
  | { ok: false; fields: ContactMessageFieldErrors };

/**
 * Walidacja wiadomości — JEDNA dla przeglądarki i dla akcji serwerowej.
 *
 * Rozpoznanie rodzaju błędu idzie po KODZIE zoda, nie po treści komunikatu:
 * komunikaty są tekstem biblioteki i zmieniają się między jej wersjami.
 * Wyjątkiem jest PUSTE POLE: schemat adresu odrzuca pustkę jako zły FORMAT,
 * a dla piszącego pusty i błędny adres to dwie różne sytuacje i dwa różne
 * zdania („uzupełnij" kontra „sprawdź"). Pustkę rozstrzygamy więc po wejściu,
 * zanim spojrzymy w kod.
 */
export function parseContactMessage(input: unknown, askPhone: boolean): ContactMessageParse {
  const parsed = contactMessageSchema(askPhone).safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };

  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const fields: ContactMessageFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || !(CONTACT_MESSAGE_FIELDS as readonly string[]).includes(key)) {
      continue;
    }
    const field = key as ContactMessageField;
    if (fields[field]) continue; // pierwszy błąd pola wygrywa — komunikat jest jeden
    const value = raw[field];
    if (value === undefined || (typeof value === "string" && value.trim() === "")) {
      fields[field] = "required";
    } else if (issue.code === "too_big") fields[field] = "too_long";
    else if (issue.code === "too_small") fields[field] = "required";
    else fields[field] = "invalid";
  }
  return { ok: false, fields };
}

/**
 * Same błędy pól — wygodne wejście dla formularza, który i tak buduje obiekt
 * wiadomości sam i nie ma jak wnieść nieznanego klucza. Serwer używa
 * {@link parseContactMessage}, bo tam wejście przychodzi z sieci.
 */
export function contactMessageErrors(
  input: unknown,
  askPhone: boolean,
): ContactMessageFieldErrors {
  const parsed = parseContactMessage(input, askPhone);
  return parsed.ok ? {} : parsed.fields;
}

/**
 * WEJŚCIE AKCJI WYSYŁKI. Poza samą wiadomością niesie trzy rzeczy, które nie
 * są treścią, tylko DOWODAMI pochodzenia zgłoszenia:
 *
 *   • `sectionId` — z której sekcji przyszło. Serwer wyprowadza z niego
 *     adresata z OPUBLIKOWANEJ treści; adres nigdy nie przychodzi z klienta,
 *     bo formularz przyjmujący adresata byłby otwartą bramką do rozsyłki;
 *   • `ticket` — podpisany serwerowo znacznik czasu z chwili renderu;
 *   • `trap` — pole-pułapka (honeypot). Wypełnione = bot.
 */
export interface ContactSubmitInput extends ContactMessageInput {
  sectionId: string;
  ticket: string;
  /** Token CAPTCHY; brak = weryfikator odmówi, o ile CAPTCHA jest włączona. */
  captchaToken?: string;
  trap: string;
}

/**
 * Wynik akcji — zamknięty zbiór, każdy wariant ma własny komunikat w formularzu.
 *
 * `sent` NIE ZNACZY „wysłaliśmy": znaczy „przyjęliśmy i nie mamy nic do
 * powiedzenia". Zgłoszenie z wypełnioną pułapką kończy się TYM SAMYM statusem
 * bez wysyłki — bot, który dostaje inną odpowiedź niż człowiek, uczy się w
 * dziesięć minut, czego nie wypełniać.
 */
export type ContactSubmitResult =
  | { status: "sent" }
  | { status: "validation_error"; fields: ContactMessageFieldErrors }
  | { status: "rate_limited" }
  | { status: "captcha_failed" }
  /** Bilet nieważny: podrobiony, przeterminowany albo formularz wysłany natychmiast po renderze. */
  | { status: "expired" }
  /** Sekcja bez adresata albo poczta niedostępna — uczciwie, zamiast cichego sukcesu. */
  | { status: "unavailable" }
  | { status: "server_error" };

// -----------------------------------------------------------------------
// Dojazd — pierwszy typ z OSADZENIEM OBCEJ RAMKI (E5, ADR-096)
// -----------------------------------------------------------------------

/**
 * Warianty układu dojazdu. Dwa, bo tyle jest realnych odpowiedzi na pytanie
 * „co czyta odwiedzający":
 *   • `stacked` — adresy w rzędzie kart, mapa POD nimi na pełnej szerokości.
 *     Kto zna miasto, czyta adres i wychodzi; kto nie zna, otwiera mapę i ma ją
 *     szeroką;
 *   • `split` — adresy po lewej, mapa po prawej (poniżej progu schodzą w tę samą
 *     kolumnę, co `stacked`). Adres i mapa są wtedy widoczne naraz.
 *
 * Oba czytają TEN SAM `items` — przełącznik układu jest polem treści, więc jego
 * zmiana z definicji nie dosięga wpisów.
 */
export const DIRECTIONS_LAYOUTS = ["stacked", "split"] as const;
export type DirectionsLayout = (typeof DIRECTIONS_LAYOUTS)[number];

/** Górna granica lokalizacji — lustro `maxItems` w rejestrze (test pilnuje zgody). */
const DIRECTIONS_MAX_ITEMS = 6;

/**
 * Nazwa punktu („Magazyn", „Punkt odbioru — centrum"). OPCJONALNA, i to jest
 * decyzja konwersji, a nie niedbałość: sekcja dojazdu sprzed v3 znała JEDEN
 * adres i nie miała pola na jego nazwę, więc wymóg nazwy kazałby konwersji ją
 * WYMYŚLIĆ. Jeden punkt bez nazwy renderuje się jako sam adres — dokładnie to,
 * co strona pokazywała wcześniej.
 */
const directionsLabel = z.string().trim().min(1).max(120);

/**
 * Adres punktu — JEDYNE pole wymagane. Sekcja dojazdu bez ani jednego adresu
 * jest pustym nagłówkiem (klasa atrap usuwana przez ADR-094), a dodatkowo nie
 * ma z czego zbudować ani mapy, ani nawigacji: obie liczą się WYŁĄCZNIE z tego
 * napisu.
 */
const directionsAddressValue = z.string().trim().min(1).max(300);

/** Godziny otwarcia punktu — tekst najemcy, nie kalendarz (ta sama zasada, co w kontakcie). */
const directionsHoursValue = z.string().trim().min(1).max(200);

export const directionsStructuredSchema = z
  .object({
    v: z.literal(STRUCTURED_SECTION_VERSION),
    type: z.literal("directions"),
    layout: z.enum(DIRECTIONS_LAYOUTS),
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    heading: heading.optional(),
    /**
     * Lokalizacje. MINIMUM JEDNA — patrz {@link directionsAddressValue}.
     * Lista, a nie jeden adres, bo wypożyczalnia realnie ma magazyn i punkt
     * odbioru, a do niedawna model pozwalał opisać tylko jedno z nich.
     */
    items: z
      .array(
        z
          .object({
            label: directionsLabel.optional(),
            address: directionsAddressValue,
            hours: directionsHoursValue.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(DIRECTIONS_MAX_ITEMS),
  })
  .strict();

export type DirectionsStructuredContent = z.infer<typeof directionsStructuredSchema>;
export type DirectionsStructuredItem = DirectionsStructuredContent["items"][number];

/**
 * ORIGIN DOSTAWCY MAP — lustro źródła ramki w polityce CSP (`maps` w
 * @avably/security). Stała stoi tutaj, przy adresach, żeby zmiana dostawcy była
 * JEDNĄ zmianą w jednym pliku; test rdzenia pilnuje, że oba adresy niżej z niej
 * wychodzą, a test polityki — że dokładnie ten origin wpuszcza `frame-src`.
 */
export const MAP_PROVIDER_ORIGIN = "https://www.google.com";

/**
 * ADRES OSADZONEJ MAPY dla adresu punktu.
 *
 * ==================== BEZ KLUCZA API, BEZ SDK ====================
 *
 * `output=embed` na zwykłym wyszukiwaniu daje ramkę mapy bez klucza, bez konta
 * i bez ani jednego skryptu dostawcy na naszej stronie. Wersja z SDK (Maps
 * JavaScript API) znaczyłaby: klucz w bundlu, obcy skrypt z `strict-dynamic`,
 * rozliczane wywołania i drugą zależność do pilnowania — za funkcję, która ma
 * pokazać, gdzie stoi magazyn.
 *
 * Adres jedzie przez `encodeURIComponent`, więc spacje, przecinki i polskie
 * znaki nie rozsadzają zapytania.
 */
export function directionsMapEmbedSrc(address: string): string {
  return `${MAP_PROVIDER_ORIGIN}/maps?q=${encodeURIComponent(address)}&output=embed`;
}

/**
 * ADRES NAWIGACJI („Prowadź") — otwiera trasę w serwisie map, na telefonie
 * w aplikacji. `api=1` to udokumentowana, stabilna postać takiego odnośnika;
 * `destination` przyjmuje adres tekstem, więc nie potrzebujemy współrzędnych,
 * których najemca i tak nigdzie nie ma.
 */
export function directionsRouteHref(address: string): string {
  return `${MAP_PROVIDER_ORIGIN}/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

/**
 * LOKALIZACJE WYPROWADZONE ZE STAREJ TREŚCI (konwersja E5).
 *
 * Dojazd jest konwertowalny w obu generacjach, ale NIE tak samo głęboko:
 *
 *   • v1 niesie OSOBNE pola (`address`, `hours`), więc obie wartości mają
 *     zapisane znaczenie i jadą wprost;
 *   • PŁÓTNO v2 spłaszczyło je do napisów. Przenosimy stamtąd PIERWSZY napis
 *     jako adres — tyle wynika z kolejności czytania i z tego, jak układa
 *     sekcję nasza własna konwersja v1→v2. Napisu DRUGIEGO nie tykamy, choć
 *     bywa godzinami: „bywa" to za mało, żeby podpisać dowolne zdanie operatora
 *     etykietą „Godziny otwarcia". To jest ta sama granica, co przy FAQ (który
 *     napis był pytaniem) — z tą różnicą, że tu pierwszy napis ma znaczenie
 *     wymuszone geometrią, więc jego przeniesienie nie jest zgadywaniem.
 *
 * `mapsUrl` z v1 NIE JEDZIE i to jest decyzja: mapa i nawigacja liczą się
 * w v3 WYŁĄCZNIE z adresu, więc zapisany odnośnik byłby drugim źródłem prawdy
 * o tym samym miejscu — i pierwsza poprawka adresu rozjechałaby stronę
 * z przyciskiem, który dalej prowadzi pod stary pinezkowy link.
 */
export function directionsLocationsFromLegacy(content: unknown): DirectionsStructuredItem[] {
  if (isSectionCanvas(content)) return directionsLocationsFromCanvas(content);
  return directionsLocationsFromV1(content);
}

function directionsLocationsFromCanvas(canvas: SectionCanvas): DirectionsStructuredItem[] {
  const firstText = canvas.elements
    .filter((element): element is Extract<CanvasElement, { kind: "text" }> => element.kind === "text")
    .slice()
    .sort(
      (a, b) =>
        a.layout.desktop.y - b.layout.desktop.y || a.layout.desktop.x - b.layout.desktop.x,
    )[0];
  const address = firstText?.text.trim();
  return address && address.length > 0 ? [{ address: address.slice(0, 300) }] : [];
}

/** Sekcja dojazdu SPRZED płótna: osobne pola adresu i godzin (schemat v1). */
function directionsLocationsFromV1(content: unknown): DirectionsStructuredItem[] {
  if (typeof content !== "object" || content === null) return [];
  const source = content as Record<string, unknown>;
  const address = typeof source.address === "string" ? source.address.trim() : "";
  if (address.length === 0) return [];
  const hours = typeof source.hours === "string" ? source.hours.trim() : "";
  return [
    {
      address: address.slice(0, 300),
      ...(hours.length > 0 ? { hours: hours.slice(0, 200) } : {}),
    },
  ];
}

// -----------------------------------------------------------------------
// Cennik — pierwszy typ z polem PIENIĘŻNYM (E6, aneks ADR-094)
// -----------------------------------------------------------------------

/**
 * Warianty układu cennika. Dwa, bo tyle jest realnych odpowiedzi na pytanie
 * „co robi odwiedzający z tą listą":
 *   • `table` — PORÓWNUJE. Nazwa i cena stoją w kolumnach, więc oko przebiega
 *     ceny w pionie i widzi różnice między pozycjami;
 *   • `cards` — CZYTA POJEDYNCZO. Każda pozycja jest kaflem z miejscem na
 *     notkę („min. 3 doby", „z montażem"), której w wierszu tabeli nie ma jak
 *     zmieścić bez rozbicia rytmu kolumn.
 *
 * Oba czytają TEN SAM `items` — przełącznik układu jest polem treści, więc jego
 * zmiana z definicji nie dosięga wpisów.
 */
export const PRICING_LAYOUTS = ["table", "cards"] as const;
export type PricingLayout = (typeof PRICING_LAYOUTS)[number];

/**
 * JEDNOSTKA ROZLICZENIOWA POZYCJI — ZAMKNIĘTY SŁOWNIK, nie pole tekstowe.
 *
 * ==================== DLACZEGO NIE TEKST ====================
 *
 * Kusi wpuścić dowolny napis („za dobę", „/24h", „doba (netto)”) — najemca zna
 * swój cennik lepiej niż my. Odpada z tego samego powodu, dla którego rodzaj
 * wpisu kontaktowego jest słownikiem (E4): jednostka jest CHROME renderu, więc
 * jej nazwa musi iść z JĘZYKA STRONY. Najemca prowadzący sklep po polsku
 * i po angielsku wpisałby „doba” raz, a angielski sklep pokazywałby „doba”
 * przy każdej cenie — i nie miałby jak tego naprawić, nie psując polskiego.
 *
 * ==================== SKĄD TE PIĘĆ ====================
 *
 * `day` jest kotwicą, bo cały katalog liczy w dobach (`base_price_day_grosze`,
 * progi `tier_days`) i storefront ma na nią gotowe słowo (`common.perDay`).
 * `hour`, `week` i `month` to pozostałe realne okresy najmu, a `piece` —
 * pozycje sprzedawane na sztuki (krzesło, nakrycie), których cennik
 * wypożyczalni jest pełny. Szóstej nie ma ŚWIADOMIE: każda kolejna musiałaby
 * mieć nazwę w obu językach i miejsce w słowniku, a nie „bo może się przyda".
 */
export const PRICING_UNITS = ["hour", "day", "week", "month", "piece"] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

/**
 * CZY CENA JEST DOKŁADNA, CZY WYJŚCIOWA. Brief E6 mówił o polu `from` (flaga
 * „od” per pozycja); w treści stoi SŁOWNIK dwuwartościowy, i to z dwóch
 * powodów. Pierwszy jest o edytorze: szuflada zna przełączniki CAŁEJ SEKCJI,
 * ale nie zna przełącznika przy pojedynczym wpisie — słownik wchodzi za to
 * istniejącą kontrolką listy zamkniętej (E4) i nie kosztuje ani jednej nowej
 * ścieżki zapisu. Drugi jest o przyszłości: „od 60 zł” i „60 zł” to dwa punkty
 * skali, na której są jeszcze „do” i „od–do”; flaga logiczna zamknęłaby ją na
 * dwóch, a rozszerzenie słownika jest wpisem, nie migracją znaczenia.
 */
export const PRICING_PRICE_MODES = ["exact", "from"] as const;
export type PricingPriceMode = (typeof PRICING_PRICE_MODES)[number];

/** Górna granica pozycji — lustro `maxItems` w rejestrze (test pilnuje zgody). */
const PRICING_MAX_ITEMS = 40;

/** Nazwa pozycji cennika („Wiertarka udarowa”, „Namiot 5×10 m”). */
const pricingName = z.string().trim().min(1).max(200);

/** Notka pozycji („min. 3 doby”, „z montażem”) — widoczny tekst, więc pusta nie ma sensu. */
const pricingNote = z.string().trim().min(1).max(200);

/**
 * PRZYPIS CAŁEJ SEKCJI („Ceny netto. Kaucja zwrotna liczona osobno.”). Pole
 * sekcji, nie wpisu — i jest to jedyne pole treści, które sekcja cennika miała
 * już w generacji v1, więc to przez nie konwersja przenosi cokolwiek prócz
 * nagłówka.
 *
 * NAZWA `footnote`, A NIE `note`, i to nie jest kosmetyka: wpis ma WŁASNE pole
 * `note` („Minimum 20 sztuk”), a szuflada pyta i18n o etykietę PO KLUCZU POLA.
 * Dwa różne pola pod jednym kluczem dostałyby w edytorze jedną etykietę — czyli
 * przypis całego cennika podpisany „Notka przy pozycji”.
 */
const pricingFootnote = z.string().trim().min(1).max(500);

/**
 * CENA W JEDNOSTKACH PODRZĘDNYCH (`int`) — kanon pieniędzy w tym projekcie
 * i jedyny dopuszczalny zapis. Trzy granice, każda z powodem:
 *   • `int` — grosz jest niepodzielny, a `12.005` w treści sekcji byłoby ceną,
 *     której nie da się zapłacić ani wystawić na fakturze;
 *   • `min(0)` — cennik z ceną ujemną nie jest cennikiem, tylko rabatem,
 *     którego model nie zna. Zero zostaje legalne: „0 zł / doba” przy pozycji
 *     „Dowóz do 10 km” jest realną informacją handlową, a nie brakiem ceny;
 *   • `max` — milion w walucie rozliczeniowej. Nie ma tu nic świętego poza
 *     tym, że liczba wpisana przez pomyłkę (wklejony numer telefonu) ma odpaść
 *     na schemacie, a nie rozjechać kolumnę cen na opublikowanej stronie.
 */
const pricingPriceGrosze = z.number().int().min(0).max(100_000_000);

export const pricingStructuredSchema = z
  .object({
    v: z.literal(STRUCTURED_SECTION_VERSION),
    type: z.literal("pricing"),
    layout: z.enum(PRICING_LAYOUTS),
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    heading: heading.optional(),
    /**
     * Pozycje cennika. MINIMUM JEDNA — sekcja cennika bez ani jednej ceny jest
     * pustym nagłówkiem, czyli dokładnie tą atrapą, którą ADR-094 usuwa
     * z produktu. I jest to zarazem cała różnica wobec generacji v1, która
     * pojęcia ceny NIE ZNAŁA (`{ heading?, note? }`) — patrz `fromLegacy`.
     */
    items: z
      .array(
        z
          .object({
            name: pricingName,
            price_grosze: pricingPriceGrosze,
            unit: z.enum(PRICING_UNITS),
            mode: z.enum(PRICING_PRICE_MODES).default("exact"),
            note: pricingNote.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(PRICING_MAX_ITEMS),
    /** Przypis pod listą — jedyne pole treści, które v1 cennika naprawdę miało. */
    footnote: pricingFootnote.optional(),
    /**
     * Czy pod cennikiem stoi odnośnik do katalogu. DOMYŚLNIE WŁĄCZONY: cennik
     * jest miejscem, w którym odwiedzający wie już, ile to kosztuje, i chce
     * zobaczyć, co konkretnie jest do wzięcia — a wyłączyć go trzeba móc, bo
     * sekcja stojąca tuż nad katalogiem odsyłałaby tam, gdzie odwiedzający
     * właśnie jest.
     */
    showCatalogLink: z.boolean().default(true),
  })
  .strict();

export type PricingStructuredContent = z.infer<typeof pricingStructuredSchema>;
export type PricingStructuredItem = PricingStructuredContent["items"][number];

/**
 * ADRES KATALOGU. Jedno miejsce, bo dziś jest jeden: publiczny sklep najemcy
 * stoi pod `/store` i to tam mieszka pełna lista sprzętu z dostępnością.
 *
 * ŚWIADOMY DZISIEJSZY KOSZT: sekcje strony renderują się na TEJ SAMEJ trasie,
 * więc odnośnik prowadzi na górę bieżącej strony, a nie na inną. Zostaje mimo
 * to — bo `/store` jest jedyną trasą, pod którą katalog istnieje, a przełącznik
 * `showCatalogLink` daje operatorowi wyjście tam, gdzie sekcja i tak stoi obok
 * katalogu. Gdy model strony dostanie podstrony, odnośnik zacznie przechodzić
 * między nimi bez ani jednej zmiany w renderze.
 */
export const PRICING_CATALOG_HREF = "/store";

/**
 * POZYCJE STARTOWE CENNIKA — osobna stała, bo czyta je DWÓCH wołających:
 * preset typu i konwersja ze starej treści (która pozycji nie ma skąd wziąć,
 * patrz {@link pricingHeadAndNoteFromLegacy}). Dwie kopie tej samej listy
 * rozjechałyby się przy pierwszej poprawce, a operator dostawałby inny cennik
 * startowy w zależności od tego, którą drogą sekcja powstała.
 */
const PRICING_PRESET_ITEMS = {
  pl: [
    { name: "Namiot 5 × 10 m z montażem", price_grosze: 90_000, unit: "day", mode: "from" },
    { name: "Stół bankietowy 220 cm", price_grosze: 2_500, unit: "day", mode: "exact" },
    {
      name: "Krzesło bankietowe z pokrowcem",
      price_grosze: 800,
      unit: "piece",
      mode: "exact",
      note: "Minimum 20 sztuk",
    },
    {
      name: "Nagłośnienie z obsługą",
      price_grosze: 25_000,
      unit: "hour",
      mode: "from",
      note: "Minimum 3 godziny",
    },
  ],
  en: [
    { name: "5 × 10 m marquee, installed", price_grosze: 90_000, unit: "day", mode: "from" },
    { name: "220 cm banquet table", price_grosze: 2_500, unit: "day", mode: "exact" },
    {
      name: "Banquet chair with cover",
      price_grosze: 800,
      unit: "piece",
      mode: "exact",
      note: "Minimum 20 pieces",
    },
    {
      name: "Sound system with an operator",
      price_grosze: 25_000,
      unit: "hour",
      mode: "from",
      note: "Minimum 3 hours",
    },
  ],
} as const;

/** Słowa, których render potrzebuje do złożenia etykiety ceny (język STRONY). */
export interface PricingPriceWords {
  /** Przedrostek ceny wyjściowej — „od” / „from”. */
  from: string;
  /** Nazwa jednostki rozliczeniowej — „doba” / „day”. */
  unit: string;
}

/**
 * ETYKIETA CENY — „120,00 zł / doba”, „od 60,00 zł / godzina”.
 *
 * Składanie stoi TUTAJ, a nie w dwóch komponentach układu, bo jest jedno:
 * kopia w tabeli i kopia w kartach rozjechałyby się przy pierwszej poprawce
 * (a rozjazd dotyczyłby CENY). Sama kwota idzie przez {@link formatMoney} —
 * jedyny formatter pieniędzy w systemie. Dzielenia przez sto w tym pliku nie
 * ma i mieć nie może: separator dziesiętny, pozycja symbolu i odstęp tysięcy
 * są własnością locale, a nie naszej arytmetyki.
 */
export function pricingPriceLabel(
  item: PricingStructuredItem,
  currency: CurrencyCode,
  locale: string,
  words: PricingPriceWords,
): string {
  const money = formatMoney(item.price_grosze, currency, locale);
  const amount = item.mode === "from" ? `${words.from} ${money}` : money;
  return `${amount} / ${words.unit}`;
}

/**
 * TREŚĆ CENNIKA WYPROWADZONA ZE STAREJ GENERACJI (konwersja E6) — albo `null`.
 *
 * ==================== CZEGO TU NIE MA I DLACZEGO ====================
 *
 * POZYCJE NIE JADĄ, bo ich w starej treści NIE MA. Sekcja cennika v1 to
 * dosłownie `{ heading?, note? }` — dwa napisy, ani jednej ceny (to jest ten
 * „cennik, który nie zna pojęcia ceny” z nagłówka tego pliku, i powód, dla
 * którego E6 w ogóle istnieje). Płótno v2 dostawało z niej dokładnie tyle samo:
 * nagłówek i jeden akapit. Wyprowadzenie pozycji znaczyłoby więc rozbicie
 * zdania operatora na nazwy i kwoty — czyli WYMYŚLENIE cen, a nie ich
 * przeniesienie. To ta sama granica, co przy FAQ („który napis był pytaniem”),
 * z jednym zaostrzeniem: pomyłka o rząd wielkości w cenie jest widoczna dopiero
 * u klienta, który już zapłacił.
 *
 * ==================== CO JEDZIE ====================
 *
 * Wszystko, co w starej treści MA zapisane znaczenie: nagłówek i notka. Pozycje
 * przychodzą z presetu — tak samo, jak przyszłyby przy braku konwersji w ogóle
 * (patrz {@link structuredFromLegacy}) — więc operator dostaje swoją sekcję
 * z gotowym rusztowaniem do nadpisania, zamiast tracić dwa napisy, które
 * naprawdę napisał.
 *
 * Z płótna bierzemy PIERWSZY nagłówek i PIERWSZY akapit w kolejności czytania:
 * ich znaczenie jest wymuszone geometrią NASZEJ WŁASNEJ konwersji v1→v2, która
 * układa sekcję cennika dokładnie w tej kolejności (ta sama zasada, co przy
 * adresie dojazdu w E5).
 */
export function pricingHeadAndNoteFromLegacy(content: unknown): {
  heading?: string;
  footnote?: string;
} {
  if (isSectionCanvas(content)) {
    const canvasNote = canvasFirstText(content);
    const legacyHeading = canvasHeading(content);
    return {
      ...(legacyHeading ? { heading: legacyHeading } : {}),
      ...(canvasNote ? { footnote: canvasNote.slice(0, 500) } : {}),
    };
  }
  if (typeof content !== "object" || content === null) return {};
  const source = content as Record<string, unknown>;
  const legacyHeading = typeof source.heading === "string" ? source.heading.trim() : "";
  const legacyNote = typeof source.note === "string" ? source.note.trim() : "";
  return {
    ...(legacyHeading.length > 0 ? { heading: legacyHeading.slice(0, 200) } : {}),
    ...(legacyNote.length > 0 ? { footnote: legacyNote.slice(0, 500) } : {}),
  };
}

// -----------------------------------------------------------------------
// Opinie — typ CYTATOWY (E6, aneks ADR-094)
// -----------------------------------------------------------------------

/**
 * Warianty układu opinii. Dwa, bo tyle jest realnych odpowiedzi na pytanie
 * „ile miejsca opinie mają zająć":
 *   • `grid` — wszystkie naraz, jedna pod drugą i obok siebie. Kto czyta,
 *     porównuje; kto przewija, widzi, że opinii jest wiele;
 *   • `carousel` — jeden pas przewijany w bok, gdy opinii jest dużo, a strona
 *     ma je pokazać, nie zamienić się w nie.
 *
 * Oba czytają TEN SAM `items` — przełącznik układu jest polem treści.
 */
export const TESTIMONIALS_LAYOUTS = ["grid", "carousel"] as const;
export type TestimonialsLayout = (typeof TESTIMONIALS_LAYOUTS)[number];

/** Górna granica opinii — lustro `maxItems` w rejestrze i granicy schematu v1. */
const TESTIMONIALS_MAX_ITEMS = 20;

/** Sama opinia. Dłuższa niż `shortText` v1, bo v1 ucinał realne wypowiedzi. */
const testimonialQuote = z.string().trim().min(1).max(1_000);

/** Podpis pod opinią — imię albo nazwa firmy. */
const testimonialAuthor = z.string().trim().min(1).max(120);

/**
 * Rola podpisującego („Organizatorka wesela”, „Kierownik budowy”). OPCJONALNA
 * — tak samo, jak w schemacie v1, z którego jedzie konwersja: wymóg roli
 * kazałby jej WYMYŚLIĆ przy każdej opinii, która jej nie miała.
 */
const testimonialRole = z.string().trim().min(1).max(120);

export const testimonialsStructuredSchema = z
  .object({
    v: z.literal(STRUCTURED_SECTION_VERSION),
    type: z.literal("testimonials"),
    layout: z.enum(TESTIMONIALS_LAYOUTS),
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    heading: heading.optional(),
    /**
     * Opinie. MINIMUM JEDNA — sekcja opinii bez ani jednej opinii jest pustym
     * nagłówkiem (klasa atrap usuwana przez ADR-094). Podpis jest WYMAGANY,
     * i to jest decyzja o wiarygodności: cytat bez autora nie jest opinią,
     * tylko hasłem reklamowym w cudzysłowie.
     */
    items: z
      .array(
        z
          .object({
            quote: testimonialQuote,
            author: testimonialAuthor,
            role: testimonialRole.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(TESTIMONIALS_MAX_ITEMS),
  })
  .strict();

export type TestimonialsStructuredContent = z.infer<typeof testimonialsStructuredSchema>;
export type TestimonialsStructuredItem = TestimonialsStructuredContent["items"][number];

/**
 * SEPARATOR PODPISU NA PŁÓTNIE. Konwersja v1→v2 skleja autora z rolą DOKŁADNIE
 * tym ciągiem (`${author} — ${role}` w `canvas-presets`), więc rozdzielenie go
 * z powrotem jest ODWRÓCENIEM NASZEJ WŁASNEJ operacji, a nie interpretacją
 * cudzego zdania. Stała stoi tutaj, żeby obie strony tej pary miały jedno
 * źródło i żeby zmiana sklejania zapaliła test rozdzielania.
 */
const TESTIMONIAL_BYLINE_SEPARATOR = " — ";

/**
 * OPINIE WYPROWADZONE ZE STAREJ TREŚCI (konwersja E6).
 *
 * Opinie są — inaczej niż cennik — konwertowalne w OBU generacjach, i to bez
 * ani jednego zgadywania:
 *
 *   • v1 niesie pełną trójkę (`quote`, `author`, `role`), więc wpisy jadą CO DO
 *     JEDNEGO i w swojej kolejności;
 *   • PŁÓTNO v2 spłaszczyło je do napisów, ale nie do NIEROZRÓŻNIALNYCH
 *     napisów: nasza konwersja zapisała cytat jako tekst wariantu `lead`,
 *     a podpis jako następujący po nim tekst wariantu `small`. Wariant jest
 *     w treści zapisany wprost, więc para (cytat, podpis) jest do ODCZYTANIA,
 *     a nie do rozpoznania po kształcie. Podpis rozdzielamy z powrotem po
 *     {@link TESTIMONIAL_BYLINE_SEPARATOR} — na PIERWSZYM wystąpieniu, żeby
 *     rola zawierająca ten sam znak została rolą, a nie zniknęła.
 *
 * Kolejność bierzemy z kolejności CZYTANIA płótna (od góry, potem od lewej) —
 * ta sama zasada, co w galerii i kontakcie: kolejność w tablicy elementów jest
 * kolejnością DODAWANIA i po kilku poprawkach nie ma nic wspólnego z tym, co
 * operator widzi na ekranie.
 */
export function testimonialsFromLegacy(content: unknown): TestimonialsStructuredItem[] {
  if (isSectionCanvas(content)) return testimonialsFromCanvas(content);
  return testimonialsFromV1(content);
}

/**
 * PODPIS NALEŻY DO CYTATU PO KOLUMNIE, A NIE PO SĄSIEDZTWIE W LIŚCIE.
 *
 * ==================== LUKA ZNALEZIONA WŁASNYM KONTRAKTEM ====================
 *
 * Pierwsza wersja brała podpis jako NASTĘPNY tekst w kolejności czytania — co
 * jest poprawne dokładnie do chwili, w której spojrzy się na realne płótno.
 * Konwersja v1→v2 układa opinie w DWÓCH KOLUMNACH, więc kolejność czytania
 * (od góry, potem od lewej) daje: cytat 1, cytat 2, podpis 1, podpis 2,
 * cytat 3… Sąsiadem cytatu 1 jest tam cytat 2, a nie jego własny podpis —
 * heurystyka „następny tekst" podpisywała więc opinię CUDZYM nazwiskiem
 * i po cichu gubiła co drugą. Kontrakt zapalił się na fiksturze CZTERECH
 * rozróżnialnych opinii; przy jednej opinii przechodził na zielono.
 *
 * Prawdziwe wiązanie jest GEOMETRYCZNE i zapisane wprost w tym, co konwersja
 * narysowała: podpis stoi w TEJ SAMEJ KOLUMNIE (ten sam `x`), bezpośrednio
 * pod swoim cytatem. To odczytanie własnego układu, a nie zgadywanie sensu.
 */
function testimonialsFromCanvas(canvas: SectionCanvas): TestimonialsStructuredItem[] {
  type TextElement = Extract<CanvasElement, { kind: "text" }>;

  const texts = canvas.elements
    .filter((element): element is TextElement => element.kind === "text")
    .slice()
    .sort(
      (a, b) =>
        a.layout.desktop.y - b.layout.desktop.y || a.layout.desktop.x - b.layout.desktop.x,
    );

  const quotes = texts.filter((element) => element.variant === "lead");
  const bylines = texts.filter((element) => element.variant === "small");
  const taken = new Set<TextElement>();

  const items: TestimonialsStructuredItem[] = [];
  for (const element of quotes) {
    const quote = element.text.trim();
    if (quote.length === 0) continue;

    // Pierwszy NIEZAJĘTY podpis w tej samej kolumnie, poniżej cytatu. Lista
    // jest już posortowana od góry, więc „pierwszy" znaczy „najbliższy".
    const byline = bylines.find(
      (candidate) =>
        !taken.has(candidate) &&
        candidate.layout.desktop.x === element.layout.desktop.x &&
        candidate.layout.desktop.y > element.layout.desktop.y,
    );
    // Cytat bez podpisu ODPADA: schemat wymaga autora, a wymyślenie go byłoby
    // fabrykowaniem dowodu społecznego — czyli dokładnie tym, czego ten produkt
    // ma nie robić.
    if (!byline) continue;
    const signature = byline.text.trim();
    if (signature.length === 0) continue;
    taken.add(byline);

    const cut = signature.indexOf(TESTIMONIAL_BYLINE_SEPARATOR);
    const author = cut > 0 ? signature.slice(0, cut) : signature;
    const role = cut > 0 ? signature.slice(cut + TESTIMONIAL_BYLINE_SEPARATOR.length).trim() : "";
    items.push({
      quote: quote.slice(0, 1_000),
      author: author.slice(0, 120),
      ...(role.length > 0 ? { role: role.slice(0, 120) } : {}),
    });
  }
  return items.slice(0, TESTIMONIALS_MAX_ITEMS);
}

/** Sekcja opinii SPRZED płótna: gotowa lista trójek (schemat v1). */
function testimonialsFromV1(content: unknown): TestimonialsStructuredItem[] {
  if (typeof content !== "object" || content === null) return [];
  const items = (content as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const source = item as Record<string, unknown>;
      const quote = typeof source.quote === "string" ? source.quote.trim() : "";
      const author = typeof source.author === "string" ? source.author.trim() : "";
      if (quote.length === 0 || author.length === 0) return null;
      const role = typeof source.role === "string" ? source.role.trim() : "";
      return {
        quote: quote.slice(0, 1_000),
        author: author.slice(0, 120),
        ...(role.length > 0 ? { role: role.slice(0, 120) } : {}),
      };
    })
    .filter((item): item is TestimonialsStructuredItem => item !== null)
    .slice(0, TESTIMONIALS_MAX_ITEMS);
}

// -----------------------------------------------------------------------
// Sprzęt — pierwszy typ czytający KATALOG, a nie własną treść (E7)
// -----------------------------------------------------------------------

/**
 * Warianty układu sprzętu. Dwa, bo tyle jest realnych odpowiedzi na pytanie
 * „ile miejsca sprzęt ma zająć na stronie":
 *   • `grid` — kafle ze zdjęciem, po kilka w rzędzie. Strona pokazuje SPRZĘT:
 *     zdjęcie jest tu argumentem sprzedażowym, a nie ozdobą;
 *   • `list` — wiersze z miniaturą, nazwą i ceną, jeden pod drugim. Strona
 *     pokazuje OFERTĘ: ceny stoją w jednej kolumnie i dają się przebiec okiem,
 *     a sekcja zajmuje ułamek wysokości siatki.
 *
 * Oba czytają TĘ SAMĄ treść — przełącznik układu jest polem treści, więc jego
 * zmiana z definicji nie dosięga wyboru pozycji.
 */
export const PRODUCTS_LAYOUTS = ["grid", "list"] as const;
export type ProductsLayout = (typeof PRODUCTS_LAYOUTS)[number];

/**
 * SKĄD SEKCJA BIERZE POZYCJE — i dlaczego to NIE JEST „najnowsze / kategoria".
 *
 * ==================== ZAŁOŻENIE, KTÓRE NIE ISTNIEJE ====================
 *
 * Brief E7 przewidywał dwie osie źródła: „najnowsze" i „kategoria z katalogu
 * tenanta". Żadnej z nich nie da się dziś policzyć, i nie jest to kwestia
 * nakładu pracy:
 *   • KATEGORII NIE MA w modelu — ani tabeli, ani kolumny na `products`.
 *     Sekcja strony nie jest miejscem, w którym powstaje taksonomia katalogu;
 *   • NAJNOWSZE nie przechodzi granicą danych: `app.get_public_catalog` (0020)
 *     nie wypuszcza `created_at`, a panel czyta tabelę wprost. Sortowanie po
 *     dacie znaczyłoby więc INNĄ kolejność w podglądzie kreatora niż w sklepie
 *     — czyli podgląd, który kłamie o tym, co zobaczy klient (a to jest cała
 *     stawka wspólnego renderera, ADR-083).
 *
 * ==================== CO STOI W ICH MIEJSCU (decyzja właściciela) ====================
 *
 *   • `catalog` — pierwsze `limit` pozycji katalogu w jego własnej kolejności.
 *     Stan DOMYŚLNY i jedyny możliwy dla presetu oraz konwersji: ani jedno, ani
 *     drugie nie ma skąd wziąć identyfikatorów sprzętu, który dopiero powstanie;
 *   • `picked` — RĘCZNY WYBÓR pozycji (decyzja właściciela, 2026-08-05). Operator
 *     wskazuje konkretny sprzęt w szufladzie, a treść niesie jego identyfikatory.
 *
 * Wybór jest SŁOWNIKIEM, a nie flagą logiczną, z tego samego powodu, co tryb
 * ceny w cenniku (E6): „katalog" i „ręcznie" to dwa punkty skali, na której są
 * jeszcze „kategoria" i „najnowsze" — dopisanie ich będzie wpisem do słownika,
 * a nie zmianą znaczenia pola.
 */
export const PRODUCTS_SOURCES = ["catalog", "picked"] as const;
export type ProductsSource = (typeof PRODUCTS_SOURCES)[number];

/** Górna granica wskazanych pozycji — lustro `maxItems` w rejestrze. */
const PRODUCTS_MAX_ITEMS = 24;

/**
 * ILE POZYCJI POKAZAĆ — zbiór ZAMKNIĘTY w granicach 2–24 z briefu.
 *
 * Kusi wpuścić dowolną liczbę całkowitą z przedziału. Odpada, bo szuflada zna
 * kontrolkę listy zamkniętej i nie zna pola liczbowego (a pole liczbowe
 * przeglądarki zmienia wartość przy przewinięciu kółkiem — patrz uzasadnienie
 * przy polu pieniężnym E6). Zbiór jest przy tym gęstszy tam, gdzie realnie się
 * wybiera: różnica między 8 a 12 kaflami jest widoczna, między 13 a 14 — nie.
 */
export const PRODUCTS_LIMITS = [2, 3, 4, 6, 8, 12, 16, 24] as const;
export type ProductsLimit = (typeof PRODUCTS_LIMITS)[number];

export const productsStructuredSchema = z
  .object({
    v: z.literal(STRUCTURED_SECTION_VERSION),
    type: z.literal("products"),
    layout: z.enum(PRODUCTS_LAYOUTS),
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    heading: heading.optional(),
    source: z.enum(PRODUCTS_SOURCES).default("catalog"),
    /**
     * WSKAZANE POZYCJE — identyfikatory sprzętu z katalogu najemcy.
     *
     * PUSTA LISTA JEST LEGALNA i to jest jedyne odstępstwo od reguły „sekcja
     * bez ani jednego wpisu jest atrapą" (ADR-094). Powód jest w naturze tego
     * typu: treścią sekcji sprzętu NIE JEST jej lista, tylko KATALOG — przy
     * `source: "catalog"` sekcja z pustą listą pokazuje pełny wycinek oferty
     * i pustego nagłówka nie ma jak z niej zrobić. Odwrotnie niż w FAQ, gdzie
     * pustka znaczy „nie napisano ani jednego pytania".
     *
     * SAM IDENTYFIKATOR, bez kopii nazwy i ceny. Kopia byłaby drugim źródłem
     * prawdy o cenie — a cena zmieniona w katalogu zostawiłaby na stronie
     * głównej ofertę, której najemca już nie składa. Pozycja usunięta z
     * katalogu po prostu WYPADA z sekcji (render pomija nierozpoznane
     * identyfikatory), zamiast pokazywać sprzęt, którego nie ma.
     */
    items: z
      .array(z.object({ productId: z.string().uuid() }).strict())
      .max(PRODUCTS_MAX_ITEMS)
      .default([]),
    /** Sufit liczby pokazanych pozycji — patrz {@link PRODUCTS_LIMITS}. */
    limit: z
      .union([
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(6),
        z.literal(8),
        z.literal(12),
        z.literal(16),
        z.literal(24),
      ])
      .default(8),
  })
  .strict();

export type ProductsStructuredContent = z.infer<typeof productsStructuredSchema>;
export type ProductsStructuredItem = ProductsStructuredContent["items"][number];

/** Adres katalogu — ten sam, do którego odsyła cennik (jedna trasa, jedna stała). */
export const PRODUCTS_CATALOG_HREF = PRICING_CATALOG_HREF;

/**
 * PEŁNE RZĘDY: ile kafli zostaje po ucięciu W DÓŁ do ostatniego pełnego rzędu.
 *
 * ==================== CO TO NAPRAWIA ====================
 *
 * Osiem kafli w siatce trzykolumnowej daje 3 + 3 + 2, czyli dwa kafle i dziurę
 * obok nich. Dziura w liście OPINII jest brzydka; dziura w liście SPRZĘTU
 * czyta się jako „tu miało być coś jeszcze" — bo obok stoi katalog, w którym
 * naprawdę jest coś jeszcze. E6 zamykał to przeciwnym ruchem (wpisy ROSNĄ
 * i wypełniają rząd), który tu nie działa: kafel sprzętu ma zdjęcie o stałej
 * proporcji, więc rozciągnięty dwukrotnie rośnie też W PIONIE i ostatni rząd
 * staje się największym elementem sekcji.
 *
 * Zostaje ucięcie w dół — i jest ono UCZCIWE dokładnie dlatego, że sekcja ma
 * odnośnik do katalogu: nie chowamy oferty, tylko odsyłamy po resztę tam, gdzie
 * jest jej pełna lista (patrz {@link productsCatalogLinkVisible}).
 *
 * ==================== GRANICA: JEDEN NIEPEŁNY RZĄD ====================
 *
 * Gdy pozycji jest MNIEJ niż kolumn, nie ma czego uciąć — jedyny rząd jest
 * niepełny z konstrukcji, a jego ucięcie dałoby sekcję pustą. Dwie pozycje w
 * siatce trzykolumnowej zostają więc dwiema pozycjami.
 *
 * Sam podział pracy jest ten sam, co w E6: LICZBĘ liczy ta funkcja (dane),
 * a to, ile kolumn ma siatka przy danej szerokości kontenera, niesie ARKUSZ —
 * bo kolumny zmieniają się z szerokością, której render nie zna. Arkusz
 * realizuje dokładnie tę regułę i pilnuje tego kontrakt artefaktu w @avably/ui.
 */
export function fullRowCount(count: number, columns: number): number {
  if (columns <= 1 || count <= columns) return count;
  return count - (count % columns);
}

/**
 * CZY POD SEKCJĄ STOI ODNOŚNIK „ZOBACZ CAŁY SPRZĘT" — WARUNEK NA DANYCH, a nie
 * przełącznik operatora.
 *
 * Cennik ma tu przełącznik (`showCatalogLink`) i to jest różnica ZAMIERZONA:
 * tam odnośnik jest zaproszeniem („wiesz już ile, zobacz co"), więc może być
 * zbędny; tutaj jest ODPOWIEDZIĄ NA FAKT — sekcja pokazuje WYCINEK oferty, więc
 * albo mówi, gdzie jest reszta, albo zataja, że reszta istnieje. Przełącznik
 * pozwalałby zataić, a domyślnie włączony przełącznik przy pełnym katalogu
 * odsyłałby do listy, którą odwiedzający właśnie w całości widzi.
 *
 * `shown` jest liczbą pozycji, które sekcja NAPRAWDĘ oddaje do dokumentu.
 */
export function productsCatalogLinkVisible(shown: number, catalogSize: number): boolean {
  return catalogSize > shown;
}

/**
 * TREŚĆ SPRZĘTU WYPROWADZONA ZE STAREJ GENERACJI (konwersja E7) — albo `null`.
 *
 * Przenosimy USTAWIENIA, nie treść, bo treści w starej sekcji NIE MA: sekcja
 * `products` v1 to dosłownie `{ heading? }`, a płótno v2 dostawało z niej
 * nagłówek i jeden element `catalog` — czyli tę samą informację „tu ma stać
 * katalog". Pozycje zawsze pochodziły z bazy, więc nie ma czego przenosić i nie
 * ma czego zgadywać.
 *
 * Wynik jedzie zatem w stanie `catalog`: strona pokazuje po konwersji dokładnie
 * to, co pokazywała przedtem, a ręczny wybór jest decyzją, którą operator
 * dopiero podejmie.
 */
export function productsHeadingFromLegacy(content: unknown): string | undefined {
  if (isSectionCanvas(content)) return canvasHeading(content);
  if (typeof content !== "object" || content === null) return undefined;
  const legacy = (content as { heading?: unknown }).heading;
  return typeof legacy === "string" && legacy.trim().length > 0
    ? legacy.trim().slice(0, 200)
    : undefined;
}

// -----------------------------------------------------------------------
// Atuty — typ IKONOWY (E7)
// -----------------------------------------------------------------------

/**
 * Warianty układu atutów. Dwa, bo tyle jest realnych odpowiedzi na pytanie
 * „czy atut jest osobnym obiektem na stronie":
 *   • `cards` — każdy atut w karcie z obrysem. Kafle są policzalne wzrokiem,
 *     a sekcja czyta się jak zestawienie;
 *   • `plain` — ikona, tytuł i zdanie bez obrysu, w kolumnach. Sekcja wtapia
 *     się w stronę i nie konkuruje z sekcją, która NAPRAWDĘ jest zestawieniem
 *     (cennik, sprzęt).
 *
 * Oba czytają TEN SAM `items` — przełącznik układu jest polem treści.
 */
export const USP_LAYOUTS = ["cards", "plain"] as const;
export type UspLayout = (typeof USP_LAYOUTS)[number];

/** Górna granica atutów — lustro `maxItems` w rejestrze (test pilnuje zgody). */
const USP_MAX_ITEMS = 12;

/** Tytuł atutu („Dowóz w 24 h") — hasło, nie zdanie. */
const uspTitle = z.string().trim().min(1).max(120);

/** Zdanie pod tytułem — rozwinięcie hasła, więc puste nie ma sensu. */
const uspText = z.string().trim().min(1).max(500);

export const uspStructuredSchema = z
  .object({
    v: z.literal(STRUCTURED_SECTION_VERSION),
    type: z.literal("usp"),
    layout: z.enum(USP_LAYOUTS),
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    heading: heading.optional(),
    /**
     * Atuty. MINIMUM JEDEN — sekcja atutów bez ani jednego atutu jest pustym
     * nagłówkiem (klasa atrap usuwana przez ADR-094).
     *
     * KAFEL JEST JEDNYM WPISEM, i to jest cała różnica wobec płótna. Tam ikona,
     * tytuł i zdanie były TRZEMA niezależnymi pudełkami, które operator mógł
     * rozsunąć, przestawić albo skasować pojedynczo — a wtedy strona pokazywała
     * ikonę bez opisu albo opis bez ikony i nic tego nie zauważało. Tutaj
     * trójka jest nierozerwalna z konstrukcji: nie ma stanu, w którym atut ma
     * ikonę, a nie ma tytułu.
     *
     * Ikona idzie z ZAMKNIĘTEGO słownika strony (`USP_ICONS`, ADR-082) — tego
     * samego, którym mówi element ikony na płótnie. Druga, „prawie taka sama"
     * lista symboli znaczyłaby atut, który po konwersji traci ikonę, bo jego
     * nazwy nie ma po drugiej stronie.
     */
    items: z
      .array(
        z
          .object({ icon: z.enum(USP_ICONS), title: uspTitle, text: uspText })
          .strict(),
      )
      .min(1)
      .max(USP_MAX_ITEMS),
  })
  .strict();

export type UspStructuredContent = z.infer<typeof uspStructuredSchema>;
export type UspStructuredItem = UspStructuredContent["items"][number];

/**
 * KOLEJNOŚĆ CZYTANIA PŁÓTNA — od góry, potem od lewej.
 *
 * Wydzielona w E7, bo od tej chwili pyta o nią PIĘĆ konwersji. Kolejność
 * w tablicy elementów jest kolejnością DODAWANIA i po kilku poprawkach nie ma
 * nic wspólnego z tym, co operator widzi na ekranie.
 */
function readingOrder(a: CanvasElement, b: CanvasElement): number {
  return (
    a.layout.desktop.y - b.layout.desktop.y || a.layout.desktop.x - b.layout.desktop.x
  );
}

/**
 * ATUTY WYPROWADZONE ZE STAREJ TREŚCI (konwersja E7).
 *
 *   • v1 niesie gotową trójkę (`icon`, `title`, `text`), więc wpisy jadą CO DO
 *     JEDNEGO i w swojej kolejności;
 *   • PŁÓTNO v2 rozbiło je na trzy osobne elementy, ale NIE na nierozróżnialne:
 *     rodzaj elementu jest zapisany wprost (`icon` / `heading` / `text`), a
 *     przynależność do jednego atutu — GEOMETRIĄ.
 *
 * ==================== DLACZEGO KOLUMNA, A NIE SĄSIEDZTWO ====================
 *
 * To jest dokładnie ta pułapka, która w E6 podpisała opinię cudzym nazwiskiem.
 * Konwersja v1→v2 układa atuty w TRZECH KOLUMNACH, więc kolejność czytania daje:
 * ikona 1, ikona 2, ikona 3, tytuł 1, tytuł 2, tytuł 3, zdanie 1… Sąsiadem
 * ikony 1 jest tam ikona 2, a nie jej własny tytuł — heurystyka „następny
 * element" składałaby atuty z części należących do trzech różnych kafli.
 *
 * Prawdziwe wiązanie jest zapisane w tym, co konwersja NARYSOWAŁA: ikona, tytuł
 * i zdanie jednego atutu stoją w TEJ SAMEJ KOLUMNIE (ten sam `x`), jedno pod
 * drugim. To jest odczytanie własnego układu, a nie zgadywanie sensu.
 *
 * Kolejność WPISÓW bierze się z kolejności ikon w czytaniu (od góry, potem od
 * lewej), więc atuty wracają rzędami — tak, jak stoją na ekranie.
 */
export function uspItemsFromLegacy(content: unknown): UspStructuredItem[] {
  if (isSectionCanvas(content)) return uspItemsFromCanvas(content);
  return uspItemsFromV1(content);
}

function uspItemsFromCanvas(canvas: SectionCanvas): UspStructuredItem[] {
  type IconElement = Extract<CanvasElement, { kind: "icon" }>;
  type HeadingElement = Extract<CanvasElement, { kind: "heading" }>;
  type TextElement = Extract<CanvasElement, { kind: "text" }>;

  const ordered = canvas.elements.slice().sort(readingOrder);
  const icons = ordered.filter((element): element is IconElement => element.kind === "icon");
  // Nagłówek SEKCJI jest poziomu 2 i stoi nad kolumnami; tytuły kafli mają
  // poziom 3. Bez tego odsiewu pierwszy atut dostałby tytuł całej sekcji.
  const titles = ordered.filter(
    (element): element is HeadingElement => element.kind === "heading" && element.level === 3,
  );
  const texts = ordered.filter((element): element is TextElement => element.kind === "text");

  const takenTitles = new Set<HeadingElement>();
  const takenTexts = new Set<TextElement>();
  const items: UspStructuredItem[] = [];

  for (const icon of icons) {
    const column = icon.layout.desktop.x;
    const title = titles.find(
      (candidate) =>
        !takenTitles.has(candidate) &&
        candidate.layout.desktop.x === column &&
        candidate.layout.desktop.y > icon.layout.desktop.y,
    );
    if (!title) continue;
    const text = texts.find(
      (candidate) =>
        !takenTexts.has(candidate) &&
        candidate.layout.desktop.x === column &&
        candidate.layout.desktop.y > title.layout.desktop.y,
    );
    // Atut bez zdania ODPADA: schemat wymaga obu napisów, a dopisanie zdania
    // za operatora byłoby wymyślaniem treści marketingowej — czyli tym samym,
    // czego zabrania granica z FAQ.
    if (!text) continue;
    const titleText = title.text.trim();
    const bodyText = text.text.trim();
    if (titleText.length === 0 || bodyText.length === 0) continue;
    takenTitles.add(title);
    takenTexts.add(text);
    items.push({
      icon: icon.name,
      title: titleText.slice(0, 120),
      text: bodyText.slice(0, 500),
    });
  }
  return items.slice(0, USP_MAX_ITEMS);
}

/** Sekcja atutów SPRZED płótna: gotowa lista trójek (schemat v1). */
function uspItemsFromV1(content: unknown): UspStructuredItem[] {
  if (typeof content !== "object" || content === null) return [];
  const items = (content as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const allowed = new Set<string>(USP_ICONS);
  return items
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const source = item as Record<string, unknown>;
      const icon = typeof source.icon === "string" && allowed.has(source.icon) ? source.icon : null;
      const title = typeof source.title === "string" ? source.title.trim() : "";
      const text = typeof source.text === "string" ? source.text.trim() : "";
      if (!icon || title.length === 0 || text.length === 0) return null;
      return {
        icon: icon as UspStructuredItem["icon"],
        title: title.slice(0, 120),
        text: text.slice(0, 500),
      };
    })
    .filter((item): item is UspStructuredItem => item !== null)
    .slice(0, USP_MAX_ITEMS);
}

// -----------------------------------------------------------------------
// Dostawa — typ z ceną OPCJONALNĄ (E7)
// -----------------------------------------------------------------------

/**
 * Warianty układu dostawy. Dwa, bo tyle jest realnych odpowiedzi na pytanie
 * „czy warianty dostawy się PORÓWNUJE":
 *   • `cards` — kafle obok siebie, każdy z ceną pod tytułem. Tak czyta się
 *     wybór: „odbiór osobisty czy dowóz";
 *   • `list` — wiersze z ceną wyrównaną do prawej. Tak czyta się cennik
 *     dodatków, w którym pozycji jest więcej niż trzy.
 *
 * Oba czytają TEN SAM `items` — przełącznik układu jest polem treści.
 */
export const DELIVERY_LAYOUTS = ["cards", "list"] as const;
export type DeliveryLayout = (typeof DELIVERY_LAYOUTS)[number];

/** Górna granica wariantów dostawy — lustro `maxItems` w rejestrze. */
const DELIVERY_MAX_ITEMS = 12;

/** Nazwa wariantu („Odbiór osobisty", „Dowóz na terenie miasta"). */
const deliveryTitle = z.string().trim().min(1).max(200);

/** Opis wariantu — warunki, zasięg, czas. */
const deliveryText = z.string().trim().min(1).max(1_000);

/**
 * WPROWADZENIE NAD LISTĄ. Pole SEKCJI, bo dotyczy całej dostawy, a nie
 * pojedynczego wariantu — i jest jedynym polem, przez które konwersja przenosi
 * zdanie, które sekcja dostawy miała w generacji v1 (`text`, wymagane).
 *
 * NAZWA `intro`, A NIE `text`, i nie jest to kosmetyka: wpis ma WŁASNE pole
 * `text`, a szuflada pyta i18n o etykietę PO KLUCZU POLA. Dwa różne pola pod
 * jednym kluczem dostałyby w edytorze jedną etykietę — dokładnie ta sama
 * pułapka, którą w E6 zamknęła para `footnote` / `note`.
 */
const deliveryIntro = z.string().trim().min(1).max(2_000);

export const deliveryStructuredSchema = z
  .object({
    v: z.literal(STRUCTURED_SECTION_VERSION),
    type: z.literal("delivery"),
    layout: z.enum(DELIVERY_LAYOUTS),
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    heading: heading.optional(),
    intro: deliveryIntro.optional(),
    /**
     * Warianty dostawy. MINIMUM JEDEN — sekcja dostawy bez ani jednego sposobu
     * dostarczenia sprzętu jest pustym nagłówkiem (klasa atrap, ADR-094).
     *
     * CENA JEST OPCJONALNA i to jest cała różnica wobec cennika (E6), gdzie
     * pozycja bez ceny nie jest pozycją. Tutaj „Odbiór osobisty" bez kwoty jest
     * kompletną informacją — dopisanie mu „0,00 zł" byłoby odpowiedzią na
     * pytanie, którego nikt nie zadał, a wymuszenie kwoty kazałoby najemcy
     * wpisać liczbę tam, gdzie cena zależy od zamówienia („wycena indywidualna").
     * Pustka ZDEJMUJE pole (`empty: "unset"` w rejestrze), więc karta bez ceny
     * jest stanem treści, a nie ceną zerową.
     */
    items: z
      .array(
        z
          .object({
            title: deliveryTitle,
            text: deliveryText,
            /** Kwota w jednostkach podrzędnych (`int`) — kanon pieniędzy projektu. */
            price_grosze: z.number().int().min(0).max(100_000_000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(DELIVERY_MAX_ITEMS),
  })
  .strict();

export type DeliveryStructuredContent = z.infer<typeof deliveryStructuredSchema>;
export type DeliveryStructuredItem = DeliveryStructuredContent["items"][number];

/**
 * ETYKIETA CENY WARIANTU DOSTAWY — sama kwota, bez jednostki rozliczeniowej.
 *
 * Cennik (E6) dopisuje do kwoty jednostkę („/ doba"), bo najem trwa. Dostawa
 * jest ZDARZENIEM: „120,00 zł / doba" przy dowozie byłoby ofertą, której nikt
 * nie składa. Brak jednostki jest tu więc informacją, a nie brakiem.
 *
 * Funkcja stoi w rdzeniu — jak `pricingPriceLabel` i z tego samego powodu:
 * `formatMoney` jest jedynym formatterem pieniędzy w systemie, a komponenty
 * strukturalne mają zamkniętą listę modułów, po które wolno im sięgać.
 * Dzielenia przez sto w pakiecie UI nie ma i mieć nie może.
 *
 * `null` dla wariantu BEZ ceny — żeby render nie musiał pytać o obecność pola
 * drugi raz, własnym `if`-em, minimalnie inaczej niż ta funkcja.
 */
export function deliveryPriceLabel(
  item: DeliveryStructuredItem,
  currency: CurrencyCode,
  locale: string,
): string | null {
  return item.price_grosze === undefined
    ? null
    : formatMoney(item.price_grosze, currency, locale);
}

/**
 * TREŚĆ DOSTAWY WYPROWADZONA ZE STAREJ GENERACJI (konwersja E7) — albo `null`.
 *
 *   • v1 niesie nagłówek, zdanie wprowadzające (`text`) i gotową listę par
 *     `{ title, text }`, więc wszystko jedzie wprost. CEN nie ma i mieć nie
 *     może: schemat v1 pojęcia ceny dostawy nie znał;
 *   • PŁÓTNO v2 rozbiło karty na kształt, nagłówek i tekst. Wiązanie jest —
 *     tak jak przy atutach — GEOMETRYCZNE: tytuł i opis jednej karty stoją
 *     w tej samej kolumnie (`x`), jeden pod drugim. Zdanie wprowadzające
 *     rozpoznajemy po WARIANCIE tekstu (`lead`), którym zapisała je nasza
 *     własna konwersja — to odczytanie, a nie interpretacja.
 */
export function deliveryFromLegacy(content: unknown): {
  intro?: string;
  items: DeliveryStructuredItem[];
} {
  if (isSectionCanvas(content)) return deliveryFromCanvas(content);
  return deliveryFromV1(content);
}

function deliveryFromCanvas(canvas: SectionCanvas): {
  intro?: string;
  items: DeliveryStructuredItem[];
} {
  type HeadingElement = Extract<CanvasElement, { kind: "heading" }>;
  type TextElement = Extract<CanvasElement, { kind: "text" }>;

  const ordered = canvas.elements.slice().sort(readingOrder);
  const lead = ordered.find(
    (element): element is TextElement => element.kind === "text" && element.variant === "lead",
  );
  const titles = ordered.filter(
    (element): element is HeadingElement => element.kind === "heading" && element.level === 3,
  );
  const bodies = ordered.filter(
    (element): element is TextElement => element.kind === "text" && element.variant === "small",
  );

  const taken = new Set<TextElement>();
  const items: DeliveryStructuredItem[] = [];
  for (const title of titles) {
    const body = bodies.find(
      (candidate) =>
        !taken.has(candidate) &&
        candidate.layout.desktop.x === title.layout.desktop.x &&
        candidate.layout.desktop.y > title.layout.desktop.y,
    );
    if (!body) continue;
    const name = title.text.trim();
    const description = body.text.trim();
    if (name.length === 0 || description.length === 0) continue;
    taken.add(body);
    items.push({ title: name.slice(0, 200), text: description.slice(0, 1_000) });
  }

  const intro = lead?.text.trim();
  return {
    ...(intro && intro.length > 0 ? { intro: intro.slice(0, 2_000) } : {}),
    items: items.slice(0, DELIVERY_MAX_ITEMS),
  };
}

/** Sekcja dostawy SPRZED płótna: nagłówek, zdanie i lista par (schemat v1). */
function deliveryFromV1(content: unknown): { intro?: string; items: DeliveryStructuredItem[] } {
  if (typeof content !== "object" || content === null) return { items: [] };
  const source = content as Record<string, unknown>;
  const intro = typeof source.text === "string" ? source.text.trim() : "";
  const raw = Array.isArray(source.items) ? source.items : [];
  const items = raw
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const entry = item as Record<string, unknown>;
      const title = typeof entry.title === "string" ? entry.title.trim() : "";
      const text = typeof entry.text === "string" ? entry.text.trim() : "";
      if (title.length === 0 || text.length === 0) return null;
      return { title: title.slice(0, 200), text: text.slice(0, 1_000) };
    })
    .filter((item): item is DeliveryStructuredItem => item !== null)
    .slice(0, DELIVERY_MAX_ITEMS);
  return { ...(intro.length > 0 ? { intro: intro.slice(0, 2_000) } : {}), items };
}

// -----------------------------------------------------------------------
// CTA — typ, którego CAŁA POWIERZCHNIA bywa akcentem (E7)
// -----------------------------------------------------------------------

/**
 * Warianty układu CTA. Dwa, bo tyle jest realnych odpowiedzi na pytanie „gdzie
 * jest przycisk":
 *   • `banner` — wszystko wyśrodkowane, przycisk pod tekstem. Sekcja jest
 *     przystankiem: strona zatrzymuje się i pyta;
 *   • `split` — tekst po lewej, przycisk po prawej (poniżej progu schodzą
 *     w jedną kolumnę). Sekcja jest pasem domykającym stronę i nie zabiera
 *     całego ekranu.
 */
export const CTA_LAYOUTS = ["banner", "split"] as const;
export type CtaLayout = (typeof CTA_LAYOUTS)[number];

/**
 * WARIANT POWIERZCHNI CTA — TRZY WARTOŚCI, ZERO HEKSÓW.
 *
 * ==================== PINEZKA, KTÓRĄ TO ZAMYKA ====================
 *
 * Baner CTA sprzed v3 miał wpisaną w klasę powłoki jedną decyzję kolorystyczną
 * („odwrócony", `styles.ctaBanner`), taką samą w każdym motywie i w każdym
 * szablonie — stąd pinezka „złe kolory w każdym szablonie": strona o jasnej
 * dyrekcji dostawała pośrodku czarny prostokąt, którego nie zamawiała, a jedyną
 * drogą naprawy było nieużywanie sekcji.
 *
 * ==================== TRZY WARIANTY, KAŻDY PO ROLACH ====================
 *
 *   • `plain` — CTA stoi wprost na pasie sekcji (pas wybiera pole `background`,
 *     tak jak w każdym innym typie). Nagłówek atramentem pasa, przycisk akcentem;
 *   • `panel` — CTA w panelu o powierzchni KARTY, z obrysem ze zmiennej kreski.
 *     Odcina sekcję od reszty strony, nie zmieniając jej temperatury;
 *   • `accent` — panel WYPEŁNIONY akcentem, napis kolorem etykiety na tym
 *     wypełnieniu. To jest „pas akcentowy" z briefu, zrealizowany rolami, które
 *     rejestr motywów NAPRAWDĘ ma.
 *
 * ==================== DLACZEGO NIE CZWARTY PAS SEKCJI ====================
 *
 * Brief mówił o „pasie akcentowym" obok domyślnego i odwróconego. Pasy sekcji
 * (`SECTION_BACKGROUNDS` → `THEME_BAND_KEYS`) są jednak wspólne dla WSZYSTKICH
 * typów i wszystkich generacji treści: dopisanie czwartego znaczyłoby komplet
 * nowych tokenów (powierzchnia, atrament, atrament przygaszony, kreska, wariant
 * akcentu) w KAŻDYM motywie — czyli zmianę rejestru motywów (K5, ADR-090)
 * przemyconą pod sekcją CTA, a przy okazji akcentowy pas do wyboru pod każdą
 * galerią i każdym FAQ. Wypełnienie akcentem jest za to rolą pierwszej klasy,
 * z policzonymi tokenami (`fill` / `onFill`) w każdym motywie i każdym akcencie.
 *
 * Czytelność KAŻDEJ pary wariant × motyw egzekwuje macierz kontrastu przez role
 * zadeklarowane w rejestrze — z rolą `accentOnFill` włącznie, która powstała
 * właśnie po to, żeby napis na wariancie `accent` miał policzoną liczbę.
 */
export const CTA_VARIANTS = ["plain", "panel", "accent"] as const;
export type CtaVariant = (typeof CTA_VARIANTS)[number];

/** Górna granica przycisków — patrz uzasadnienie przy `items` niżej. */
const CTA_MAX_ITEMS = 2;

/** Etykieta przycisku — ta sama granica, co na płótnie (przycisk to nie akapit). */
const ctaButtonLabel = z.string().trim().min(1).max(80);

/** Zdanie pod nagłówkiem — rozwinięcie wezwania, więc puste nie ma sensu. */
const ctaText = z.string().trim().min(1).max(1_000);

export const ctaStructuredSchema = z
  .object({
    v: z.literal(STRUCTURED_SECTION_VERSION),
    type: z.literal("cta"),
    layout: z.enum(CTA_LAYOUTS),
    background: z.enum(SECTION_BACKGROUNDS).default("default"),
    heading: heading.optional(),
    text: ctaText.optional(),
    /**
     * PRZYCISKI — LISTA, a nie jedno pole `button`, i są ku temu dwa powody.
     *
     * Pierwszy jest o produkcie: wezwanie ma realnie DWA stopnie („Zarezerwuj
     * termin" i obok „Zobacz katalog"), a druga ścieżka wpisana w zdanie obok
     * przestaje być przyciskiem. Sufit to DWA — trzeci przycisk w banerze nie
     * jest wezwaniem, tylko menu.
     *
     * Drugi jest o edytorze: mini-CMS jest frameworkiem listy wpisów (kolejność
     * uchwytem i strzałkami, dodawanie, usuwanie z potwierdzeniem). Pojedynczy
     * obiekt `button` wymagałby w nim osobnej ścieżki dla jednego typu — czyli
     * dokładnie tego `if`-a po nazwie typu, którego rejestr ma nie mieć.
     *
     * Allowlista adresu ta sama, co dla przycisku płótna: druga kopia reguły
     * bezpieczeństwa rozjeżdża się z pierwszą w dniu, w którym jedną z nich
     * ktoś poprawi.
     */
    items: z
      .array(z.object({ label: ctaButtonLabel, href: linkHrefSchema }).strict())
      .min(1)
      .max(CTA_MAX_ITEMS),
    variant: z.enum(CTA_VARIANTS).default("plain"),
  })
  .strict();

export type CtaStructuredContent = z.infer<typeof ctaStructuredSchema>;

/**
 * CTA WYPROWADZONE ZE STAREJ TREŚCI (konwersja E7) — albo `null`.
 *
 *   • v1 niesie komplet (`heading`, `text?`, `buttonLabel`, `buttonHref`), więc
 *     jedzie wprost;
 *   • PŁÓTNO v2 rozbiło je na nagłówek, tekst, przycisk i kształt banera, ale
 *     każdego z nich jest DOKŁADNIE JEDEN, a rodzaj elementu niesie znaczenie.
 *     Nie ma tu więc czego wiązać geometrią — pierwsze wystąpienie w kolejności
 *     czytania jest jedynym.
 *
 * Bez przycisku wynik jest `null`: schemat wymaga przycisku, a wymyślenie jego
 * etykiety i adresu byłoby dopisaniem najemcy wezwania, którego nie napisał.
 * Wariant zostaje `plain` — o tym, że baner ma być akcentowy, decyduje operator,
 * a przeniesienie starego „zawsze odwrócony" powielałoby dokładnie tę pinezkę,
 * którą ten typ zamyka.
 */
export interface CtaLegacyParts {
  heading?: string;
  text?: string;
  /** Przyciski w kolejności czytania — pusto, gdy stara treść żadnego nie miała. */
  items: { label: string; href: string }[];
}

export function ctaFromLegacy(content: unknown): CtaLegacyParts {
  if (isSectionCanvas(content)) return ctaFromCanvas(content);
  if (typeof content !== "object" || content === null) return { items: [] };
  const source = content as Record<string, unknown>;
  const legacyHeading = typeof source.heading === "string" ? source.heading.trim() : "";
  const legacyText = typeof source.text === "string" ? source.text.trim() : "";
  const label = typeof source.buttonLabel === "string" ? source.buttonLabel.trim() : "";
  const href = typeof source.buttonHref === "string" ? source.buttonHref.trim() : "";
  return {
    ...(legacyHeading.length > 0 ? { heading: legacyHeading.slice(0, 200) } : {}),
    ...(legacyText.length > 0 ? { text: legacyText.slice(0, 1_000) } : {}),
    items: label.length > 0 && href.length > 0 ? [{ label: label.slice(0, 80), href }] : [],
  };
}

function ctaFromCanvas(canvas: SectionCanvas): CtaLegacyParts {
  const ordered = canvas.elements.slice().sort(readingOrder);
  const legacyHeading = ordered.find(
    (element): element is Extract<CanvasElement, { kind: "heading" }> => element.kind === "heading",
  );
  const legacyText = ordered.find(
    (element): element is Extract<CanvasElement, { kind: "text" }> => element.kind === "text",
  );
  const headingText = legacyHeading?.text.trim() ?? "";
  const bodyText = legacyText?.text.trim() ?? "";
  const items = ordered
    .filter(
      (element): element is Extract<CanvasElement, { kind: "button" }> => element.kind === "button",
    )
    .map((element) => ({ label: element.label.trim(), href: element.href }))
    .filter((button) => button.label.length > 0)
    .map((button) => ({ label: button.label.slice(0, 80), href: button.href }))
    .slice(0, CTA_MAX_ITEMS);
  return {
    ...(headingText.length > 0 ? { heading: headingText.slice(0, 200) } : {}),
    ...(bodyText.length > 0 ? { text: bodyText.slice(0, 1_000) } : {}),
    items,
  };
}

// -----------------------------------------------------------------------
// Opis edytora — mini-CMS czyta pola z DANYCH, nie z `if`-ów per typ
// -----------------------------------------------------------------------

/**
 * Rodzaj kontrolki pola. `image` NIE jest polem tekstowym: wartością jest
 * źródło zdjęcia, a nie napis, więc szuflada rysuje w tym miejscu miniaturę,
 * a nie `<input>` ze ścieżką do Storage. `choice` jest listą o ZAMKNIĘTYM
 * zbiorze wartości (rodzaj danych kontaktowych, E4) — pole tekstowe w tym
 * miejscu pozwalałoby wpisać rodzaj, którego render nie zna, więc wpis
 * przestałby być klikalny bez żadnego komunikatu.
 *
 * `money` (E6) jest czwartym rodzajem NIE-TEKSTOWYM i jedynym, którego wartość
 * w treści jest LICZBĄ: kwota mieszka w jednostkach podrzędnych jako `int`
 * (kanon pieniędzy projektu), a operator wpisuje ją w jednostkach głównych.
 * Przeliczenie i rozpoznanie „to jeszcze nie jest kwota” robi rdzeń
 * (`parseMoneyAmount`), nie kontrolka — inaczej każda powierzchnia edycyjna
 * miałaby własną, minimalnie inną odpowiedź na pytanie, czym jest „12,5”.
 */
export type StructuredFieldKind =
  | "text"
  | "multiline"
  | "image"
  | "choice"
  | "money"
  /**
   * ODWOŁANIE DO ENCJI PANELU (E7) — piąty rodzaj NIE-TEKSTOWY i jedyny,
   * którego wartość nie jest treścią najemcy, tylko WSKAZANIEM czegoś, co
   * mieszka poza stroną (dziś: pozycja katalogu).
   *
   * Szuflada rysuje w tym miejscu NAZWĘ wskazanej encji, a nie pole z jej
   * identyfikatorem — identyfikator jest szczegółem technicznym, którego
   * operator nie ma po co widzieć ani móc zepsuć (ta sama zasada, co przy
   * miniaturze zdjęcia zamiast ścieżki do Storage). Wpisy rodzą się WYBOREM
   * z listy, a nie przyciskiem „dodaj", więc typ z tym polem nie ma `newItem`
   * — dokładnie jak typ medialny, w którym wpis rodzi się z wgrania pliku.
   *
   * Nazwy encji podaje HOST szuflady (`itemsPick` w opisie typu): rdzeń nie ma
   * dostępu do bazy i nie zna kształtu wiersza.
   */
  | "reference";

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
  /**
   * Wartości do wyboru dla `kind: "choice"` — kolejność = kolejność na liście.
   * Wartości są napisami, bo w tej kontrolce siedzi rodzaj wpisu (dana
   * słownikowa), a nie liczba; ustawienia wyglądu o typie liczbowym mają
   * własny opis ({@link StructuredChoiceSpec}) i własną drogę zapisu.
   */
  values?: readonly string[];
}

/** Przełącznik logiczny w ustawieniach sekcji (np. „pozwól otworzyć wiele naraz"). */
export interface StructuredToggleSpec {
  key: string;
}

/**
 * ENCJA DO WSKAZANIA W SZUFLADZIE (E7) — para „identyfikator, nazwa".
 *
 * Kształt jest tak wąski celowo. Do treści jedzie WYŁĄCZNIE `value`; `label`
 * służy operatorowi i znika razem z szufladą, bo nazwa mieszka w katalogu
 * i zmienia się bez publikacji strony. Gdyby wpis niósł kopię nazwy, strona
 * pokazywałaby sprzęt pod nazwą, której najemca już nie używa — i nie byłoby
 * jak tego naprawić inaczej niż przez ponowne wskazanie pozycji.
 *
 * Wypełnia go HOST szuflady (trasa kreatora): rdzeń nie ma dostępu do bazy
 * i nie zna kształtu wiersza.
 */
export interface StructuredPickEntry {
  value: string;
  label: string;
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
  /**
   * Pola CAŁEJ SEKCJI poza nagłówkiem (E4: odnośnik do polityki prywatności).
   * Osobne od `itemFields`, bo dotyczą sekcji, a nie wpisu — wciśnięcie ich do
   * listy znaczyłoby, że każdy wpis niesie własną kopię tej samej wartości.
   * Brak = sekcja nie ma nic poza nagłówkiem (FAQ, galeria).
   */
  fields?: readonly StructuredFieldSpec[];
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
   * MODUŁ PANELU, Z KTÓREGO SZUFLADA UMIE SKOPIOWAĆ WPISY (E5, ADR-096).
   *
   * Nazwa źródła, nie funkcja: rdzeń nie ma dostępu do bazy i nie zna kształtu
   * wiersza. Wpisy w kształcie tego typu podaje HOST szuflady (trasa kreatora),
   * a rejestr mówi wyłącznie, KTÓRY moduł jest dla tego typu sensowny — dzięki
   * temu przycisk „wstaw z…" pojawia się z danych, a nie z `if`-a po nazwie typu.
   *
   * KOPIA, NIE SPRZĘŻENIE: po wstawieniu treść należy do sekcji. Punkt odbioru
   * zmieniony w Dostawach NIE przestawia opublikowanej strony — patrz ADR-096.
   */
  itemsImport?: string;
  /**
   * MODUŁ PANELU, Z KTÓREGO SZUFLADA POZWALA WYBRAĆ WPIS (E7) — nazwa źródła,
   * tak samo jak przy {@link itemsImport}, i tym samym kanałem (`importSources`
   * hosta szuflady). Różnica jest w SPOSOBIE i w tym, co zostaje w treści:
   *
   *   • `itemsImport` KOPIUJE dane jednym kliknięciem i po skopiowaniu treść
   *     należy do sekcji (adres punktu odbioru wolno w niej poprawić);
   *   • `itemsPick` WSKAZUJE encję po identyfikatorze — w treści zostaje samo
   *     odwołanie, a nazwa i cena są czytane na bieżąco z katalogu. Kopia byłaby
   *     tu wprost szkodliwa: strona główna pokazywałaby cenę, której najemca
   *     już nie ma w ofercie.
   *
   * Wybór zamiast kopiowania wszystkiego, bo katalog ma dziesiątki pozycji,
   * a sekcja pokazuje ich kilka — „wstaw wszystkie" byłoby tu obietnicą
   * kończącą się kasowaniem dwudziestu wpisów z ręki.
   */
  itemsPick?: string;
  /**
   * KIEDY LISTA WPISÓW W OGÓLE COŚ ZNACZY (E7) — para „klucz ustawienia,
   * wartość". Brak = zawsze (wszystkie typy do E6).
   *
   * Sekcja sprzętu ma stan, w którym wybór pozycji jest bez skutku: przy
   * `source: "catalog"` treść bierze się z katalogu, a nie z listy. Szuflada
   * pokazuje wtedy zdanie ZAMIAST listy i selektora — bo kontrolka bez skutku
   * uczy operatora, że ustawienia sekcji bywają ozdobą (ta sama zasada, którą
   * `choice.layouts` stosuje do ustawień wyglądu).
   *
   * DANE, a nie `if` po nazwie typu: framework szuflady nie zna słowa „sprzęt".
   */
  itemsWhen?: { key: string; value: string };
  /**
   * Treść v3 wyprowadzona z treści STAREJ generacji tej samej sekcji (v1 albo
   * płótno v2) — albo `null`, gdy wyprowadzenie wymagałoby zgadywania.
   * Nieobecność jest RÓWNIE mocną deklaracją co obecność: znaczy „tej treści
   * nie da się przenieść bez wymyślania" (FAQ — patrz ADR-094).
   *
   * JĘZYK JEST DRUGIM ARGUMENTEM (E6). Konwersje E3–E5 przenosiły wyłącznie
   * treść najemcy, więc język nie miał do czego się przyłożyć. Cennik przenosi
   * nagłówek i notkę, ale POZYCJE bierze z presetu (bo stara treść ich nie ma)
   * — a preset istnieje per język. Bez tego argumentu angielski sklep dostawałby
   * po konwersji polskie pozycje startowe.
   */
  fromLegacy?: (content: unknown, locale: StructuredPresetLocale) => unknown | null;
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

  contact: {
    schema: contactStructuredSchema,
    layouts: CONTACT_LAYOUTS,
    defaultLayout: "stacked",
    itemFields: [
      { key: "kind", kind: "choice", values: CONTACT_ENTRY_KINDS },
      { key: "value", kind: "text" },
    ],
    // Odnośnik do polityki prywatności jest polem SEKCJI — patrz `fields`
    // w opisie typu i pole `privacyHref` w schemacie.
    fields: [{ key: "privacyHref", kind: "text", empty: "unset" }],
    toggles: [{ key: "showForm" }, { key: "askPhone" }],
    // Układ kontaktu nie ma nic do ustawienia poza sobą: liczba kolumn wynika
    // z wariantu, a nie z osobnej kontrolki. Pusto JAWNIE (jak przy FAQ).
    choices: [],
    // Jedna kolumna: cztery wpisy po dwa pola i trzy ustawienia mieszczą się
    // bez dzielenia na zakładki — a zakładka na trzy pola to klik bez korzyści.
    editor: "single",
    minItems: 1,
    maxItems: CONTACT_MAX_ITEMS,
    // Render kontaktu maluje: etykiety rodzajów i wartości (ink), notkę RODO
    // i podpis pod formularzem (inkMuted), obrys pól i karty formularza
    // (border), odnośniki `mailto:`/`tel:` pod kursorem oraz przycisk wysyłki
    // (accentText, accentFill), ETYKIETĘ NA WYPEŁNIENIU przycisku wysyłki
    // (accentOnFill — dopisana w E7 razem z rolą) i komunikat błędu (dangerText).
    themeRoles: [
      "ink",
      "inkMuted",
      "border",
      "accentText",
      "accentFill",
      "accentOnFill",
      "dangerText",
    ],
    preset: {
      pl: {
        v: STRUCTURED_SECTION_VERSION,
        type: "contact",
        layout: "stacked",
        background: "default",
        heading: "Kontakt",
        showForm: true,
        askPhone: false,
        items: [
          // Adres w domenie zarezerwowanej normą (RFC 2606): preset ma
          // WYGLĄDAĆ jak adres i jednocześnie nie móc nigdzie dojść, dopóki
          // operator nie wpisze swojego.
          { kind: "email", value: "kontakt@twojadomena.example" },
          { kind: "phone", value: "+48 500 600 700" },
          { kind: "address", value: "ul. Przykładowa 5, 00-001 Warszawa" },
          { kind: "hours", value: "pon.–pt. 8:00–17:00, sob. 9:00–13:00" },
        ],
      },
      en: {
        v: STRUCTURED_SECTION_VERSION,
        type: "contact",
        layout: "stacked",
        background: "default",
        heading: "Contact us",
        showForm: true,
        askPhone: false,
        items: [
          { kind: "email", value: "hello@yourdomain.example" },
          { kind: "phone", value: "+44 20 7946 0000" },
          { kind: "address", value: "5 Example Street, London EC1A 1AA" },
          { kind: "hours", value: "Mon–Fri 8:00–17:00, Sat 9:00–13:00" },
        ],
      },
    },
    newItem: {
      pl: { kind: "phone", value: "+48 500 600 700" },
      en: { kind: "phone", value: "+44 20 7946 0000" },
    },
    fromLegacy: (content: unknown) => {
      const items = contactEntriesFromLegacy(content);
      if (items.length === 0) return null;
      const source = content as { heading?: unknown } | null;
      const legacyHeading =
        typeof source?.heading === "string" && source.heading.trim().length > 0
          ? source.heading
          : isSectionCanvas(content)
            ? canvasHeading(content)
            : undefined;
      return {
        v: STRUCTURED_SECTION_VERSION,
        type: "contact",
        layout: "stacked",
        background: "default",
        ...(legacyHeading ? { heading: legacyHeading } : {}),
        showForm: true,
        askPhone: false,
        items,
      };
    },
  },

  directions: {
    schema: directionsStructuredSchema,
    layouts: DIRECTIONS_LAYOUTS,
    defaultLayout: "stacked",
    itemFields: [
      { key: "label", kind: "text", empty: "unset" },
      { key: "address", kind: "text" },
      { key: "hours", kind: "text", empty: "unset" },
    ],
    // Sekcja dojazdu nie ma nic do ustawienia poza układem: mapa jest ZAWSZE za
    // kliknięciem (decyzja właściciela, ADR-096), a nie przełącznikiem — gdyby
    // dało się ją włączyć na stałe, cała gwarancja „zero żądań do dostawcy przed
    // kliknięciem" zależałaby od tego, czego operator nie odznaczył. Pusto
    // JAWNIE, jak przy FAQ i kontakcie.
    toggles: [],
    choices: [],
    // Jedna kolumna: trzy pola na wpis i sam układ mieszczą się bez zakładek.
    editor: "single",
    minItems: 1,
    maxItems: DIRECTIONS_MAX_ITEMS,
    // Punkty odbioru mieszkają w module Dostaw i to samo miejsce operator
    // opisuje drugi raz na stronie. Przycisk kopiujący zdejmuje przepisywanie
    // adresów z ręki — patrz `itemsImport` w opisie typu.
    itemsImport: "pickupLocations",
    // Render dojazdu maluje: nazwę punktu i nagłówek (ink), godziny i notkę
    // o mapie (inkMuted), obrys karty, ramki mapy i chipów wyboru (border),
    // przycisk „Pokaż mapę" (accentFill, accentText, a od E7 także accentOnFill
    // — etykieta NA jego wypełnieniu) oraz odnośnik „Prowadź" (ink w spoczynku,
    // accentText pod kursorem).
    themeRoles: ["ink", "inkMuted", "border", "accentText", "accentFill", "accentOnFill"],
    preset: {
      pl: {
        v: STRUCTURED_SECTION_VERSION,
        type: "directions",
        layout: "stacked",
        background: "default",
        heading: "Jak do nas trafić",
        items: [
          {
            label: "Magazyn i wydawanie sprzętu",
            address: "ul. Przykładowa 5, 00-001 Warszawa",
            hours: "pon.–pt. 8:00–17:00",
          },
          {
            label: "Punkt odbioru w centrum",
            address: "ul. Druga 12, 00-002 Warszawa",
            hours: "sob. 9:00–13:00",
          },
        ],
      },
      en: {
        v: STRUCTURED_SECTION_VERSION,
        type: "directions",
        layout: "stacked",
        background: "default",
        heading: "How to find us",
        items: [
          {
            label: "Warehouse and gear pickup",
            address: "5 Example Street, London EC1A 1AA",
            hours: "Mon–Fri 8:00–17:00",
          },
          {
            label: "City centre pickup point",
            address: "12 Sample Road, London EC1A 2BB",
            hours: "Sat 9:00–13:00",
          },
        ],
      },
    },
    newItem: {
      pl: { label: "Nowy punkt", address: "ul. Przykładowa 1, 00-001 Warszawa" },
      en: { label: "New location", address: "1 Example Street, London EC1A 1AA" },
    },
    fromLegacy: (content: unknown) => {
      const items = directionsLocationsFromLegacy(content);
      if (items.length === 0) return null;
      const source = content as { heading?: unknown } | null;
      const legacyHeading =
        typeof source?.heading === "string" && source.heading.trim().length > 0
          ? source.heading
          : isSectionCanvas(content)
            ? canvasHeading(content)
            : undefined;
      return {
        v: STRUCTURED_SECTION_VERSION,
        type: "directions",
        layout: "stacked",
        background: "default",
        ...(legacyHeading ? { heading: legacyHeading } : {}),
        items,
      };
    },
  },
  pricing: {
    schema: pricingStructuredSchema,
    layouts: PRICING_LAYOUTS,
    defaultLayout: "table",
    itemFields: [
      { key: "name", kind: "text" },
      // PIERWSZE POLE PIENIĘŻNE W SZUFLADZIE (E6). Osobny rodzaj, a nie „text",
      // bo wartość w treści jest LICZBĄ całkowitą groszy — pole tekstowe
      // zapisałoby tam napis, którego schemat i tak by nie przyjął, a operator
      // zobaczyłby sekcję, która przestała się zapisywać bez podania powodu.
      { key: "price_grosze", kind: "money" },
      { key: "unit", kind: "choice", values: PRICING_UNITS },
      { key: "mode", kind: "choice", values: PRICING_PRICE_MODES },
      { key: "note", kind: "text", empty: "unset" },
    ],
    // Notka pod listą jest polem SEKCJI: dotyczy całego cennika („ceny netto"),
    // a nie pojedynczej pozycji — kopia w każdym wpisie byłaby tym samym
    // zdaniem powtórzonym czterdzieści razy.
    fields: [{ key: "footnote", kind: "multiline", rows: 2, empty: "unset" }],
    toggles: [{ key: "showCatalogLink" }],
    // Układ cennika nie ma nic do ustawienia poza sobą: liczba kolumn tabeli
    // wynika z pól wpisu, a karty układają się od LICZBY POZYCJI, nie od
    // kontrolki (patrz auto-układ w @avably/ui). Pusto JAWNIE, jak przy FAQ.
    choices: [],
    // Pięć pól na wpis plus notka sekcji i przełącznik katalogu: dwie zakładki
    // rozdzieliłyby cenę od jej jednostki, czyli dwie połowy jednej decyzji.
    editor: "single",
    minItems: 1,
    maxItems: PRICING_MAX_ITEMS,
    // Render cennika maluje: nazwę pozycji i nagłówki kolumn (ink), jednostkę,
    // notkę pozycji i notkę sekcji (inkMuted), kreski wierszy tabeli i obrys
    // kart (border), cenę oraz odnośnik do katalogu pod kursorem (accentText).
    // Zero wypełnienia akcentem: cennik ma się CZYTAĆ, a nie krzyczeć.
    themeRoles: ["ink", "inkMuted", "border", "accentText"],
    preset: {
      pl: {
        v: STRUCTURED_SECTION_VERSION,
        type: "pricing",
        layout: "table",
        background: "default",
        heading: "Cennik",
        footnote: "Ceny netto. Kaucja zwrotna liczona osobno, przy odbiorze sprzętu.",
        showCatalogLink: true,
        items: PRICING_PRESET_ITEMS.pl,
      },
      en: {
        v: STRUCTURED_SECTION_VERSION,
        type: "pricing",
        layout: "table",
        background: "default",
        heading: "Pricing",
        footnote: "Prices exclude VAT. A refundable deposit is charged separately at pickup.",
        showCatalogLink: true,
        items: PRICING_PRESET_ITEMS.en,
      },
    },
    newItem: {
      pl: { name: "Nowa pozycja", price_grosze: 0, unit: "day", mode: "exact" },
      en: { name: "New item", price_grosze: 0, unit: "day", mode: "exact" },
    },
    /*
     * KONWERSJA PRZENOSI NAGŁÓWEK I NOTKĘ, A POZYCJE BIERZE Z PRESETU — bo
     * pozycji w starej treści NIE MA (patrz `pricingHeadAndNoteFromLegacy`).
     * Zwrócenie `null` byłoby czystsze o jedną linię i gorsze o dwa napisy,
     * które operator naprawdę napisał: degradacja do presetu (którą i tak
     * dostaje) skasowałaby jego nagłówek i notkę bez słowa.
     */
    fromLegacy: (content: unknown, locale: StructuredPresetLocale) => {
      const { heading: legacyHeading, footnote } = pricingHeadAndNoteFromLegacy(content);
      if (!legacyHeading && !footnote) return null;
      return {
        v: STRUCTURED_SECTION_VERSION,
        type: "pricing",
        layout: "table",
        background: "default",
        ...(legacyHeading ? { heading: legacyHeading } : {}),
        ...(footnote ? { footnote } : {}),
        showCatalogLink: true,
        items: structuredClone(PRICING_PRESET_ITEMS[locale]),
      };
    },
  },

  testimonials: {
    schema: testimonialsStructuredSchema,
    layouts: TESTIMONIALS_LAYOUTS,
    defaultLayout: "grid",
    itemFields: [
      { key: "quote", kind: "multiline", rows: 4 },
      { key: "author", kind: "text" },
      { key: "role", kind: "text", empty: "unset" },
    ],
    // Opinie nie mają czego ustawiać poza układem: gęstość siatki wynika
    // z LICZBY opinii (auto-układ), a karuzela z definicji pokazuje jedną po
    // drugiej. Pusto JAWNIE, jak przy FAQ i kontakcie.
    toggles: [],
    choices: [],
    editor: "single",
    minItems: 1,
    maxItems: TESTIMONIALS_MAX_ITEMS,
    // Render opinii maluje: cytat i podpis (ink), rolę podpisującego (inkMuted),
    // obrys kart i strzałek pasa (border). Zero akcentu — opinia ma brzmieć
    // wiarygodnie, a kolorowy cudzysłów robi z niej reklamę.
    themeRoles: ["ink", "inkMuted", "border"],
    preset: {
      pl: {
        v: STRUCTURED_SECTION_VERSION,
        type: "testimonials",
        layout: "grid",
        background: "default",
        heading: "Co mówią klienci",
        items: [
          {
            quote:
              "Namiot stanął dzień wcześniej, a ekipa została, dopóki wszystko nie było ustawione. W dniu wesela nie musieliśmy myśleć o sprzęcie ani przez chwilę.",
            author: "Anna i Marek",
            role: "Wesele w plenerze, 120 osób",
          },
          {
            quote:
              "Zamawiamy u nich sprzęt na każdą imprezę firmową od trzech lat. Nagłośnienie zawsze sprawne, a rozliczenie idzie fakturą bez przypominania.",
            author: "Katarzyna Nowak",
            role: "Dział administracji",
          },
          {
            quote:
              "Potrzebowaliśmy stołów i krzeseł z dnia na dzień. Dostaliśmy potwierdzenie w godzinę i podstawiony transport następnego ranka.",
            author: "Dom Kultury w Bukowinie",
          },
        ],
      },
      en: {
        v: STRUCTURED_SECTION_VERSION,
        type: "testimonials",
        layout: "grid",
        background: "default",
        heading: "What our customers say",
        items: [
          {
            quote:
              "The marquee went up a day early and the crew stayed until everything was in place. On the wedding day we never once had to think about the equipment.",
            author: "Anna and Mark",
            role: "Outdoor wedding, 120 guests",
          },
          {
            quote:
              "We have booked their gear for every company event for three years. The sound system always works and the invoice arrives without chasing.",
            author: "Katherine Novak",
            role: "Office management",
          },
          {
            quote:
              "We needed tables and chairs at a day's notice. We had confirmation within the hour and a van at the door the next morning.",
            author: "Bukowina Community Centre",
          },
        ],
      },
    },
    newItem: {
      pl: { quote: "Treść nowej opinii.", author: "Imię i nazwisko" },
      en: { quote: "The new testimonial goes here.", author: "Full name" },
    },
    fromLegacy: (content: unknown) => {
      const items = testimonialsFromLegacy(content);
      if (items.length === 0) return null;
      const source = content as { heading?: unknown } | null;
      const legacyHeading =
        typeof source?.heading === "string" && source.heading.trim().length > 0
          ? source.heading
          : isSectionCanvas(content)
            ? canvasHeading(content)
            : undefined;
      return {
        v: STRUCTURED_SECTION_VERSION,
        type: "testimonials",
        layout: "grid",
        background: "default",
        ...(legacyHeading ? { heading: legacyHeading } : {}),
        items,
      };
    },
  },

  products: {
    schema: productsStructuredSchema,
    layouts: PRODUCTS_LAYOUTS,
    defaultLayout: "grid",
    // Jedno pole na wpis i nie jest nim napis: wpis sekcji sprzętu WSKAZUJE
    // pozycję katalogu, a nie opisuje ją (patrz `reference` w rodzajach pól).
    itemFields: [{ key: "productId", kind: "reference" }],
    toggles: [],
    choices: [
      { key: "source", values: PRODUCTS_SOURCES },
      { key: "limit", values: PRODUCTS_LIMITS },
    ],
    // Wybór pozycji i wygląd sekcji to dwie różne prace — jak przy galerii.
    editor: "split",
    // PODŁOGA ZERO, jedyna w rejestrze. Uzasadnienie przy polu `items`
    // schematu: treścią tej sekcji jest KATALOG, więc pusta lista nie robi
    // z niej pustego nagłówka.
    minItems: 0,
    maxItems: PRODUCTS_MAX_ITEMS,
    itemsPick: "catalogProducts",
    itemsWhen: { key: "source", value: "picked" },
    // Render sprzętu maluje: nagłówek sekcji i nazwę pozycji (ink), opis
    // (inkMuted), obrys kafla i kreski wierszy (border) oraz cenę i odnośnik
    // do katalogu pod kursorem (accentText). Zero wypełnienia akcentem: kolor
    // ma nieść ZDJĘCIE sprzętu, a nie ramka wokół niego.
    themeRoles: ["ink", "inkMuted", "border", "accentText"],
    preset: {
      pl: {
        v: STRUCTURED_SECTION_VERSION,
        type: "products",
        layout: "grid",
        background: "default",
        heading: "Nasz sprzęt",
        source: "catalog",
        items: [],
        limit: 8,
      },
      en: {
        v: STRUCTURED_SECTION_VERSION,
        type: "products",
        layout: "grid",
        background: "default",
        heading: "Our equipment",
        source: "catalog",
        items: [],
        limit: 8,
      },
    },
    // Bez `newItem` ŚWIADOMIE: wpis rodzi się WYBOREM pozycji z katalogu, a nie
    // przyciskiem „dodaj". Świeży wpis musiałby nieść wymyślony identyfikator,
    // którego schemat nie przyjmie — a operator zobaczyłby błąd zamiast wpisu.
    fromLegacy: (content: unknown) => {
      const legacyHeading = productsHeadingFromLegacy(content);
      if (!legacyHeading) return null;
      return {
        v: STRUCTURED_SECTION_VERSION,
        type: "products",
        layout: "grid",
        background: "default",
        heading: legacyHeading,
        source: "catalog",
        items: [],
        limit: 8,
      };
    },
  },

  usp: {
    schema: uspStructuredSchema,
    layouts: USP_LAYOUTS,
    defaultLayout: "cards",
    itemFields: [
      { key: "icon", kind: "choice", values: USP_ICONS },
      { key: "title", kind: "text" },
      { key: "text", kind: "multiline", rows: 3 },
    ],
    toggles: [],
    // Atuty nie mają czego ustawiać poza układem: gęstość siatki wynika
    // z LICZBY atutów (auto-układ E6). Pusto JAWNIE, jak przy FAQ.
    choices: [],
    editor: "single",
    minItems: 1,
    maxItems: USP_MAX_ITEMS,
    // Render atutów maluje: nagłówek sekcji i tytuł kafla (ink), zdanie pod
    // tytułem (inkMuted), obrys kafla w układzie `cards` (border) oraz kafelek
    // ikony (accentFill) i sam znak na nim (accentText).
    themeRoles: ["ink", "inkMuted", "border", "accentFill", "accentText"],
    preset: {
      pl: {
        v: STRUCTURED_SECTION_VERSION,
        type: "usp",
        layout: "cards",
        background: "default",
        heading: "Dlaczego my",
        items: [
          {
            icon: "truck",
            title: "Dowóz i odbiór pod adres",
            text: "Podstawiamy sprzęt na miejsce i odbieramy go po zakończeniu najmu — bez organizowania transportu na własną rękę.",
          },
          {
            icon: "shield-check",
            title: "Sprzęt sprawdzany po każdym najmie",
            text: "Każdy egzemplarz przechodzi przegląd przed wydaniem. Usterka w trakcie najmu znaczy wymianę, a nie czekanie.",
          },
          {
            icon: "clock",
            title: "Potwierdzenie rezerwacji tego samego dnia",
            text: "Rezerwację złożoną w godzinach pracy potwierdzamy tego samego dnia, razem z terminem podstawienia.",
          },
        ],
      },
      en: {
        v: STRUCTURED_SECTION_VERSION,
        type: "usp",
        layout: "cards",
        background: "default",
        heading: "Why us",
        items: [
          {
            icon: "truck",
            title: "Delivery and pickup at your address",
            text: "We bring the gear to the site and collect it when the rental ends — no need to arrange transport yourself.",
          },
          {
            icon: "shield-check",
            title: "Every item checked after each rental",
            text: "Each unit is serviced before it goes out. A fault during the rental means a replacement, not a wait.",
          },
          {
            icon: "clock",
            title: "Same-day booking confirmation",
            text: "Bookings placed during business hours are confirmed the same day, together with the delivery slot.",
          },
        ],
      },
    },
    newItem: {
      pl: { icon: "badge-check", title: "Nowy atut", text: "Zdanie, które go rozwija." },
      en: { icon: "badge-check", title: "New selling point", text: "A sentence that expands on it." },
    },
    fromLegacy: (content: unknown) => {
      const items = uspItemsFromLegacy(content);
      if (items.length === 0) return null;
      const source = content as { heading?: unknown } | null;
      const legacyHeading =
        typeof source?.heading === "string" && source.heading.trim().length > 0
          ? source.heading
          : isSectionCanvas(content)
            ? canvasHeading(content)
            : undefined;
      return {
        v: STRUCTURED_SECTION_VERSION,
        type: "usp",
        layout: "cards",
        background: "default",
        ...(legacyHeading ? { heading: legacyHeading } : {}),
        items,
      };
    },
  },

  delivery: {
    schema: deliveryStructuredSchema,
    layouts: DELIVERY_LAYOUTS,
    defaultLayout: "cards",
    itemFields: [
      { key: "title", kind: "text" },
      { key: "text", kind: "multiline", rows: 3 },
      // CENA OPCJONALNA — pustka ZDEJMUJE pole, więc „Odbiór osobisty" zostaje
      // kartą bez ceny, a nie kartą za zero złotych (patrz schemat).
      { key: "price_grosze", kind: "money", empty: "unset" },
    ],
    // Zdanie wprowadzające dotyczy CAŁEJ dostawy, nie pojedynczego wariantu —
    // kopia w każdym wpisie byłaby tym samym akapitem powtórzonym dwanaście razy.
    fields: [{ key: "intro", kind: "multiline", rows: 3, empty: "unset" }],
    toggles: [],
    choices: [],
    editor: "single",
    minItems: 1,
    maxItems: DELIVERY_MAX_ITEMS,
    // Render dostawy maluje: nagłówek sekcji i tytuł wariantu (ink), zdanie
    // wprowadzające oraz opis wariantu (inkMuted), obrys kart i kreski wierszy
    // (border) i cenę (accentText). Zero wypełnienia akcentem — jak w cenniku.
    themeRoles: ["ink", "inkMuted", "border", "accentText"],
    preset: {
      pl: {
        v: STRUCTURED_SECTION_VERSION,
        type: "delivery",
        layout: "cards",
        background: "default",
        heading: "Dostawa i odbiór",
        intro:
          "Sprzęt można odebrać osobiście albo zamówić z dowozem. Termin podstawienia ustalamy przy potwierdzeniu rezerwacji.",
        items: [
          {
            title: "Odbiór osobisty",
            text: "Wydajemy sprzęt w magazynie w godzinach pracy. Zabierz dokument tożsamości i miejsce na transport.",
          },
          {
            title: "Dowóz na terenie miasta",
            text: "Podstawiamy sprzęt pod wskazany adres i odbieramy go po zakończeniu najmu.",
            price_grosze: 12_000,
          },
          {
            title: "Dowóz poza miasto",
            text: "Do 50 km od magazynu. Dalsze trasy wyceniamy indywidualnie przy potwierdzeniu rezerwacji.",
            price_grosze: 29_000,
          },
        ],
      },
      en: {
        v: STRUCTURED_SECTION_VERSION,
        type: "delivery",
        layout: "cards",
        background: "default",
        heading: "Delivery and pickup",
        intro:
          "You can collect the gear yourself or have it delivered. We agree the delivery slot when we confirm your booking.",
        items: [
          {
            title: "Collect in person",
            text: "We hand the gear over at the warehouse during business hours. Bring photo ID and room to carry it.",
          },
          {
            title: "Delivery within the city",
            text: "We bring the gear to the address you give us and collect it when the rental ends.",
            price_grosze: 12_000,
          },
          {
            title: "Delivery outside the city",
            text: "Up to 50 km from the warehouse. We quote longer routes individually when confirming the booking.",
            price_grosze: 29_000,
          },
        ],
      },
    },
    newItem: {
      pl: { title: "Nowy sposób dostawy", text: "Warunki, zasięg i czas podstawienia." },
      en: { title: "New delivery option", text: "Terms, coverage and lead time." },
    },
    fromLegacy: (content: unknown) => {
      const { intro, items } = deliveryFromLegacy(content);
      if (items.length === 0) return null;
      const source = content as { heading?: unknown } | null;
      const legacyHeading =
        typeof source?.heading === "string" && source.heading.trim().length > 0
          ? source.heading
          : isSectionCanvas(content)
            ? canvasHeading(content)
            : undefined;
      return {
        v: STRUCTURED_SECTION_VERSION,
        type: "delivery",
        layout: "cards",
        background: "default",
        ...(legacyHeading ? { heading: legacyHeading } : {}),
        ...(intro ? { intro } : {}),
        items,
      };
    },
  },

  cta: {
    schema: ctaStructuredSchema,
    layouts: CTA_LAYOUTS,
    defaultLayout: "banner",
    // Wpisem jest PRZYCISK: etykieta i cel. Uzasadnienie listy zamiast jednego
    // pola `button` stoi przy `items` w schemacie.
    itemFields: [
      { key: "label", kind: "text" },
      { key: "href", kind: "text" },
    ],
    // Zdanie pod nagłówkiem jest polem SEKCJI, bo nie należy do żadnego
    // z przycisków — a przy dwóch przyciskach kopia w każdym byłaby tym samym
    // zdaniem napisanym dwa razy.
    fields: [{ key: "text", kind: "multiline", rows: 3, empty: "unset" }],
    toggles: [],
    choices: [{ key: "variant", values: CTA_VARIANTS }],
    editor: "single",
    minItems: 1,
    maxItems: CTA_MAX_ITEMS,
    // Render CTA maluje: nagłówek (ink), zdanie pod nim (inkMuted), obrys
    // panelu w wariancie `panel` (border), wypełnienie przycisku i panelu
    // akcentowego (accentFill), etykietę przycisku obrysowego (accentText)
    // oraz — i to jest cała stawka wariantu `accent` — NAPIS NA WYPEŁNIENIU
    // akcentu (accentOnFill).
    themeRoles: ["ink", "inkMuted", "border", "accentFill", "accentText", "accentOnFill"],
    preset: {
      pl: {
        v: STRUCTURED_SECTION_VERSION,
        type: "cta",
        layout: "banner",
        background: "default",
        variant: "accent",
        heading: "Potrzebujesz sprzętu na konkretny termin?",
        text: "Sprawdź dostępność w katalogu i zarezerwuj online. Potwierdzenie dostaniesz mailem.",
        items: [{ label: "Zobacz katalog", href: PRODUCTS_CATALOG_HREF }],
      },
      en: {
        v: STRUCTURED_SECTION_VERSION,
        type: "cta",
        layout: "banner",
        background: "default",
        variant: "accent",
        heading: "Need equipment for a specific date?",
        text: "Check availability in the catalog and book online. You will get an email confirmation.",
        items: [{ label: "Browse the catalog", href: PRODUCTS_CATALOG_HREF }],
      },
    },
    newItem: {
      pl: { label: "Nowy przycisk", href: PRODUCTS_CATALOG_HREF },
      en: { label: "New button", href: PRODUCTS_CATALOG_HREF },
    },
    fromLegacy: (content: unknown) => {
      const { heading: legacyHeading, text, items } = ctaFromLegacy(content);
      // Bez przycisku nie ma CTA: schemat go wymaga, a wymyślenie etykiety
      // i adresu byłoby dopisaniem najemcy wezwania, którego nie napisał.
      if (items.length === 0) return null;
      return {
        v: STRUCTURED_SECTION_VERSION,
        type: "cta",
        layout: "banner",
        background: "default",
        // Wariant zostaje DOMYŚLNY, a nie „odwrócony jak dotąd": przeniesienie
        // starego „zawsze ciemny baner" powielałoby dokładnie tę pinezkę
        // („złe kolory w każdym szablonie"), którą ten typ zamyka.
        variant: "plain",
        ...(legacyHeading ? { heading: legacyHeading } : {}),
        ...(text ? { text } : {}),
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
export type StructuredPresetLocale = (typeof STRUCTURED_PRESET_LOCALES)[number];

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
  const converted = spec.fromLegacy?.(content, localeOf(locale)) ?? null;
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
 *
 * WARTOŚĆ BYWA LICZBĄ (E6): cena pozycji cennika jest `int` groszy, więc
 * przepuszczenie tu wyłącznie napisów zapisywałoby do treści `"12000"` —
 * kształt, którego schemat nie przyjmie, a którego odrzucenie operator
 * zobaczyłby dopiero jako sekcję, która przestała się zapisywać.
 */
export function patchStructuredItem<T extends StructuredSectionContent>(
  content: T,
  index: number,
  key: string,
  value: string | number | undefined,
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

/**
 * Jedno pole CAŁEJ SEKCJI (E4, `fields` w rejestrze) — ta sama semantyka
 * pustki, co przy polach wpisu: `undefined` ZDEJMUJE pole opcjonalne, którego
 * schemat nie przyjąłby jako pustego napisu.
 *
 * Osobna funkcja zamiast spreadu u wołającego, bo skasowanie klucza i wpisanie
 * do niego `undefined` to w `jsonb` DWIE RÓŻNE treści — a kopia tej reguły
 * w szufladzie rozjechałaby się z regułą wpisów przy pierwszej poprawce.
 */
export function patchStructuredField<T extends StructuredSectionContent>(
  content: T,
  key: string,
  value: string | undefined,
): T {
  const next = { ...(content as unknown as Record<string, unknown>) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next as unknown as T;
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
