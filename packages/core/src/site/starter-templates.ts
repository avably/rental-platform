/**
 * SZABLONY STARTOWE (K5, ADR-090; treść 2.0 w E9) — sześć gotowych STRON, od
 * których tenant zaczyna pracę w kreatorze, zamiast od pustego płótna.
 *
 * Presety sekcji (ADR-082) rozwiązały problem „pustej sekcji": nowa sekcja
 * rodzi się z treścią. Nie rozwiązały problemu PUSTEJ STRONY — operator
 * wypożyczalni wchodzi do kreatora pierwszy raz i musi sam wymyślić, z czego
 * składa się strona sprzedażowa, w jakiej kolejności i ile tego ma być. Szablon
 * startowy odpowiada na to jednym kliknięciem: dostaje SKŁAD strony, a nie
 * kolejny pusty ekran z przyciskiem „dodaj sekcję".
 *
 * ================ DWIE GENERACJE TREŚCI W JEDNYM SZABLONIE (E9) ================
 *
 * Do E8 szablon deklarował WSZYSTKO w kształcie v1, a konwersja robiła z tego
 * płótno v2. Po domknięciu rejestru typów strukturalnych (E1–E7, ADR-094) taka
 * strona startowa była już GORSZA od strony składanej ręcznie: FAQ ze szablonu
 * nie miał accordionu, cennik nie znał pojęcia ceny, kontakt nie miał
 * formularza, a galeria — zdjęć. Operator dostawał więc od nas płaską atrapę
 * tego, co sam mógł dodać jednym kliknięciem w pełnej wersji.
 *
 * Odtąd szablon deklaruje treść w GENERACJI WŁAŚCIWEJ DLA TYPU:
 *
 *   • typ z rejestru strukturalnego (`isStructuredType`) → treść v3, czyli
 *     dokładnie ta, którą zapisałby edytor sekcji — z układem, listą wpisów
 *     i przełącznikami;
 *   • typ bez silnika strukturalnego (`hero`, `freeform`, `footer`) → treść v1
 *     przepuszczona przez {@link sectionCanvasWith}, tak jak dotąd. To są
 *     jedyne trzy typy, dla których wolna kompozycja płótna JEST właściwym
 *     kształtem: pierwszy ekran na pełnym kadrze, dowolny blok i stopka nie
 *     mają „wpisów listy", które dałoby się z nich wydobyć.
 *
 * Pasmo tła zostaje przy DEKLARACJI w obu generacjach (patrz niżej), a treść
 * v3 dostaje je przy emisji — dzięki temu rytm pasm całej strony czyta się
 * z jednego miejsca, a nie z trzynastu obiektów treści.
 *
 * ============ DLACZEGO TYPY BEZ SILNIKA TO NADAL LISTA TREŚCI v1 ============
 *
 * Szablon deklaruje dla nich UPORZĄDKOWANĄ LISTĘ SEKCJI w kształcie v1 (typ +
 * treść + pasmo tła), a płótno v2 rodzi się z niej przez {@link sectionCanvasWith}
 * — tę samą, obłożoną kontraktem konwersję, z której korzysta galeria sekcji
 * (K2, ADR-084). Wpisanie współrzędnych ręcznie byłoby szybsze do napisania
 * i kosztowałoby trzy rzeczy naraz:
 *
 *   1. PUDEŁKA OBEJMUJĄCE TREŚĆ I WYSOKOŚCI SEKCJI. Konwersja liczy je
 *      z estymatora tekstu (K4, ADR-088). Współrzędne wklepane ręcznie są
 *      prawdziwe wyłącznie dla tej długości napisu, którą akurat miał autor —
 *      pierwsza poprawka copy i nagłówek wchodzi w akapit pod sobą.
 *   2. TELEFON ZA DARMO. Auto-układ mobilny wyprowadza kolumnę z geometrii
 *      desktopowej, więc szablon przepuszczony przez konwersję dostaje widok
 *      mobilny bez jednej dodatkowej liczby.
 *   3. JEDNO ŹRÓDŁO PRAWDY O UKŁADZIE. Ręczna geometria byłaby DRUGĄ,
 *      nietestowaną definicją układu — rozjechałaby się z konwersją po cichu,
 *      a pierwsza zmiana w `canvas-presets.ts` psułaby sześć stron naraz,
 *      których nikt nie przelicza.
 *
 * ==================== PASMO TŁA JEST DECYZJĄ SZABLONU ====================
 *
 * `background` NIE pochodzi z konwersji i nie może: ta widzi JEDNĄ sekcję i nie
 * ma z czego wiedzieć, że akurat ta ma być pasem odwróconym. Rytm pasm (jasne /
 * przygaszone / odwrócone) jest własnością szablonu jako CAŁOŚCI, więc stoi
 * w deklaracji obok treści, a konwersja dostaje go dopiero na wyjściu. Przy
 * okazji wystawia to akcent strony na więcej niż jednym paśmie — czego kontrast
 * palety (K5, ADR-090) wymaga od strony, a nie od pojedynczej sekcji.
 *
 * ================ KADR GALERII WSKAZUJE SLOT, A NIE ADRES ================
 *
 * Wpis galerii w deklaracji niesie SLOT z rejestru kuracji (./starter-photos),
 * a nie gotowy `ImageSource`. Powód jest ten sam, dla którego rejestr kadrów
 * stoi w osobnym pliku: adres, nazwisko autora i wyzwalacz pobrania przychodzą
 * Z API dostawcy i nie wolno ich przepisywać z ręki. Gdyby treść szablonu
 * niosła je wprost, wymiana kadru przy najbliższej kuracji wymagałaby edycji
 * DWÓCH wersji językowych tego samego akapitu, a atrybucja miałaby dwie kopie
 * — czyli dwie okazje do rozjazdu z licencją.
 *
 * ====================== DWA JĘZYKI, PARYTET W CI ======================
 *
 * Jak przy presetach (ADR-082): treść jest DANYMI tenanta, więc pisana ręcznie
 * po polsku i po angielsku, a nie generowana z kluczy i18n. Parytet struktury
 * pilnuje test — szablon gubiący pole albo pozycję listy w jednym języku jest
 * czerwony, zanim ktokolwiek zobaczy dziurę na opublikowanej stronie.
 */
import type { z } from "zod";

import { sectionCanvasWith, type SectionComposition, type SectionMedia } from "./canvas-presets";
import type { SectionBackground, SectionCanvas } from "./elements";
import { starterPhoto, type StarterPhotoSlot } from "./starter-photos";
import { headingMetricRatio } from "./fonts";
import {
  isStructuredType,
  PRICING_CATALOG_HREF,
  STRUCTURED_SECTION_VERSION,
  type GalleryStructuredContent,
  type StructuredContentOf,
  type StructuredSectionContent,
  type StructuredSectionType,
} from "./structured";
import { themeTokens, type SiteThemeId } from "./theme";
/*
 * IMPORT TYLKO TYPÓW, i to jest tu warunek działania, a nie kosmetyka:
 * `index.ts` re-eksportuje ten moduł, więc import WARTOŚCI zamknąłby cykl
 * `index → starter-templates → index`. Re-eksporty są hoistowane, więc ten plik
 * ewaluowałby się PRZED ciałem `index.ts` i zobaczyłby `SECTION_CONTENT_SCHEMAS`
 * w martwej strefie. `import type` znika przy kompilacji — cyklu nie ma.
 * (`./structured` wyżej wolno importować WARTOŚCIOWO: ten moduł nie sięga
 * z powrotem do `./index`, więc cyklu nie ma czym zamknąć.)
 */
import type { SECTION_CONTENT_SCHEMAS, SectionType } from "./index";
import { PRESET_LOCALES, type PresetLocale } from "./presets";

/**
 * Identyfikatory szablonów — zamknięta, UPORZĄDKOWANA lista (kolejność jest
 * kolejnością w galerii kreatora). Angielskie i STABILNE, bo trafiają do bazy
 * jako wybór tenanta: zmiana nazwy identyfikatora to migracja danych, a nie
 * refaktor. Cztery pozycje branżowe biorą się wprost z profilu klienta
 * (budowlanka, rowery i sport, eventy, sprzęt foto/wideo), dwie ogólne są dla
 * tych, którzy nie mieszczą się w żadnej z nich.
 */
export const STARTER_TEMPLATES = [
  "construction-tools",
  "bike-sport",
  "event-party",
  "photo-video",
  "one-page-lean",
  "catalog-first",
] as const;
export type StarterTemplate = (typeof STARTER_TEMPLATES)[number];

/**
 * Ile sekcji ma mieć szablon startowy. Dolna granica broni przed stroną, która
 * po zastosowaniu szablonu nadal wygląda na niedokończoną; górna — przed
 * stroną, którą pierwszy raz w życiu widziany kreator każe najpierw PRZYCIĄĆ.
 * Obie są pilnowane kontraktem porównującym szablony ze sobą.
 *
 * Granice zostają NIETKNIĘTE w E9, mimo że sekcje strukturalne są dłuższe od
 * płaskich odpowiedników z v1: strona urosła w treść, więc podnoszenie sufitu
 * liczby sekcji szłoby w złą stronę.
 */
export const STARTER_SECTION_BOUNDS = { min: 5, max: 7 } as const;

/**
 * KOMPLETNOŚĆ TREŚCI SEKCJI STRUKTURALNEJ — próg, poniżej którego szablon
 * przestaje być „gotową stroną" (E9).
 *
 * Schemat typu wymaga JEDNEGO wpisu, bo jeden wpis to najmniejsza sensowna
 * sekcja, którą operator może sobie sam zbudować. Szablon startowy ma inny
 * cel: pokazać, jak sekcja wygląda PEŁNA. FAQ z jednym pytaniem i galeria
 * z jednym kadrem spełniają schemat i nie spełniają obietnicy — więc próg
 * stoi tutaj, obok treści, a kontrakt liczy go po CAŁYM zbiorze szablonów.
 */
export const STARTER_CONTENT_MINIMUMS = {
  faq: 4,
  gallery: 6,
  pricing: 4,
  usp: 3,
  delivery: 3,
  testimonials: 3,
  contact: 3,
  directions: 2,
  cta: 1,
  products: 0,
} as const satisfies Record<StructuredSectionType, number>;

/**
 * Wpis galerii W DEKLARACJI szablonu: kadr wskazany SLOTEM z rejestru kuracji,
 * plus opis alternatywny i podpis w języku tej wersji szablonu.
 */
export interface StarterGalleryItem {
  slot: StarterPhotoSlot;
  /** Opis alternatywny — NIGDY pusty w szablonie (kontrakt niżej go liczy). */
  alt: string;
  caption?: string;
}

/**
 * Treść sekcji strukturalnej W DEKLARACJI: bez `v`, `type` i `background`
 * (te dokłada emisja — pierwsze dwa są znane z kształtu, trzecie z rytmu pasm),
 * a dla galerii z listą slotów zamiast gotowych adresów kadrów.
 */
type StarterStructuredContent<T extends StructuredSectionType> = T extends "gallery"
  ? Omit<GalleryStructuredContent, "v" | "type" | "background" | "items"> & {
      items: StarterGalleryItem[];
    }
  : Omit<StructuredContentOf<T>, "v" | "type" | "background">;

/** Typy sekcji BEZ silnika strukturalnego — jedyne, które szablon deklaruje w v1. */
type LegacySectionType = Exclude<SectionType, StructuredSectionType>;

/**
 * Jedna sekcja szablonu: typ, treść ZGODNA z generacją tego typu i pasmo tła.
 * Kształt treści bierze się wprost ze schematów — treść niepasująca do typu nie
 * skompiluje się. Bez tego rozjazd wyszedłby dopiero na walidacji, w teście,
 * daleko od miejsca, w którym powstał.
 */
export type StarterSection =
  | {
      [T in LegacySectionType]: {
        type: T;
        content: z.infer<(typeof SECTION_CONTENT_SCHEMAS)[T]>;
        background: SectionBackground;
      };
    }[LegacySectionType]
  | {
      [T in StructuredSectionType]: {
        type: T;
        content: StarterStructuredContent<T>;
        background: SectionBackground;
      };
    }[StructuredSectionType];

/**
 * Sekcja szablonu po emisji — treść jest już tym, co kreator zapisze do
 * `content_draft`: płótnem v2 albo sekcją strukturalną v3.
 */
export interface StarterSectionContent {
  type: SectionType;
  content: SectionCanvas | StructuredSectionContent;
}

type StarterTable = Record<StarterTemplate, Record<PresetLocale, StarterSection[]>>;

/**
 * Adres map w sekcji „dojazd" i przy kontakcie. Wskazuje wyszukiwarkę, a nie
 * konkretny punkt: adresy w szablonie są PRZYKŁADOWE i operator podmienia je
 * na własne, więc utrwalony pinesek prowadziłby donikąd.
 */
const MAPS_URL = "https://maps.google.com";


// -----------------------------------------------------------------------
// ŚWIAT WIZUALNY SZABLONU — motyw, kadry i archetypy (K5 v2, ADR-090)
// -----------------------------------------------------------------------
//
// Właściciel odrzucił model „jeden układ w sześciu skórkach" (2026-08-03):
// szablony mają być RÓŻNYMI ŚWIATAMI. Świat składa się z trzech rzeczy i
// wszystkie trzy stoją tutaj jako DANE:
//
//   • MOTYW — paleta, kroje, promienie, styl przycisku, RUCH (rejestr ./theme);
//   • ARCHETYP KADRU per sekcja — czy hero stoi na pełnokadrowym zdjęciu,
//     czy obok niego (słownik w ./canvas-presets);
//   • SLOTY ZDJĘĆ — które kadry wchodzą i gdzie (rejestr w ./starter-photos).
//
// Tabela jest celowo ODDZIELONA od treści niżej. Treść to teksty, które piszemy
// po polsku i po angielsku; to jest deklaracja wyglądu, którą czyta silnik.
// Trzymanie ich razem znaczyłoby, że zmiana kadru wymaga przejścia przez dwie
// wersje językowe tego samego akapitu — a dopisanie szablonu nr 7 zaczyna się
// wtedy od kopiowania tysiąca linii, zamiast od jednego wpisu tutaj.
//
// Klucz `media` jest po TYPIE SEKCJI, nie po indeksie: pozycja sekcji w
// szablonie bywa zmieniana przy poprawkach treści, a typ jest tym, co naprawdę
// identyfikuje miejsce kadru. Kontrakt pilnuje, żeby typ z tej tabeli istniał
// w szablonie — wpis wskazujący na nieistniejącą sekcję jest czerwony.
//
// UWAGA E9: `compositions`/`media` obsługują WYŁĄCZNIE typy bez silnika
// strukturalnego, bo tylko one jadą przez konwersję do płótna. Kadr sekcji,
// która stała się strukturalna (dawne pasy przy dostawie, atutach czy
// dojeździe), nie zniknął z szablonu — przeniósł się do GALERII, czyli do
// jedynego typu strukturalnego, którego treścią SĄ zdjęcia.

interface StarterLayout {
  theme: SiteThemeId;
  /** Archetyp kadru per typ sekcji; brak wpisu = `stack` (sam tekst). */
  compositions?: Partial<Record<LegacySectionType, SectionComposition>>;
  /** Kadry per typ sekcji — slot z rejestru zdjęć + opis alternatywny w obu językach. */
  media?: Partial<
    Record<LegacySectionType, { slot: StarterPhotoSlot; alt: { pl: string; en: string } }[]>
  >;
}

export const STARTER_LAYOUTS: Record<StarterTemplate, StarterLayout> = {
  "construction-tools": {
    theme: "industrial-noir",
    compositions: { hero: "overlay" },
    media: {
      hero: [
        {
          slot: "construction-hero",
          alt: { pl: "Sprzęt budowlany na placu o zmierzchu", en: "Construction machinery on site at dusk" },
        },
      ],
    },
  },
  "bike-sport": {
    theme: "velocity",
    compositions: { hero: "split" },
    media: {
      hero: [
        { slot: "bike-hero", alt: { pl: "Rowerzysta na trasie", en: "Rider on the trail" } },
      ],
    },
  },
  "event-party": {
    theme: "confetti",
    compositions: { hero: "overlay" },
    media: {
      hero: [
        {
          slot: "event-hero",
          alt: { pl: "Namiot weselny w wieczornym świetle", en: "Wedding marquee in evening light" },
        },
      ],
    },
  },
  "photo-video": {
    theme: "noir-lux",
    compositions: { hero: "overlay" },
    media: {
      hero: [
        { slot: "photo-hero", alt: { pl: "Kamera i światło w studiu", en: "Camera and lighting on set" } },
      ],
    },
  },
  "one-page-lean": {
    theme: "atelier",
    compositions: { hero: "split", freeform: "band" },
    media: {
      hero: [
        { slot: "lean-hero", alt: { pl: "Narzędzia w dziennym świetle", en: "Tools in daylight" } },
      ],
      freeform: [
        { slot: "lean-workshop", alt: { pl: "Warsztat od strony stołu", en: "The workbench side of the shop" } },
      ],
    },
  },
  "catalog-first": {
    theme: "gridline",
    compositions: { hero: "band", freeform: "band" },
    media: {
      hero: [
        { slot: "catalog-hero", alt: { pl: "Uporządkowany magazyn sprzętu", en: "Neatly organised equipment store" } },
      ],
      freeform: [
        { slot: "catalog-delivery", alt: { pl: "Załadunek dostawczaka", en: "Loading the delivery van" } },
      ],
    },
  },
};

/** Motyw, w którym renderuje się szablon — wybór szablonu JEST wyborem świata. */
export function starterTemplateTheme(id: StarterTemplate): SiteThemeId {
  return STARTER_LAYOUTS[id].theme;
}

/**
 * Sloty zdjęć użyte przez szablon — wejście wyzwalacza pobrania przy zastosowaniu.
 *
 * Liczy DWA źródła, bo od E9 kadry stoją w dwóch miejscach: pasy i pierwsze
 * ekrany w tabeli układu, a kadry galerii w treści. Pominięcie drugiego źródła
 * nie zepsułoby ani jednego piksela strony — złamałoby warunek licencji dla
 * większości kadrów, czyli wadę, której nie widać na zrzucie ekranu.
 *
 * Sloty galerii bierzemy z wersji „pl": parytet PL↔EN jest kontraktem, więc
 * druga wersja językowa wskazuje te same kadry (osobny test tego pilnuje).
 */
export function starterTemplatePhotoSlots(id: StarterTemplate): StarterPhotoSlot[] {
  const zUkładu = Object.values(STARTER_LAYOUTS[id].media ?? {})
    .flat()
    .map((entry) => entry.slot);
  const zGalerii = STARTER_SECTIONS[id].pl.flatMap((section) =>
    section.type === "gallery" ? section.content.items.map((item) => item.slot) : [],
  );
  return [...new Set([...zUkładu, ...zGalerii])];
}

const STARTER_SECTIONS: StarterTable = {
  // ---------------------------------------------------------------------
  // Budowlanka i narzędzia — sprzedaje dostępność „na jutro rano" i logistykę.
  // ---------------------------------------------------------------------
  "construction-tools": {
    pl: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Sprzęt budowlany na dobę, tydzień albo cały etap",
          subheading:
            "Zagęszczarki, młoty, rusztowania i agregaty — sprawdzone przed każdym wydaniem, z dowozem na budowę.",
          ctaText: "Sprawdź dostępność",
          ctaHref: "#produkty",
        },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          layout: "cards",
          heading: "Dlaczego wykonawcy do nas wracają",
          items: [
            {
              icon: "truck",
              title: "Dowóz na plac budowy",
              text: "Przywozimy sprzęt pod adres inwestycji i odbieramy go po zakończeniu prac.",
            },
            {
              icon: "wrench",
              title: "Serwis po każdym najmie",
              text: "Każde urządzenie wraca do warsztatu, zanim pojedzie do kolejnego klienta.",
            },
            {
              icon: "credit-card",
              title: "Faktura VAT i rozliczenie miesięczne",
              text: "Stali wykonawcy dostają jedną zbiorczą fakturę na koniec miesiąca.",
            },
            {
              icon: "calendar-check",
              title: "Rezerwacja z wyprzedzeniem",
              text: "Blokujesz sprzęt na konkretny etap robót, nawet kilka tygodni wcześniej.",
            },
          ],
        },
      },
      {
        type: "products",
        background: "default",
        content: { layout: "grid", heading: "Sprzęt do wynajęcia", source: "catalog", items: [], limit: 8, featureFields: [] },
      },
      {
        type: "gallery",
        background: "muted",
        content: {
          layout: "masonry",
          heading: "Nasz sprzęt na budowach",
          columns: 3,
          gap: "regular",
          lightbox: true,
          items: [
            {
              slot: "construction-gallery-1",
              alt: "Rusztowanie postawione na całej wysokości betonowego budynku",
              caption: "Rusztowanie elewacyjne — komplet z pomostami i barierkami",
            },
            {
              slot: "construction-gallery-4",
              alt: "Robotnicy wylewają beton wężem pompy przy ścianie budynku",
              caption: "Pompa do betonu z obsługą operatora",
            },
            {
              slot: "construction-gallery-2",
              alt: "Żółty walec drogowy zagęszcza świeżo wylany asfalt",
              caption: "Walec i zagęszczarki na drogi dojazdowe",
            },
            {
              slot: "construction-gallery-5",
              alt: "Czerwony podnośnik koszowy z platformą roboczą",
              caption: "Podnośnik koszowy — prace na wysokości do 12 m",
            },
            {
              slot: "construction-gallery-3",
              alt: "Agregat prądotwórczy na kółkach stojący na placu",
              caption: "Agregaty prądotwórcze na budowy bez zasilania",
            },
            {
              slot: "construction-delivery",
              alt: "Załadunek sprzętu na lawetę",
              caption: "Transport pod adres inwestycji",
            },
          ],
        },
      },
      {
        type: "delivery",
        background: "default",
        content: {
          layout: "cards",
          heading: "Transport i odbiór",
          intro:
            "Dowozimy sprzęt na plac budowy w umówionym oknie czasowym i odbieramy go po zakończeniu najmu — Twoi ludzie nie tracą dnia na dojazdy do wypożyczalni.",
          items: [
            {
              title: "Odbiór własny z magazynu",
              text: "Bezpłatnie, w godzinach pracy magazynu, po wcześniejszym potwierdzeniu terminu.",
              price_grosze: 0,
            },
            {
              title: "Dostawa do 30 km",
              text: "Realizacja w kolejnym dniu roboczym po potwierdzeniu rezerwacji.",
              price_grosze: 15000,
            },
            {
              title: "Dostawa powyżej 30 km",
              text: "Wyceniamy trasę przy potwierdzeniu rezerwacji. Sprzęt wielkogabarytowy wozimy lawetą.",
              price_grosze: 29000,
            },
          ],
        },
      },
      {
        type: "pricing",
        background: "muted",
        content: {
          layout: "table",
          heading: "Stawki i kaucje",
          showCatalogLink: true,
          footnote:
            "Rozliczamy dobę roboczą. Przy najmie od siedmiu dni stawka spada o 20%. Kaucję zwracamy po przeglądzie zwróconego sprzętu.",
          items: [
            { name: "Zagęszczarka płytowa 90 kg", price_grosze: 12000, unit: "day", mode: "exact" },
            { name: "Młot wyburzeniowy 30 kg", price_grosze: 9000, unit: "day", mode: "exact" },
            {
              name: "Rusztowanie elewacyjne",
              price_grosze: 1800,
              unit: "day",
              mode: "from",
              note: "Cena za metr kwadratowy postawionego rusztowania",
            },
            {
              name: "Agregat prądotwórczy 6 kW",
              price_grosze: 14000,
              unit: "day",
              mode: "exact",
              note: "Paliwo po stronie najemcy",
            },
            {
              name: "Podnośnik koszowy 12 m",
              price_grosze: 45000,
              unit: "day",
              mode: "from",
              note: "Z dowozem i instruktażem na miejscu",
            },
          ],
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          layout: "banner",
          variant: "accent",
          heading: "Potrzebujesz sprzętu na jutro rano?",
          text: "Sprawdź dostępność w kalendarzu i zarezerwuj online — potwierdzenie przyjdzie od razu na maila.",
          items: [
            { label: "Zarezerwuj sprzęt", href: "#produkty" },
            { label: "Zobacz cały katalog", href: PRICING_CATALOG_HREF },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Twoja Firma",
          address: "ul. Betonowa 21, 40-001 Katowice",
          phone: "+48 500 600 700",
          email: "kontakt@twojafirma.pl",
          hours: "Pon–Pt 6:00–18:00, Sob 7:00–13:00",
          /*
           * ODNOŚNIK STOPKI CELUJE W SEKCJĘ, KTÓRA W TYM SKŁADZIE JEST.
           *
           * Do chwili, w której sekcje dostały `id`, ten odnośnik prowadził na
           * `#kontakt` — a ten szablon sekcji kontaktu NIE MA (skład: hero,
           * atuty, sprzęt, galeria, dostawa, cennik, wezwanie, stopka) i mieć
           * jej nie będzie, bo skład jest zamkniętą decyzją designową E9. Póki
           * kotwic nie było, nie robiło to różnicy: nie działał ŻADEN odnośnik
           * kotwiczny. Odkąd działają, ten byłby jedynym martwym na stronie.
           *
           * Celem jest pasmo wezwania (`#rezerwacja`) — jedyne miejsce na tej
           * stronie, w którym odwiedzający może się do najemcy odezwać, i pasmo
           * stojące bezpośrednio NAD stopką, więc skok jest widoczny jako ruch.
           *
           * Kotwica własnej stopki (`#stopka`) jest odrzucona POMIAREM, a nie
           * argumentem: ten odnośnik stoi na DOLE strony, a żądana pozycja celu
           * (górna krawędź stopki minus odstęp) wypada wtedy ZA końcem
           * dokumentu, więc przeglądarka ją przycina i nie przewija. Zmierzone
           * w oknie 813 px: koniec dokumentu 4143 px, `#stopka` żąda 4420 px
           * (przycięte) i daje przesunięcie 1 px, a cel zostaje 341 px pod
           * krawędzią okna; `#rezerwacja` żąda 4015 px (mieści się), daje −127 px
           * i stawia cel na 64 px. Innymi słowy `#stopka` odtwarzałaby objaw,
           * który to zadanie usuwa: klik, po którym nic się nie dzieje.
           *
           * Etykieta zostaje bez zmian ŚWIADOMIE: treść szablonów należy do
           * pasa E9, a rozjazd „Kontakt → pasmo rezerwacji" jest widoczny i
           * zapisany, a nie przemycony. Docelowa naprawa to sekcja kontaktu
           * w składzie i wtedy ten adres wraca na `#kontakt`.
           */
          links: [
            { label: "Regulamin", href: "/regulamin" },
            { label: "Polityka prywatności", href: "/prywatnosc" },
            { label: "Kontakt", href: "#rezerwacja" },
          ],
          legal: "© Twoja Firma. Wszelkie prawa zastrzeżone.",
        },
      },
    ],
    en: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Construction gear by the day, the week or the whole phase",
          subheading:
            "Compactors, breakers, scaffolding and generators — checked before every handover, delivered to your site.",
          ctaText: "Check availability",
          ctaHref: "#produkty",
        },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          layout: "cards",
          heading: "Why contractors keep coming back",
          items: [
            {
              icon: "truck",
              title: "Delivery to your site",
              text: "We bring the gear to the address of your project and collect it once the work is done.",
            },
            {
              icon: "wrench",
              title: "Serviced after every rental",
              text: "Every machine goes back to the workshop before it goes out to the next customer.",
            },
            {
              icon: "credit-card",
              title: "VAT invoice and monthly billing",
              text: "Regular contractors get a single consolidated invoice at the end of the month.",
            },
            {
              icon: "calendar-check",
              title: "Book ahead",
              text: "Reserve a machine for a specific phase of the works, even weeks in advance.",
            },
          ],
        },
      },
      {
        type: "products",
        background: "default",
        content: { layout: "grid", heading: "Equipment for hire", source: "catalog", items: [], limit: 8, featureFields: [] },
      },
      {
        type: "gallery",
        background: "muted",
        content: {
          layout: "masonry",
          heading: "Our gear on site",
          columns: 3,
          gap: "regular",
          lightbox: true,
          items: [
            {
              slot: "construction-gallery-1",
              alt: "Scaffolding erected across the full height of a concrete building",
              caption: "Facade scaffolding — decks and guardrails included",
            },
            {
              slot: "construction-gallery-4",
              alt: "Workers placing concrete through a pump hose next to a wall",
              caption: "Concrete pump with an operator",
            },
            {
              slot: "construction-gallery-2",
              alt: "A yellow road roller compacting freshly laid asphalt",
              caption: "Rollers and compactors for access roads",
            },
            {
              slot: "construction-gallery-5",
              alt: "A red boom lift with a work platform basket",
              caption: "Boom lift — work at heights up to 12 m",
            },
            {
              slot: "construction-gallery-3",
              alt: "A wheeled portable generator standing on a site",
              caption: "Generators for sites without mains power",
            },
            {
              slot: "construction-delivery",
              alt: "Equipment loaded onto a flatbed truck",
              caption: "Transport to the address of your project",
            },
          ],
        },
      },
      {
        type: "delivery",
        background: "default",
        content: {
          layout: "cards",
          heading: "Delivery and collection",
          intro:
            "We deliver to the site within an agreed time window and collect once the rental ends — your crew does not lose a day driving to the depot.",
          items: [
            {
              title: "Self pickup from the depot",
              text: "Free of charge during depot hours, once the slot has been confirmed.",
              price_grosze: 0,
            },
            {
              title: "Delivery up to 30 km",
              text: "Next working day after the booking has been confirmed.",
              price_grosze: 15000,
            },
            {
              title: "Delivery beyond 30 km",
              text: "We price the route when confirming the booking. Oversized machines travel on a flatbed.",
              price_grosze: 29000,
            },
          ],
        },
      },
      {
        type: "pricing",
        background: "muted",
        content: {
          layout: "table",
          heading: "Rates and deposits",
          showCatalogLink: true,
          footnote:
            "We charge per working day. From seven days the rate drops by 20%. The deposit is refunded after we inspect the returned gear.",
          items: [
            { name: "Plate compactor 90 kg", price_grosze: 12000, unit: "day", mode: "exact" },
            { name: "Demolition breaker 30 kg", price_grosze: 9000, unit: "day", mode: "exact" },
            {
              name: "Facade scaffolding",
              price_grosze: 1800,
              unit: "day",
              mode: "from",
              note: "Price per square metre of erected scaffolding",
            },
            {
              name: "Generator 6 kW",
              price_grosze: 14000,
              unit: "day",
              mode: "exact",
              note: "Fuel is on the hirer",
            },
            {
              name: "Boom lift 12 m",
              price_grosze: 45000,
              unit: "day",
              mode: "from",
              note: "Delivered, with an on-site briefing",
            },
          ],
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          layout: "banner",
          variant: "accent",
          heading: "Need the gear on site tomorrow morning?",
          text: "Check the calendar and book online — the confirmation lands in your inbox straight away.",
          items: [
            { label: "Book equipment", href: "#produkty" },
            { label: "Browse the full catalog", href: PRICING_CATALOG_HREF },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Your Company",
          address: "21 Betonowa St, 40-001 Katowice",
          phone: "+48 500 600 700",
          email: "hello@yourcompany.com",
          hours: "Mon–Fri 6:00–18:00, Sat 7:00–13:00",
          /* Cel jak w wersji polskiej tego szablonu — uzasadnienie tam. */
          links: [
            { label: "Terms", href: "/regulamin" },
            { label: "Privacy policy", href: "/prywatnosc" },
            { label: "Contact", href: "#rezerwacja" },
          ],
          legal: "© Your Company. All rights reserved.",
        },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Rowery i sport — sprzedaje sezon i zaufanie; stąd opinie i dojazd.
  // ---------------------------------------------------------------------
  "bike-sport": {
    pl: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Rowery i sprzęt sportowy na każdy weekend",
          subheading:
            "Rezerwujesz online, odbierasz gotowe do jazdy — kask, zapięcie i przegląd w cenie najmu.",
          ctaText: "Wybierz sprzęt",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "muted",
        content: { layout: "grid", heading: "Nasza flota", source: "catalog", items: [], limit: 8, featureFields: [] },
      },
      {
        type: "gallery",
        background: "default",
        content: {
          layout: "grid",
          heading: "Sprzęt i warsztat",
          columns: 3,
          gap: "regular",
          lightbox: true,
          items: [
            {
              slot: "bike-gallery-1",
              alt: "Rząd rowerów miejskich zaparkowanych obok siebie",
              caption: "Flota miejska — rowery gotowe do wydania",
            },
            {
              slot: "bike-gallery-4",
              alt: "Rowerzystka jedzie rowerem elektrycznym ulicą miasta",
              caption: "Rowery elektryczne z pełnym akumulatorem",
            },
            {
              slot: "bike-gallery-3",
              alt: "Dziecko jedzie rowerem leśną ścieżką",
              caption: "Rowery dziecięce i przyczepki",
            },
            {
              slot: "bike-gallery-2",
              alt: "Kask rowerowy leżący na drewnianej ławce",
              caption: "Kask i zapięcie w cenie najmu",
            },
            {
              slot: "bike-gallery-5",
              alt: "Mechanik centruje koło rowerowe kluczem w warsztacie",
              caption: "Przegląd przed każdym wydaniem",
            },
            {
              slot: "bike-location",
              alt: "Wnętrze serwisu rowerowego",
              caption: "Serwis i wydawanie sprzętu na miejscu",
            },
          ],
        },
      },
      {
        type: "pricing",
        background: "muted",
        content: {
          layout: "cards",
          heading: "Cennik najmu",
          showCatalogLink: true,
          footnote: "Kask i zapięcie dokładamy bez dopłaty. Kaucja 300 zł, zwracana przy oddaniu sprzętu.",
          items: [
            { name: "Rower miejski", price_grosze: 5000, unit: "day", mode: "exact" },
            {
              name: "Rower górski",
              price_grosze: 8000,
              unit: "day",
              mode: "exact",
              note: "Amortyzowany, z zestawem naprawczym",
            },
            {
              name: "Rower elektryczny",
              price_grosze: 14000,
              unit: "day",
              mode: "exact",
              note: "Zasięg do 80 km, ładowarka w komplecie",
            },
            {
              name: "Pakiet weekendowy",
              price_grosze: 12000,
              unit: "piece",
              mode: "from",
              note: "Piątek po południu — poniedziałek rano",
            },
          ],
        },
      },
      {
        type: "faq",
        background: "default",
        content: {
          layout: "accordion",
          heading: "Zanim wypożyczysz",
          allowMultiple: false,
          items: [
            {
              q: "Czy pobieracie kaucję?",
              a: "Tak, 300 zł od roweru. Zwracamy ją od razu przy oddaniu sprzętu, jeśli wraca w takim stanie, w jakim wyjechał.",
            },
            {
              q: "Co jest w cenie najmu?",
              a: "Kask, zapięcie i przegląd przed wydaniem. Do rowerów górskich dokładamy zestaw naprawczy z pompką.",
            },
            {
              q: "Czy mogę zarezerwować konkretny rozmiar ramy?",
              a: "Tak. Rozmiar wybierasz przy rezerwacji, a przy odbiorze ustawiamy siodełko i kierownicę pod Twój wzrost.",
            },
            {
              q: "Co, jeśli złapię gumę na trasie?",
              a: "Zadzwoń — podpowiemy najbliższy serwis albo podjedziemy z zapasowym rowerem. Czasu przestoju nie liczymy do najmu.",
            },
            {
              q: "Czy można oddać sprzęt poza godzinami pracy?",
              a: "Tak, po wcześniejszym ustaleniu. Zostawiasz rower w boksie przy wejściu i wrzucasz klucz do skrzynki.",
            },
          ],
        },
      },
      {
        type: "testimonials",
        background: "inverted",
        content: {
          layout: "carousel",
          heading: "Co mówią klienci",
          items: [
            {
              quote:
                "Wypożyczyliśmy cztery rowery na długi weekend. Wszystkie po przeglądzie, kaski dopasowane na miejscu, zero czekania przy odbiorze.",
              author: "Michał W.",
              role: "Weekend nad jeziorem",
            },
            {
              quote:
                "Rower elektryczny wystarczył na cały dzień zwiedzania i jeszcze została połowa akumulatora. Ładowarkę dostaliśmy bez pytania.",
              author: "Ola i Piotr",
              role: "Wycieczka po okolicy",
            },
            {
              quote:
                "Złapałem gumę 20 km od miasta. Jeden telefon i po pół godziny miałem podstawiony inny rower. Tego dnia nie policzyli.",
              author: "Tomasz K.",
              role: "Trasa szutrowa",
            },
          ],
        },
      },
      {
        type: "directions",
        background: "default",
        content: {
          layout: "split",
          heading: "Jak do nas trafić",
          items: [
            {
              label: "Wypożyczalnia i serwis",
              address: "ul. Sportowa 8, 80-001 Gdańsk",
              hours: "Pon–Pt 9:00–19:00, Sob–Nd 8:00–16:00",
            },
            {
              label: "Punkt sezonowy przy plaży",
              address: "al. Nadmorska 2, 80-002 Gdańsk",
              hours: "Czerwiec–wrzesień, codziennie 9:00–20:00",
            },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Twoja Wypożyczalnia",
          address: "ul. Sportowa 8, 80-001 Gdańsk",
          phone: "+48 500 600 700",
          email: "kontakt@twojawypozyczalnia.pl",
          hours: "Pon–Pt 9:00–19:00, Sob–Nd 8:00–16:00",
          links: [
            { label: "Regulamin", href: "/regulamin" },
            { label: "Polityka prywatności", href: "/prywatnosc" },
            { label: "Dojazd", href: MAPS_URL },
          ],
          legal: "© Twoja Wypożyczalnia. Wszelkie prawa zastrzeżone.",
        },
      },
    ],
    en: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Bikes and sports gear for every weekend",
          subheading:
            "Book online, pick up ready to ride — helmet, lock and a safety check included in the rate.",
          ctaText: "Choose your gear",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "muted",
        content: { layout: "grid", heading: "Our fleet", source: "catalog", items: [], limit: 8, featureFields: [] },
      },
      {
        type: "gallery",
        background: "default",
        content: {
          layout: "grid",
          heading: "The fleet and the workshop",
          columns: 3,
          gap: "regular",
          lightbox: true,
          items: [
            {
              slot: "bike-gallery-1",
              alt: "A row of city bikes parked next to each other",
              caption: "City fleet — bikes ready to hand over",
            },
            {
              slot: "bike-gallery-4",
              alt: "A woman riding an electric bike along a city street",
              caption: "Electric bikes with a full battery",
            },
            {
              slot: "bike-gallery-3",
              alt: "A child riding a bicycle along a woodland path",
              caption: "Children's bikes and trailers",
            },
            {
              slot: "bike-gallery-2",
              alt: "A cycling helmet resting on a wooden bench",
              caption: "Helmet and lock included in the rate",
            },
            {
              slot: "bike-gallery-5",
              alt: "A mechanic truing a bicycle wheel with a spoke wrench",
              caption: "A safety check before every handover",
            },
            {
              slot: "bike-location",
              alt: "Inside the bike workshop",
              caption: "Workshop and handover on site",
            },
          ],
        },
      },
      {
        type: "pricing",
        background: "muted",
        content: {
          layout: "cards",
          heading: "Rental rates",
          showCatalogLink: true,
          footnote: "Helmet and lock at no extra charge. Deposit PLN 300, refunded when you return the bike.",
          items: [
            { name: "City bike", price_grosze: 5000, unit: "day", mode: "exact" },
            {
              name: "Mountain bike",
              price_grosze: 8000,
              unit: "day",
              mode: "exact",
              note: "Full suspension, repair kit included",
            },
            {
              name: "Electric bike",
              price_grosze: 14000,
              unit: "day",
              mode: "exact",
              note: "Range up to 80 km, charger included",
            },
            {
              name: "Weekend package",
              price_grosze: 12000,
              unit: "piece",
              mode: "from",
              note: "Friday afternoon to Monday morning",
            },
          ],
        },
      },
      {
        type: "faq",
        background: "default",
        content: {
          layout: "accordion",
          heading: "Before you book",
          allowMultiple: false,
          items: [
            {
              q: "Do you charge a deposit?",
              a: "Yes, PLN 300 per bike. We refund it the moment you return the bike in the condition it went out in.",
            },
            {
              q: "What is included in the rate?",
              a: "A helmet, a lock and a safety check before handover. Mountain bikes also come with a repair kit and a pump.",
            },
            {
              q: "Can I reserve a specific frame size?",
              a: "Yes. You pick the size when booking, and we set the saddle and bars to your height at pickup.",
            },
            {
              q: "What if I get a puncture on the trail?",
              a: "Call us — we will point you to the nearest workshop or bring a replacement bike. Downtime is not charged.",
            },
            {
              q: "Can I return the bike outside opening hours?",
              a: "Yes, if arranged in advance. You leave the bike in the bay by the entrance and drop the key in the box.",
            },
          ],
        },
      },
      {
        type: "testimonials",
        background: "inverted",
        content: {
          layout: "carousel",
          heading: "What customers say",
          items: [
            {
              quote:
                "We hired four bikes for a long weekend. All of them serviced, helmets fitted on the spot, no waiting at pickup.",
              author: "Michał W.",
              role: "Weekend by the lake",
            },
            {
              quote:
                "The electric bike lasted a full day of sightseeing with half the battery left. The charger came without us asking.",
              author: "Ola and Piotr",
              role: "Day trip around the area",
            },
            {
              quote:
                "I got a puncture 20 km out of town. One call and half an hour later a replacement bike arrived. They did not charge for that day.",
              author: "Tomasz K.",
              role: "Gravel route",
            },
          ],
        },
      },
      {
        type: "directions",
        background: "default",
        content: {
          layout: "split",
          heading: "How to find us",
          items: [
            {
              label: "Rental and workshop",
              address: "8 Sportowa St, 80-001 Gdansk",
              hours: "Mon–Fri 9:00–19:00, Sat–Sun 8:00–16:00",
            },
            {
              label: "Seasonal point by the beach",
              address: "2 Nadmorska Ave, 80-002 Gdansk",
              hours: "June–September, daily 9:00–20:00",
            },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Your Rental",
          address: "8 Sportowa St, 80-001 Gdansk",
          phone: "+48 500 600 700",
          email: "hello@yourrental.com",
          hours: "Mon–Fri 9:00–19:00, Sat–Sun 8:00–16:00",
          links: [
            { label: "Terms", href: "/regulamin" },
            { label: "Privacy policy", href: "/prywatnosc" },
            { label: "Directions", href: MAPS_URL },
          ],
          legal: "© Your Rental. All rights reserved.",
        },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Eventy — sprzedaje realizacje i spokój organizatora; stąd galeria i kontakt.
  // ---------------------------------------------------------------------
  "event-party": {
    pl: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Wesela, urodziny, firmowe imprezy — sprzęt na cały dzień",
          subheading:
            "Namioty, stoły, nagłośnienie i oświetlenie. Przywozimy, stawiamy i zabieramy — Ty zajmujesz się gośćmi.",
          ctaText: "Zapytaj o termin",
          ctaHref: "#kontakt",
        },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          layout: "plain",
          heading: "Jak z nami pracujesz",
          items: [
            {
              icon: "calendar-check",
              title: "Termin blokujemy od ręki",
              text: "Po rozmowie wysyłamy wycenę tego samego dnia i rezerwujemy datę na siedem dni.",
            },
            {
              icon: "package",
              title: "Montaż i demontaż w cenie",
              text: "Przyjeżdżamy dzień wcześniej, stawiamy komplet i wracamy po sprzęt po imprezie.",
            },
            {
              icon: "headphones",
              title: "Obsługa techniczna na miejscu",
              text: "Przy nagłośnieniu i oświetleniu zostaje z Wami technik — od pierwszego toastu do ostatniego kawałka.",
            },
          ],
        },
      },
      {
        type: "gallery",
        background: "default",
        content: {
          layout: "grid",
          heading: "Nasze realizacje",
          columns: 4,
          gap: "tight",
          lightbox: true,
          items: [
            {
              slot: "event-gallery-4",
              alt: "Rozświetlony namiot weselny na trawie po zmroku",
              caption: "Wesele w plenerze — namiot i oświetlenie",
            },
            {
              slot: "event-gallery-1",
              alt: "Nakryty stół na przyjęciu weselnym w namiocie",
              caption: "Wesele na 120 osób — stoły i nakrycia",
            },
            {
              slot: "event-gallery-7",
              alt: "Okrągły stół z białymi pokrowcami na krzesłach i złotą zastawą",
              caption: "Sala bankietowa — pokrowce i zastawa",
            },
            {
              slot: "event-gallery-2",
              alt: "Parkiet taneczny z oświetleniem pod namiotem",
              caption: "Parkiet i oświetlenie sceniczne",
            },
            {
              slot: "event-gallery-6",
              alt: "Reflektory sceniczne nad sceną w trakcie koncertu",
              caption: "Nagłośnienie i światło pod scenę",
            },
            {
              slot: "event-gallery-5",
              alt: "Bufet z przekąskami rozstawiony na stole cateringowym",
              caption: "Stoły bufetowe i podgrzewacze",
            },
            {
              slot: "event-gallery-3",
              alt: "Rzędy krzeseł ustawione na ceremonię w plenerze",
              caption: "Ceremonia w plenerze — krzesła i nagłośnienie",
            },
            {
              slot: "event-gallery-8",
              alt: "Ogrodowe przyjęcie pod białymi zadaszeniami z okrągłymi stołami",
              caption: "Przyjęcie w ogrodzie — zadaszenia i stoły",
            },
          ],
        },
      },
      {
        type: "delivery",
        background: "muted",
        content: {
          layout: "list",
          heading: "Dowóz, montaż, odbiór",
          intro:
            "Sprzęt eventowy wozimy sami — kompletem, w jednym kursie, w oknie ustalonym przy potwierdzeniu terminu.",
          items: [
            {
              title: "Dowóz i montaż w mieście",
              text: "Przyjeżdżamy dzień przed imprezą, stawiamy namiot i rozstawiamy sprzęt.",
              price_grosze: 40000,
            },
            {
              title: "Dowóz poza miasto",
              text: "Do 60 km od magazynu. Dalsze trasy wyceniamy przy potwierdzeniu terminu.",
              price_grosze: 70000,
            },
            {
              title: "Odbiór po imprezie",
              text: "Wracamy następnego dnia rano. Nie musicie nic składać ani pakować.",
              price_grosze: 0,
            },
          ],
        },
      },
      {
        type: "testimonials",
        background: "inverted",
        content: {
          layout: "grid",
          heading: "Opinie organizatorów",
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
              role: "Piknik rodzinny",
            },
          ],
        },
      },
      {
        type: "contact",
        background: "default",
        content: {
          layout: "split",
          heading: "Zapytaj o swój termin",
          showForm: true,
          askPhone: true,
          privacyHref: "/prywatnosc",
          items: [
            { kind: "phone", value: "+48 500 600 700" },
            { kind: "email", value: "eventy@twojafirma.pl" },
            { kind: "address", value: "ul. Weselna 3, 61-001 Poznań" },
            { kind: "hours", value: "Pon–Pt 9:00–17:00, Sob 10:00–14:00" },
          ],
        },
      },
      {
        type: "cta",
        background: "default",
        content: {
          layout: "split",
          variant: "accent",
          heading: "Data jest zajęta szybciej, niż myślisz",
          text: "Sezon weselny rezerwuje się z półrocznym wyprzedzeniem. Napisz, sprawdzimy dostępność na Twój termin.",
          items: [
            { label: "Napisz do nas", href: "#kontakt" },
            { label: "Zobacz sprzęt", href: PRICING_CATALOG_HREF },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Twoja Firma Eventowa",
          address: "ul. Weselna 3, 61-001 Poznań",
          phone: "+48 500 600 700",
          email: "eventy@twojafirma.pl",
          hours: "Pon–Pt 9:00–17:00, Sob 10:00–14:00",
          links: [
            { label: "Regulamin", href: "/regulamin" },
            { label: "Polityka prywatności", href: "/prywatnosc" },
            { label: "Kontakt", href: "#kontakt" },
          ],
          legal: "© Twoja Firma Eventowa. Wszelkie prawa zastrzeżone.",
        },
      },
    ],
    en: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Weddings, birthdays, company parties — gear for the whole day",
          subheading:
            "Marquees, tables, sound and lighting. We deliver, set up and collect — you look after the guests.",
          ctaText: "Ask about your date",
          ctaHref: "#kontakt",
        },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          layout: "plain",
          heading: "How working with us looks",
          items: [
            {
              icon: "calendar-check",
              title: "We hold your date right away",
              text: "After the call we send a quote the same day and hold the date for seven days.",
            },
            {
              icon: "package",
              title: "Set-up and take-down included",
              text: "We arrive the day before, put everything up and come back for the gear after the party.",
            },
            {
              icon: "headphones",
              title: "A technician stays on site",
              text: "With sound and lighting a technician stays with you — from the first toast to the last track.",
            },
          ],
        },
      },
      {
        type: "gallery",
        background: "default",
        content: {
          layout: "grid",
          heading: "Our work",
          columns: 4,
          gap: "tight",
          lightbox: true,
          items: [
            {
              slot: "event-gallery-4",
              alt: "A lit wedding marquee on a lawn after dark",
              caption: "Outdoor wedding — marquee and lighting",
            },
            {
              slot: "event-gallery-1",
              alt: "Banquet table set for a wedding reception in a marquee",
              caption: "Wedding for 120 — tables and place settings",
            },
            {
              slot: "event-gallery-7",
              alt: "A round table with white chair covers and gold place settings",
              caption: "Banquet hall — chair covers and tableware",
            },
            {
              slot: "event-gallery-2",
              alt: "Dance floor with stage lighting under a marquee",
              caption: "Dance floor and stage lighting",
            },
            {
              slot: "event-gallery-6",
              alt: "Stage spotlights above a stage during a concert",
              caption: "Sound and light for the stage",
            },
            {
              slot: "event-gallery-5",
              alt: "A buffet of snacks laid out on a catering table",
              caption: "Buffet tables and chafing dishes",
            },
            {
              slot: "event-gallery-3",
              alt: "Rows of chairs set up for an outdoor ceremony",
              caption: "Outdoor ceremony — chairs and sound system",
            },
            {
              slot: "event-gallery-8",
              alt: "A garden party under white canopies with round tables",
              caption: "Garden party — canopies and tables",
            },
          ],
        },
      },
      {
        type: "delivery",
        background: "muted",
        content: {
          layout: "list",
          heading: "Delivery, set-up, collection",
          intro:
            "We move event gear ourselves — as one load, in one run, within the window agreed when the date is confirmed.",
          items: [
            {
              title: "Delivery and set-up in town",
              text: "We arrive the day before the party, raise the marquee and set the gear out.",
              price_grosze: 40000,
            },
            {
              title: "Delivery out of town",
              text: "Up to 60 km from the depot. Longer routes are priced when the date is confirmed.",
              price_grosze: 70000,
            },
            {
              title: "Collection after the party",
              text: "We come back the next morning. Nothing to fold, nothing to pack.",
              price_grosze: 0,
            },
          ],
        },
      },
      {
        type: "testimonials",
        background: "inverted",
        content: {
          layout: "grid",
          heading: "What organisers say",
          items: [
            {
              quote:
                "The marquee went up a day early and the crew stayed until everything was in place. On the wedding day we did not think about the gear once.",
              author: "Anna and Marek",
              role: "Outdoor wedding, 120 guests",
            },
            {
              quote:
                "We have hired from them for every company event for three years. The sound system always works and the invoice arrives without chasing.",
              author: "Katarzyna Nowak",
              role: "Office management",
            },
            {
              quote:
                "We needed tables and chairs overnight. We had a confirmation within the hour and transport the next morning.",
              author: "Bukowina Community Centre",
              role: "Family picnic",
            },
          ],
        },
      },
      {
        type: "contact",
        background: "default",
        content: {
          layout: "split",
          heading: "Ask about your date",
          showForm: true,
          askPhone: true,
          privacyHref: "/prywatnosc",
          items: [
            { kind: "phone", value: "+48 500 600 700" },
            { kind: "email", value: "events@yourcompany.com" },
            { kind: "address", value: "3 Weselna St, 61-001 Poznan" },
            { kind: "hours", value: "Mon–Fri 9:00–17:00, Sat 10:00–14:00" },
          ],
        },
      },
      {
        type: "cta",
        background: "default",
        content: {
          layout: "split",
          variant: "accent",
          heading: "Dates go faster than you think",
          text: "The wedding season books six months ahead. Write to us and we will check availability for your date.",
          items: [
            { label: "Write to us", href: "#kontakt" },
            { label: "See the gear", href: PRICING_CATALOG_HREF },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Your Event Company",
          address: "3 Weselna St, 61-001 Poznan",
          phone: "+48 500 600 700",
          email: "events@yourcompany.com",
          hours: "Mon–Fri 9:00–17:00, Sat 10:00–14:00",
          links: [
            { label: "Terms", href: "/regulamin" },
            { label: "Privacy policy", href: "/prywatnosc" },
            { label: "Contact", href: "#kontakt" },
          ],
          legal: "© Your Event Company. All rights reserved.",
        },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Foto i wideo — sprzedaje sprzęt i zaufanie do stanu technicznego.
  // ---------------------------------------------------------------------
  "photo-video": {
    pl: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Sprzęt filmowy i fotograficzny na zdjęcia, których nie da się powtórzyć",
          subheading:
            "Kamery, optyka, światło i stabilizacja — skonfigurowane i sprawdzone przed każdym wydaniem.",
          ctaText: "Zobacz sprzęt",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "default",
        content: { layout: "list", heading: "Sprzęt w wypożyczalni", source: "catalog", items: [], limit: 8, featureFields: [] },
      },
      {
        type: "gallery",
        background: "muted",
        content: {
          layout: "carousel",
          heading: "Z naszych planów",
          columns: 3,
          gap: "roomy",
          lightbox: true,
          items: [
            {
              slot: "photo-gallery-3",
              alt: "Ekipa filmowa na planie oświetlonym niebieskim światłem",
              caption: "Komplet oświetlenia planu z obsługą",
            },
            {
              slot: "photo-gallery-1",
              alt: "Profesjonalna kamera wideo ustawiona na statywie",
              caption: "Kamery kinowe z pełnym rigiem",
            },
            {
              slot: "photo-gallery-2",
              alt: "Sześć obiektywów fotograficznych ustawionych w rzędzie na blacie",
              caption: "Optyka stałoogniskowa i zoomy",
            },
            {
              slot: "photo-gallery-4",
              alt: "Operator trzyma kamerę na gimbalu w niebieskim świetle",
              caption: "Gimbale i stabilizacja ruchu",
            },
            {
              slot: "photo-studio",
              alt: "Sprzęt oświetleniowy w studiu",
              caption: "Lampy studyjne, softboxy i statywy",
            },
            {
              slot: "photo-gallery-5",
              alt: "Studio fotograficzne z tłem bez szwu i lampą na statywie",
              caption: "Tła bez szwu i zestawy studyjne",
            },
          ],
        },
      },
      {
        type: "pricing",
        background: "default",
        content: {
          layout: "cards",
          heading: "Stawki dobowe",
          showCatalogLink: true,
          footnote:
            "Doba to 24 godziny od odbioru. Weekend (piątek–poniedziałek) liczymy jak dwie doby. Kaucja ustalana per zestaw.",
          items: [
            {
              name: "Kamera kinowa z rigiem",
              price_grosze: 65000,
              unit: "day",
              mode: "from",
              note: "Z monitorem podglądowym i kompletem akumulatorów",
            },
            {
              name: "Obiektyw stałoogniskowy",
              price_grosze: 12000,
              unit: "day",
              mode: "exact",
              note: "Cena za jedną ogniskową z zestawu",
            },
            {
              name: "Zestaw oświetleniowy 3-punktowy",
              price_grosze: 38000,
              unit: "day",
              mode: "exact",
            },
            {
              name: "Gimbal z obsługą operatora",
              price_grosze: 90000,
              unit: "day",
              mode: "from",
              note: "Minimum 4 godziny pracy operatora",
            },
          ],
        },
      },
      {
        type: "faq",
        background: "muted",
        content: {
          layout: "open-list",
          heading: "Najczęstsze pytania",
          allowMultiple: true,
          items: [
            {
              q: "Czy sprawdzacie sprzęt przed wydaniem?",
              a: "Tak. Każdy zestaw przechodzi test nagraniowy i kontrolę optyki. Protokół wydania podpisujemy razem, przy sprzęcie.",
            },
            {
              q: "Co z ubezpieczeniem?",
              a: "Sprzęt jest ubezpieczony od uszkodzeń na planie. Kradzież i zalanie wymagają osobnej polisy — pomożemy ją dobrać.",
            },
            {
              q: "Czy mogę odebrać sprzęt wieczorem przed zdjęciami?",
              a: "Tak, po wcześniejszym ustaleniu. Odbiór po 18:00 nie liczy się do doby, jeśli zwrot następuje dzień później do 18:00.",
            },
            {
              q: "Czy dowozicie sprzęt na plan?",
              a: "Tak, na terenie miasta i do 100 km. Przy większych zestawach dokładamy technika, który pomaga rozstawić i spakować.",
            },
          ],
        },
      },
      {
        type: "contact",
        background: "inverted",
        content: {
          layout: "split",
          heading: "Skonsultuj zestaw",
          showForm: true,
          askPhone: true,
          privacyHref: "/prywatnosc",
          items: [
            { kind: "phone", value: "+48 500 600 700" },
            { kind: "email", value: "studio@twojafirma.pl" },
            { kind: "address", value: "ul. Filmowa 12, 00-001 Warszawa" },
            { kind: "hours", value: "Pon–Pt 9:00–18:00, Sob po ustaleniu" },
          ],
        },
      },
      {
        type: "cta",
        background: "default",
        content: {
          layout: "banner",
          variant: "panel",
          heading: "Masz zdjęcia w przyszłym tygodniu?",
          text: "Napisz, jaki masz plan zdjęciowy — dobierzemy zestaw i zarezerwujemy go na Twój termin.",
          items: [
            { label: "Zapytaj o zestaw", href: "#kontakt" },
            { label: "Przeglądaj katalog", href: PRICING_CATALOG_HREF },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Twoje Studio",
          address: "ul. Filmowa 12, 00-001 Warszawa",
          phone: "+48 500 600 700",
          email: "studio@twojafirma.pl",
          hours: "Pon–Pt 9:00–18:00",
          links: [
            { label: "Regulamin", href: "/regulamin" },
            { label: "Polityka prywatności", href: "/prywatnosc" },
            { label: "Kontakt", href: "#kontakt" },
          ],
          legal: "© Twoje Studio. Wszelkie prawa zastrzeżone.",
        },
      },
    ],
    en: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Film and photo gear for shots you cannot take twice",
          subheading:
            "Cameras, glass, lighting and stabilisation — configured and tested before every handover.",
          ctaText: "See the gear",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "default",
        content: { layout: "list", heading: "In the rental house", source: "catalog", items: [], limit: 8, featureFields: [] },
      },
      {
        type: "gallery",
        background: "muted",
        content: {
          layout: "carousel",
          heading: "From our sets",
          columns: 3,
          gap: "roomy",
          lightbox: true,
          items: [
            {
              slot: "photo-gallery-3",
              alt: "A film crew on a set lit in blue light",
              caption: "A full lighting package with a crew",
            },
            {
              slot: "photo-gallery-1",
              alt: "A professional video camera mounted on a tripod",
              caption: "Cinema cameras with a full rig",
            },
            {
              slot: "photo-gallery-2",
              alt: "Six camera lenses lined up on a wooden surface",
              caption: "Prime lenses and zooms",
            },
            {
              slot: "photo-gallery-4",
              alt: "An operator holding a camera on a gimbal in blue light",
              caption: "Gimbals and motion stabilisation",
            },
            {
              slot: "photo-studio",
              alt: "Lighting gear in the studio",
              caption: "Studio heads, softboxes and stands",
            },
            {
              slot: "photo-gallery-5",
              alt: "A photo studio with a seamless backdrop and a light on a stand",
              caption: "Seamless backdrops and studio kits",
            },
          ],
        },
      },
      {
        type: "pricing",
        background: "default",
        content: {
          layout: "cards",
          heading: "Daily rates",
          showCatalogLink: true,
          footnote:
            "A day is 24 hours from pickup. A weekend (Friday to Monday) counts as two days. Deposit is set per package.",
          items: [
            {
              name: "Cinema camera with a rig",
              price_grosze: 65000,
              unit: "day",
              mode: "from",
              note: "With a monitor and a full set of batteries",
            },
            {
              name: "Prime lens",
              price_grosze: 12000,
              unit: "day",
              mode: "exact",
              note: "Price per focal length from the set",
            },
            {
              name: "Three-point lighting kit",
              price_grosze: 38000,
              unit: "day",
              mode: "exact",
            },
            {
              name: "Gimbal with an operator",
              price_grosze: 90000,
              unit: "day",
              mode: "from",
              note: "Minimum four hours of operator time",
            },
          ],
        },
      },
      {
        type: "faq",
        background: "muted",
        content: {
          layout: "open-list",
          heading: "Frequently asked questions",
          allowMultiple: true,
          items: [
            {
              q: "Do you test the gear before handover?",
              a: "Yes. Every package goes through a recording test and an optics check. We sign the handover protocol together, with the gear in front of us.",
            },
            {
              q: "What about insurance?",
              a: "The gear is insured against damage on set. Theft and water damage need a separate policy — we will help you pick one.",
            },
            {
              q: "Can I collect the gear the evening before the shoot?",
              a: "Yes, if arranged in advance. Pickup after 18:00 does not count towards the day if you return by 18:00 the next day.",
            },
            {
              q: "Do you deliver to set?",
              a: "Yes, in town and up to 100 km out. With larger packages we send a technician who helps set up and pack down.",
            },
          ],
        },
      },
      {
        type: "contact",
        background: "inverted",
        content: {
          layout: "split",
          heading: "Talk through your package",
          showForm: true,
          askPhone: true,
          privacyHref: "/prywatnosc",
          items: [
            { kind: "phone", value: "+48 500 600 700" },
            { kind: "email", value: "studio@yourcompany.com" },
            { kind: "address", value: "12 Filmowa St, 00-001 Warsaw" },
            { kind: "hours", value: "Mon–Fri 9:00–18:00, Sat by arrangement" },
          ],
        },
      },
      {
        type: "cta",
        background: "default",
        content: {
          layout: "banner",
          variant: "panel",
          heading: "Shooting next week?",
          text: "Tell us about the shoot — we will put a package together and hold it for your dates.",
          items: [
            { label: "Ask about a package", href: "#kontakt" },
            { label: "Browse the catalog", href: PRICING_CATALOG_HREF },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Your Studio",
          address: "12 Filmowa St, 00-001 Warsaw",
          phone: "+48 500 600 700",
          email: "studio@yourcompany.com",
          hours: "Mon–Fri 9:00–18:00",
          links: [
            { label: "Terms", href: "/regulamin" },
            { label: "Privacy policy", href: "/prywatnosc" },
            { label: "Contact", href: "#kontakt" },
          ],
          legal: "© Your Studio. All rights reserved.",
        },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Jedna strona, krótko — dla tych, którzy chcą stronę na dziś, nie projekt.
  // ---------------------------------------------------------------------
  "one-page-lean": {
    pl: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Wypożyczalnia, która oddzwania",
          subheading:
            "Narzędzia i sprzęt na dobę albo na tydzień. Rezerwacja online, odbiór w warsztacie, wszystko na jednej stronie.",
          ctaText: "Zobacz, co mamy",
          ctaHref: "#produkty",
        },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          layout: "cards",
          heading: "Trzy rzeczy, na które możesz liczyć",
          items: [
            {
              icon: "clock",
              title: "Odpowiadamy tego samego dnia",
              text: "Rezerwację złożoną do 16:00 potwierdzamy jeszcze tego dnia — mailem albo telefonem.",
            },
            {
              icon: "badge-check",
              title: "Sprzęt sprawdzony przed wydaniem",
              text: "Każde narzędzie przechodzi przegląd po zwrocie i przed kolejnym najmem.",
            },
            {
              icon: "map-pin",
              title: "Odbiór w jednym miejscu",
              text: "Jeden warsztat, jedno wejście, parking pod drzwiami. Bez szukania magazynu na obrzeżach.",
            },
          ],
        },
      },
      {
        type: "products",
        background: "default",
        content: { layout: "grid", heading: "Sprzęt do wynajęcia", source: "catalog", items: [], limit: 8, featureFields: [] },
      },
      {
        type: "freeform",
        background: "muted",
        content: {
          heading: "O warsztacie",
          body: "Prowadzimy wypożyczalnię od dwunastu lat, w tym samym miejscu i z tym samym numerem telefonu. Znamy sprzęt, który wydajemy, bo sami go serwisujemy — a jeśli czegoś nie mamy, powiemy wprost, zamiast obiecywać termin, którego nie dotrzymamy.",
        },
      },
      {
        type: "contact",
        background: "default",
        content: {
          layout: "stacked",
          heading: "Kontakt",
          showForm: true,
          askPhone: false,
          privacyHref: "/prywatnosc",
          items: [
            { kind: "phone", value: "+48 500 600 700" },
            { kind: "email", value: "kontakt@twojafirma.pl" },
            { kind: "address", value: "ul. Warsztatowa 4, 30-001 Kraków" },
            { kind: "hours", value: "Pon–Pt 8:00–17:00, Sob 9:00–13:00" },
          ],
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          layout: "split",
          variant: "accent",
          heading: "Potrzebujesz czegoś na jutro?",
          text: "Napisz albo zadzwoń — sprawdzimy dostępność i odłożymy sprzęt na Twoje nazwisko.",
          items: [
            { label: "Zarezerwuj", href: "#kontakt" },
            { label: "Zobacz sprzęt", href: "#produkty" },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Twoja Firma",
          address: "ul. Warsztatowa 4, 30-001 Kraków",
          phone: "+48 500 600 700",
          email: "kontakt@twojafirma.pl",
          hours: "Pon–Pt 8:00–17:00, Sob 9:00–13:00",
          links: [
            { label: "Regulamin", href: "/regulamin" },
            { label: "Polityka prywatności", href: "/prywatnosc" },
          ],
          legal: "© Twoja Firma. Wszelkie prawa zastrzeżone.",
        },
      },
    ],
    en: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "A rental shop that calls you back",
          subheading:
            "Tools and equipment by the day or by the week. Book online, collect at the workshop, all on one page.",
          ctaText: "See what we have",
          ctaHref: "#produkty",
        },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          layout: "cards",
          heading: "Three things you can count on",
          items: [
            {
              icon: "clock",
              title: "We reply the same day",
              text: "A booking placed before 16:00 is confirmed the same day — by email or by phone.",
            },
            {
              icon: "badge-check",
              title: "Checked before handover",
              text: "Every tool is inspected after it comes back and before it goes out again.",
            },
            {
              icon: "map-pin",
              title: "One place to collect",
              text: "One workshop, one door, parking outside. No hunting for a depot on the ring road.",
            },
          ],
        },
      },
      {
        type: "products",
        background: "default",
        content: { layout: "grid", heading: "Equipment for hire", source: "catalog", items: [], limit: 8, featureFields: [] },
      },
      {
        type: "freeform",
        background: "muted",
        content: {
          heading: "About the workshop",
          body: "We have run this rental shop for twelve years, in the same place and on the same phone number. We know the gear we hand out because we service it ourselves — and if we do not have something, we say so instead of promising a date we cannot keep.",
        },
      },
      {
        type: "contact",
        background: "default",
        content: {
          layout: "stacked",
          heading: "Contact",
          showForm: true,
          askPhone: false,
          privacyHref: "/prywatnosc",
          items: [
            { kind: "phone", value: "+48 500 600 700" },
            { kind: "email", value: "hello@yourcompany.com" },
            { kind: "address", value: "4 Warsztatowa St, 30-001 Krakow" },
            { kind: "hours", value: "Mon–Fri 8:00–17:00, Sat 9:00–13:00" },
          ],
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          layout: "split",
          variant: "accent",
          heading: "Need something for tomorrow?",
          text: "Write or call — we will check availability and put the gear aside in your name.",
          items: [
            { label: "Book now", href: "#kontakt" },
            { label: "See the gear", href: "#produkty" },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Your Company",
          address: "4 Warsztatowa St, 30-001 Krakow",
          phone: "+48 500 600 700",
          email: "hello@yourcompany.com",
          hours: "Mon–Fri 8:00–17:00, Sat 9:00–13:00",
          links: [
            { label: "Terms", href: "/regulamin" },
            { label: "Privacy policy", href: "/prywatnosc" },
          ],
          legal: "© Your Company. All rights reserved.",
        },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Katalog na pierwszym planie — dla wypożyczalni z dużym, gotowym magazynem.
  // ---------------------------------------------------------------------
  "catalog-first": {
    pl: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Cały magazyn online, z terminami na żywo",
          subheading:
            "Sprawdzasz dostępność, wybierasz daty i rezerwujesz — bez telefonów i bez czekania na wycenę.",
          ctaText: "Przejdź do katalogu",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "muted",
        content: { layout: "grid", heading: "Katalog sprzętu", source: "catalog", items: [], limit: 8, featureFields: [] },
      },
      {
        type: "freeform",
        background: "default",
        content: {
          heading: "Jak działa rezerwacja",
          body: "1. WYBIERASZ — sprzęt i termin w katalogu; system od razu pokazuje, czy egzemplarz jest wolny.\n\n2. POTWIERDZAMY — mailem, razem z adresem odbioru i wysokością kaucji. Zwykle w kilka minut.\n\n3. ZMIENIASZ, JEŚLI TRZEBA — termin przesuniesz do 24 godzin przed odbiorem, bez dopłat i bez tłumaczeń.",
        },
      },
      {
        type: "pricing",
        background: "muted",
        content: {
          layout: "table",
          heading: "Cennik podstawowy",
          showCatalogLink: true,
          footnote:
            "Stawki dobowe dla najmu do trzech dni. Od czwartej doby liczymy 80% stawki, od siódmej — 70%.",
          items: [
            { name: "Narzędzia ręczne i elektronarzędzia", price_grosze: 3000, unit: "day", mode: "from" },
            { name: "Sprzęt ogrodowy", price_grosze: 6000, unit: "day", mode: "from" },
            {
              name: "Sprzęt czyszczący",
              price_grosze: 9000,
              unit: "day",
              mode: "from",
              note: "Środki chemiczne rozliczamy osobno",
            },
            { name: "Rusztowania i drabiny", price_grosze: 4000, unit: "day", mode: "from" },
            {
              name: "Przyczepy i transport",
              price_grosze: 12000,
              unit: "day",
              mode: "from",
              note: "Wymagane prawo jazdy kat. B i kaucja 500 zł",
            },
            {
              name: "Najem miesięczny",
              price_grosze: 90000,
              unit: "month",
              mode: "from",
              note: "Dla firm, z fakturą zbiorczą",
            },
          ],
        },
      },
      {
        type: "delivery",
        background: "default",
        content: {
          layout: "cards",
          heading: "Odbiór i dowóz",
          intro: "Sprzęt z katalogu odbierzesz sam albo przywieziemy go pod wskazany adres.",
          items: [
            {
              title: "Odbiór własny",
              text: "Magazyn przy obwodnicy, parking przy rampie, wydanie w kilka minut.",
              price_grosze: 0,
            },
            {
              title: "Dowóz w mieście",
              text: "Tego samego dnia dla rezerwacji potwierdzonych do 12:00.",
              price_grosze: 8000,
            },
            {
              title: "Dowóz do 50 km",
              text: "Kolejnego dnia roboczego, w dwugodzinnym oknie do wyboru.",
              price_grosze: 18000,
            },
          ],
        },
      },
      {
        type: "faq",
        background: "muted",
        content: {
          layout: "accordion",
          heading: "Pytania o rezerwację",
          allowMultiple: false,
          items: [
            {
              q: "Czy terminy w katalogu są aktualne?",
              a: "Tak. Katalog pokazuje stan magazynu na żywo — egzemplarz zarezerwowany przez kogoś innego znika z wyboru od razu.",
            },
            {
              q: "Jak długo trwa potwierdzenie?",
              a: "Rezerwacja online potwierdza się automatycznie. Mail z adresem odbioru i kwotą kaucji przychodzi w ciągu kilku minut.",
            },
            {
              q: "Czy mogę przedłużyć najem w trakcie?",
              a: "Tak, jeśli sprzęt nie jest zarezerwowany przez kolejnego klienta. Zadzwoń albo napisz — przedłużenie liczymy według cennika.",
            },
            {
              q: "Jaka jest kaucja?",
              a: "Zależy od sprzętu i jest podana przy każdej pozycji w katalogu. Zwracamy ją po przeglądzie, zwykle w ciągu dwóch dni roboczych.",
            },
            {
              q: "Co, jeśli sprzęt wróci uszkodzony?",
              a: "Wyceniamy naprawę i pokazujemy kosztorys przed potrąceniem czegokolwiek z kaucji. Zużycie eksploatacyjne jest po naszej stronie.",
            },
          ],
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          layout: "split",
          variant: "accent",
          heading: "Wiesz, czego potrzebujesz?",
          text: "Wejdź do katalogu, wybierz termin i zarezerwuj. Potwierdzenie dostaniesz od razu.",
          items: [
            { label: "Otwórz katalog", href: PRICING_CATALOG_HREF },
            { label: "Warunki najmu", href: "/regulamin" },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Twoja Wypożyczalnia",
          address: "ul. Magazynowa 17, 80-001 Gdańsk",
          phone: "+48 500 600 700",
          email: "kontakt@twojafirma.pl",
          hours: "Pon–Pt 8:00–17:00, Sob 9:00–13:00",
          /*
           * Cel jak w `construction-tools` (uzasadnienie w komentarzu przy jego
           * stopce): ten szablon też nie ma sekcji kontaktu w składzie (hero,
           * sprzęt, o nas, cennik, dostawa, pytania, wezwanie, stopka), a pasmo
           * wezwania stoi bezpośrednio nad stopką.
           */
          links: [
            { label: "Regulamin", href: "/regulamin" },
            { label: "Polityka prywatności", href: "/prywatnosc" },
            { label: "Kontakt", href: "#rezerwacja" },
          ],
          legal: "© Twoja Wypożyczalnia. Wszelkie prawa zastrzeżone.",
        },
      },
    ],
    en: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "The whole depot online, with live availability",
          subheading:
            "Check availability, pick your dates and book — no phone calls and no waiting for a quote.",
          ctaText: "Go to the catalog",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "muted",
        content: { layout: "grid", heading: "Equipment catalog", source: "catalog", items: [], limit: 8, featureFields: [] },
      },
      {
        type: "freeform",
        background: "default",
        content: {
          heading: "How booking works",
          body: "1. YOU PICK — the gear and the dates in the catalog; the system shows straight away whether a unit is free.\n\n2. WE CONFIRM — by email, with the pickup address and the deposit amount. Usually within minutes.\n\n3. YOU CHANGE IT IF NEEDED — move the dates up to 24 hours before pickup, no surcharge and no explaining.",
        },
      },
      {
        type: "pricing",
        background: "muted",
        content: {
          layout: "table",
          heading: "Base rates",
          showCatalogLink: true,
          footnote:
            "Daily rates for rentals up to three days. From the fourth day we charge 80% of the rate, from the seventh — 70%.",
          items: [
            { name: "Hand tools and power tools", price_grosze: 3000, unit: "day", mode: "from" },
            { name: "Garden equipment", price_grosze: 6000, unit: "day", mode: "from" },
            {
              name: "Cleaning equipment",
              price_grosze: 9000,
              unit: "day",
              mode: "from",
              note: "Chemicals are billed separately",
            },
            { name: "Scaffolding and ladders", price_grosze: 4000, unit: "day", mode: "from" },
            {
              name: "Trailers and transport",
              price_grosze: 12000,
              unit: "day",
              mode: "from",
              note: "Category B licence and a PLN 500 deposit required",
            },
            {
              name: "Monthly hire",
              price_grosze: 90000,
              unit: "month",
              mode: "from",
              note: "For companies, with a consolidated invoice",
            },
          ],
        },
      },
      {
        type: "delivery",
        background: "default",
        content: {
          layout: "cards",
          heading: "Pickup and delivery",
          intro: "Collect catalog gear yourself, or we bring it to the address you give us.",
          items: [
            {
              title: "Self pickup",
              text: "Depot by the ring road, parking at the ramp, handover in minutes.",
              price_grosze: 0,
            },
            {
              title: "Delivery in town",
              text: "Same day for bookings confirmed before 12:00.",
              price_grosze: 8000,
            },
            {
              title: "Delivery up to 50 km",
              text: "Next working day, in a two-hour window of your choice.",
              price_grosze: 18000,
            },
          ],
        },
      },
      {
        type: "faq",
        background: "muted",
        content: {
          layout: "accordion",
          heading: "Questions about booking",
          allowMultiple: false,
          items: [
            {
              q: "Is the availability in the catalog current?",
              a: "Yes. The catalog shows live stock — a unit booked by someone else disappears from the picker immediately.",
            },
            {
              q: "How long does confirmation take?",
              a: "Online bookings confirm automatically. The email with the pickup address and the deposit arrives within minutes.",
            },
            {
              q: "Can I extend the rental while it runs?",
              a: "Yes, if the gear is not booked by the next customer. Call or write — the extension is charged at the standard rate.",
            },
            {
              q: "How much is the deposit?",
              a: "It depends on the item and is listed with every catalog entry. We refund it after inspection, usually within two business days.",
            },
            {
              q: "What if the gear comes back damaged?",
              a: "We price the repair and show you the quote before deducting anything from the deposit. Normal wear is on us.",
            },
          ],
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          layout: "split",
          variant: "accent",
          heading: "Know what you need?",
          text: "Open the catalog, pick your dates and book. The confirmation arrives straight away.",
          items: [
            { label: "Open the catalog", href: PRICING_CATALOG_HREF },
            { label: "Rental terms", href: "/regulamin" },
          ],
        },
      },
      {
        type: "footer",
        background: "muted",
        content: {
          businessName: "Your Rental",
          address: "17 Magazynowa St, 80-001 Gdansk",
          phone: "+48 500 600 700",
          email: "hello@yourcompany.com",
          hours: "Mon–Fri 8:00–17:00, Sat 9:00–13:00",
          /* Cel jak w wersji polskiej tego szablonu. */
          links: [
            { label: "Terms", href: "/regulamin" },
            { label: "Privacy policy", href: "/prywatnosc" },
            { label: "Contact", href: "#rezerwacja" },
          ],
          legal: "© Your Rental. All rights reserved.",
        },
      },
    ],
  },
};

/**
 * Sekcje szablonu w kształcie DEKLARACJI — uporządkowane tak, jak mają stanąć
 * na stronie. Zwraca GŁĘBOKĄ KOPIĘ (ten sam kontrakt, co `presetContentFor`):
 * wołający wkłada tę treść do stanu edytora i ją mutuje, więc współdzielenie
 * referencji ze stałą modułu skaziłoby szablon dla następnego tenanta w tym
 * samym procesie. `locale` spoza allowlisty degraduje do „pl".
 */
export function starterTemplateSections(
  id: StarterTemplate,
  locale: string,
): StarterSection[] {
  const table = STARTER_SECTIONS[id];
  const sections = (PRESET_LOCALES as readonly string[]).includes(locale)
    ? table[locale as PresetLocale]
    : table.pl;
  return structuredClone(sections);
}

/**
 * Wpisy galerii z deklaracji → wpisy treści v3. Slot bez kadru w rejestrze
 * WYPADA, zamiast wjechać do treści jako `undefined`: schemat wymaga zdjęcia,
 * więc wpis bez niego nie jest „galerią bez obrazka", tylko treścią, której nie
 * da się zapisać. Kontrakt szablonów pilnuje, żeby ten filtr nigdy nie miał co
 * odsiewać — brak kuracji ma być CZERWONYM testem, a nie cichą dziurą w siatce.
 */
function galleryItemsOf(items: readonly StarterGalleryItem[]): GalleryStructuredContent["items"] {
  return items.flatMap((item) => {
    const photo = starterPhoto(item.slot);
    if (!photo) return [];
    return [
      {
        image: photo,
        alt: item.alt,
        ...(item.caption ? { caption: item.caption } : {}),
      },
    ];
  });
}

/**
 * Sekcje szablonu w postaci, którą kreator zapisuje do `content_draft`.
 *
 * Dwie drogi, jedna na generację (patrz nagłówek pliku):
 *   • typ strukturalny → treść v3 domknięta o `v`, `type` i pasmo tła. Nie ma
 *     tu żadnej konwersji: to, co zadeklarowaliśmy, JEST treścią sekcji;
 *   • typ bez silnika → konwersja {@link sectionCanvasWith}, a pasmo dokładamy
 *     na wyjściu, bo konwersja widzi pojedynczą sekcję i nie zna rytmu strony.
 */
export function starterTemplateContents(
  id: StarterTemplate,
  locale: string,
): StarterSectionContent[] {
  const layout = STARTER_LAYOUTS[id];
  const language = (PRESET_LOCALES as readonly string[]).includes(locale)
    ? (locale as PresetLocale)
    : "pl";

  return starterTemplateSections(id, locale).map((section) => {
    const { type, background } = section;

    if (isStructuredType(type)) {
      const content =
        type === "gallery"
          ? {
              ...(section.content as StarterStructuredContent<"gallery">),
              items: galleryItemsOf((section.content as StarterStructuredContent<"gallery">).items),
            }
          : section.content;
      return {
        type,
        content: {
          v: STRUCTURED_SECTION_VERSION,
          type,
          ...content,
          background,
        } as StructuredSectionContent,
      };
    }

    const media: SectionMedia[] = (layout.media?.[type] ?? []).map((entry) => ({
      alt: entry.alt[language],
      // `source` NIEOBECNE dla slotu bez kadru — element renderuje wtedy kafel
      // zastępczy w tym samym pudełku, więc układ jest identyczny przed kuracją
      // zdjęć i po niej (patrz ./starter-photos).
      ...(starterPhoto(entry.slot) ? { source: starterPhoto(entry.slot)! } : {}),
    }));

    return {
      type,
      content: {
        ...sectionCanvasWith(type, section.content, {
          composition: layout.compositions?.[type],
          media: media.length > 0 ? media : undefined,
          metricRatio: headingMetricRatio(themeTokens(layout.theme).fontPair),
        }),
        background,
      },
    };
  });
}
