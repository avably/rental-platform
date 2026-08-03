/**
 * SZABLONY STARTOWE (K5, ADR-090) — sześć gotowych STRON, od których tenant
 * zaczyna pracę w kreatorze, zamiast od pustego płótna.
 *
 * Presety sekcji (ADR-082) rozwiązały problem „pustej sekcji": nowa sekcja
 * rodzi się z treścią. Nie rozwiązały problemu PUSTEJ STRONY — operator
 * wypożyczalni wchodzi do kreatora pierwszy raz i musi sam wymyślić, z czego
 * składa się strona sprzedażowa, w jakiej kolejności i ile tego ma być. Szablon
 * startowy odpowiada na to jednym kliknięciem: dostaje SKŁAD strony, a nie
 * kolejny pusty ekran z przyciskiem „dodaj sekcję".
 *
 * ============ DLACZEGO LISTA TREŚCI v1, A NIE GOTOWA GEOMETRIA ============
 *
 * Szablon deklaruje UPORZĄDKOWANĄ LISTĘ SEKCJI w kształcie v1 (typ + treść +
 * pasmo tła), a płótno v2 rodzi się z niej przez {@link sectionCanvasFrom} —
 * tę samą, obłożoną kontraktem konwersję, z której korzysta galeria sekcji
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
import { themeTokens, type SiteThemeId } from "./theme";
/*
 * IMPORT TYLKO TYPÓW, i to jest tu warunek działania, a nie kosmetyka:
 * `index.ts` re-eksportuje ten moduł, więc import WARTOŚCI zamknąłby cykl
 * `index → starter-templates → index`. Re-eksporty są hoistowane, więc ten plik
 * ewaluowałby się PRZED ciałem `index.ts` i zobaczyłby `SECTION_CONTENT_SCHEMAS`
 * w martwej strefie. `import type` znika przy kompilacji — cyklu nie ma.
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
 */
export const STARTER_SECTION_BOUNDS = { min: 5, max: 7 } as const;

/**
 * Jedna sekcja szablonu: typ, treść w kształcie v1 ZGODNA z tym typem i pasmo
 * tła. Kształt treści bierze się wprost ze schematów sekcji, więc treść
 * niepasująca do typu nie skompiluje się — bez tego rozjazd wyszedłby dopiero
 * na walidacji, w teście, daleko od miejsca, w którym powstał.
 */
export type StarterSection = {
  [T in SectionType]: {
    type: T;
    content: z.infer<(typeof SECTION_CONTENT_SCHEMAS)[T]>;
    background: SectionBackground;
  };
}[SectionType];

/** Sekcja szablonu po konwersji — treść jest już płótnem v2. */
export interface StarterSectionCanvas {
  type: SectionType;
  content: SectionCanvas;
}

type StarterTable = Record<StarterTemplate, Record<PresetLocale, StarterSection[]>>;

/**
 * Adres map w sekcji „dojazd" i przy kontakcie. Wskazuje wyszukiwarkę, a nie
 * konkretny punkt: adresy w szablonie są PRZYKŁADOWE i operator podmienia je
 * na własne, więc utrwalony pineski prowadziłby donikąd.
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
//   • MOTYW — paleta, kroje, promienie, styl przycisku (rejestr w ./theme);
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

interface StarterLayout {
  theme: SiteThemeId;
  /** Archetyp kadru per typ sekcji; brak wpisu = `stack` (sam tekst). */
  compositions?: Partial<Record<SectionType, SectionComposition>>;
  /** Kadry per typ sekcji — slot z rejestru zdjęć + opis alternatywny w obu językach. */
  media?: Partial<Record<SectionType, { slot: StarterPhotoSlot; alt: { pl: string; en: string } }[]>>;
}

export const STARTER_LAYOUTS: Record<StarterTemplate, StarterLayout> = {
  "construction-tools": {
    theme: "industrial-noir",
    compositions: { hero: "overlay", delivery: "band" },
    media: {
      hero: [
        {
          slot: "construction-hero",
          alt: { pl: "Sprzęt budowlany na placu o zmierzchu", en: "Construction machinery on site at dusk" },
        },
      ],
      delivery: [
        {
          slot: "construction-delivery",
          alt: { pl: "Załadunek sprzętu na lawetę", en: "Equipment loaded onto a flatbed truck" },
        },
      ],
    },
  },
  "bike-sport": {
    theme: "velocity",
    compositions: { hero: "split", directions: "band" },
    media: {
      hero: [
        { slot: "bike-hero", alt: { pl: "Rowerzysta na trasie", en: "Rider on the trail" } },
      ],
      directions: [
        { slot: "bike-location", alt: { pl: "Wnętrze serwisu rowerowego", en: "Inside the bike workshop" } },
      ],
    },
  },
  "event-party": {
    theme: "confetti",
    compositions: { hero: "overlay", gallery: "band" },
    media: {
      hero: [
        {
          slot: "event-hero",
          alt: { pl: "Namiot weselny w wieczornym świetle", en: "Wedding marquee in evening light" },
        },
      ],
      gallery: [
        { slot: "event-gallery-1", alt: { pl: "Nakryty stół bankietowy", en: "Set banquet table" } },
        { slot: "event-gallery-2", alt: { pl: "Parkiet pod namiotem", en: "Dance floor under the marquee" } },
        { slot: "event-gallery-3", alt: { pl: "Rzędy krzeseł na ceremonię", en: "Rows of ceremony chairs" } },
      ],
    },
  },
  "photo-video": {
    theme: "noir-lux",
    compositions: { hero: "overlay", usp: "band" },
    media: {
      hero: [
        { slot: "photo-hero", alt: { pl: "Kamera i światło w studiu", en: "Camera and lighting on set" } },
      ],
      usp: [
        { slot: "photo-studio", alt: { pl: "Sprzęt oświetleniowy w studiu", en: "Lighting gear in the studio" } },
      ],
    },
  },
  "one-page-lean": {
    theme: "atelier",
    compositions: { hero: "split", contact: "band" },
    media: {
      hero: [
        { slot: "lean-hero", alt: { pl: "Narzędzia w dziennym świetle", en: "Tools in daylight" } },
      ],
      contact: [
        { slot: "lean-workshop", alt: { pl: "Warsztat od strony stołu", en: "The workbench side of the shop" } },
      ],
    },
  },
  "catalog-first": {
    theme: "gridline",
    compositions: { hero: "band", delivery: "band" },
    media: {
      hero: [
        { slot: "catalog-hero", alt: { pl: "Uporządkowany magazyn sprzętu", en: "Neatly organised equipment store" } },
      ],
      delivery: [
        { slot: "catalog-delivery", alt: { pl: "Załadunek dostawczaka", en: "Loading the delivery van" } },
      ],
    },
  },
};

/** Motyw, w którym renderuje się szablon — wybór szablonu JEST wyborem świata. */
export function starterTemplateTheme(id: StarterTemplate): SiteThemeId {
  return STARTER_LAYOUTS[id].theme;
}

/** Sloty zdjęć użyte przez szablon — wejście wyzwalacza pobrania przy zastosowaniu. */
export function starterTemplatePhotoSlots(id: StarterTemplate): StarterPhotoSlot[] {
  return Object.values(STARTER_LAYOUTS[id].media ?? {})
    .flat()
    .map((entry) => entry.slot);
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
        content: { heading: "Sprzęt do wynajęcia" },
      },
      {
        type: "delivery",
        background: "muted",
        content: {
          heading: "Transport i odbiór",
          text: "Dowozimy sprzęt na plac budowy w umówionym oknie czasowym i odbieramy go po zakończeniu najmu — Twoi ludzie nie tracą dnia na dojazdy do wypożyczalni.",
          items: [
            {
              title: "Dostawa do 30 km",
              text: "Realizacja w kolejnym dniu roboczym po potwierdzeniu rezerwacji.",
            },
            {
              title: "Odbiór własny z magazynu",
              text: "Bezpłatnie, w godzinach pracy magazynu, po wcześniejszym potwierdzeniu terminu.",
            },
          ],
        },
      },
      {
        type: "pricing",
        background: "default",
        content: {
          heading: "Stawki i kaucje",
          note: "Rozliczamy dobę roboczą. Przy najmie od siedmiu dni stawka spada o 20%. Kaucję zwracamy po przeglądzie zwróconego sprzętu.",
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Potrzebujesz sprzętu na jutro rano?",
          text: "Sprawdź dostępność w kalendarzu i zarezerwuj online — potwierdzenie przyjdzie od razu na maila.",
          buttonLabel: "Zarezerwuj sprzęt",
          buttonHref: "#produkty",
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
        content: { heading: "Equipment for hire" },
      },
      {
        type: "delivery",
        background: "muted",
        content: {
          heading: "Delivery and collection",
          text: "We deliver to the site within an agreed time window and collect once the rental ends — your crew does not lose a day driving to the depot.",
          items: [
            {
              title: "Delivery up to 30 km",
              text: "Next working day after the booking has been confirmed.",
            },
            {
              title: "Self pickup from the depot",
              text: "Free of charge during depot hours, once the slot has been confirmed.",
            },
          ],
        },
      },
      {
        type: "pricing",
        background: "default",
        content: {
          heading: "Rates and deposits",
          note: "We charge per working day. From seven days the rate drops by 20%. The deposit is refunded after we inspect the returned gear.",
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Need the gear on site tomorrow morning?",
          text: "Check the calendar and book online — the confirmation lands in your inbox straight away.",
          buttonLabel: "Book equipment",
          buttonHref: "#produkty",
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
        background: "default",
        content: { heading: "Nasza flota" },
      },
      {
        type: "pricing",
        background: "muted",
        content: {
          heading: "Cennik najmu",
          note: "Doba, weekend albo cały tydzień — im dłużej, tym taniej. Kask i zapięcie dokładamy bez dopłaty.",
        },
      },
      {
        type: "faq",
        background: "default",
        content: {
          heading: "Zanim wypożyczysz",
          items: [
            {
              q: "Czy pobieracie kaucję?",
              a: "Tak. Kaucję pobieramy przy odbiorze i zwracamy w całości po sprawdzeniu sprzętu. Jej wysokość podajemy przy każdej pozycji w katalogu, żeby na miejscu nie było niespodzianek.",
            },
            {
              q: "Co zrobić, gdy sprzęt odmówi posłuszeństwa w trasie?",
              a: "Zadzwoń do nas od razu. Drobne usterki podpowiemy, jak usunąć przez telefon, a przy poważniejszej awarii podmieniamy sprzęt na najbliższy dostępny. Zwykłe zużycie nigdy nie obciąża klienta.",
            },
            {
              q: "Czy macie sprzęt dla dzieci?",
              a: "Mamy rowery i kaski w rozmiarach dziecięcych, foteliki oraz przyczepki. Podaj wzrost dziecka w uwagach do rezerwacji, a właściwy rozmiar będzie czekał na godzinę odbioru.",
            },
          ],
        },
      },
      {
        type: "testimonials",
        background: "muted",
        content: {
          heading: "Opinie z zeszłego sezonu",
          items: [
            {
              quote: "Rowery przygotowane co do ciśnienia w oponach. Tydzień w górach bez jednej awarii.",
              author: "Kamil Wrona",
              role: "Klient weekendowy",
            },
            {
              quote: "Zamiana na większy rozmiar zajęła pięć minut, bez dopłaty i bez dyskusji.",
              author: "Ola Bąk",
              role: "Wyjazd rodzinny",
            },
          ],
        },
      },
      {
        type: "directions",
        background: "default",
        content: {
          address: "ul. Sportowa 12, 30-001 Kraków",
          mapsUrl: MAPS_URL,
          hours: "Pon–Pt 8:00–19:00, Sob–Nd 8:00–16:00",
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Sprzęt czeka, sezon nie.",
          text: "Zarezerwuj termin online i odbierz sprzęt gotowy do jazdy.",
          buttonLabel: "Rezerwuję online",
          buttonHref: "#produkty",
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
            "Book online, pick it up ready to ride — helmet, lock and a full check included in the rate.",
          ctaText: "Pick your gear",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "default",
        content: { heading: "Our fleet" },
      },
      {
        type: "pricing",
        background: "muted",
        content: {
          heading: "Rental rates",
          note: "A day, a weekend or a full week — the longer you keep it, the less you pay. Helmet and lock come with it.",
        },
      },
      {
        type: "faq",
        background: "default",
        content: {
          heading: "Before you book",
          items: [
            {
              q: "Do you take a deposit?",
              a: "Yes. We take the deposit at pickup and refund it in full once we have checked the gear. The amount is listed with every item in the catalog, so there are no surprises at the counter.",
            },
            {
              q: "What if something breaks mid-route?",
              a: "Call us right away. We talk you through the small fixes over the phone, and for anything serious we swap the gear for the nearest available unit. Normal wear is never charged to the customer.",
            },
            {
              q: "Do you have gear for children?",
              a: "We keep bikes and helmets in children's sizes, plus child seats and trailers. Add the child's height to the booking notes and the right size will be waiting at pickup.",
            },
          ],
        },
      },
      {
        type: "testimonials",
        background: "muted",
        content: {
          heading: "Voices from last season",
          items: [
            {
              quote: "The bikes were ready down to the tyre pressure. A week in the mountains without a single breakdown.",
              author: "Kamil Wrona",
              role: "Weekend customer",
            },
            {
              quote: "Swapping for a larger frame took five minutes, no surcharge and no argument.",
              author: "Ola Bąk",
              role: "Family trip",
            },
          ],
        },
      },
      {
        type: "directions",
        background: "default",
        content: {
          address: "12 Sportowa St, 30-001 Krakow",
          mapsUrl: MAPS_URL,
          hours: "Mon–Fri 8:00–19:00, Sat–Sun 8:00–16:00",
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "The gear is ready. The season is not waiting.",
          text: "Book your dates online and collect the gear ready to ride.",
          buttonLabel: "Book online",
          buttonHref: "#produkty",
        },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Eventy — sprzedaje zdjęcia z realizacji i zdjęty z głowy montaż.
  // Galeria startuje PUSTA (bucket sekcji zapełnia się pierwszym uploadem) —
  // ta sama zasada, co w presecie galerii (ADR-082).
  // ---------------------------------------------------------------------
  "event-party": {
    pl: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Wyposażenie na wesela, konferencje i imprezy firmowe",
          subheading:
            "Namioty, stoły, nagłośnienie i światło — z montażem na miejscu i odbiorem następnego dnia.",
          ctaText: "Zobacz wyposażenie",
          ctaHref: "#produkty",
        },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          heading: "Bierzemy na siebie logistykę",
          items: [
            {
              icon: "package",
              title: "Komplet na jedno zamówienie",
              text: "Stoły, krzesła, obrusy i zastawa jadą jednym transportem, w jednym terminie.",
            },
            {
              icon: "clock",
              title: "Montaż przed Twoim przyjazdem",
              text: "Ekipa rozstawia sprzęt na kilka godzin przed startem imprezy.",
            },
            {
              icon: "sparkles",
              title: "Wszystko czyste i sprawdzone",
              text: "Tekstylia po praniu, sprzęt po przeglądzie — komplet sprawdzamy przy załadunku.",
            },
          ],
        },
      },
      {
        type: "gallery",
        background: "default",
        content: { heading: "Nasze realizacje", items: [] },
      },
      {
        type: "delivery",
        background: "muted",
        content: {
          heading: "Montaż i demontaż",
          text: "Przyjeżdżamy w umówionym oknie, rozstawiamy wyposażenie i wracamy po nie po zakończeniu imprezy. Nie musisz szukać ludzi do znoszenia stołów o drugiej w nocy.",
          items: [
            {
              title: "Montaż dzień wcześniej",
              text: "Standard przy weselach i konferencjach — sala jest gotowa z wyprzedzeniem.",
            },
            {
              title: "Demontaż następnego dnia",
              text: "Odbieramy sprzęt rano, bez pośpiechu i bez dodatkowej doby najmu.",
            },
          ],
        },
      },
      {
        type: "testimonials",
        background: "default",
        content: {
          heading: "Co mówią organizatorzy",
          items: [
            {
              quote: "Namiot stanął na czas mimo deszczu, a ekipa została do końca montażu parkietu.",
              author: "Marta Zielińska",
              role: "Wesele na 120 osób",
            },
            {
              quote: "Konferencja na trzy sale, jedno zamówienie i jeden kontakt. Tak to ma wyglądać.",
              author: "Paweł Sikora",
              role: "Agencja eventowa",
            },
          ],
        },
      },
      {
        type: "contact",
        background: "muted",
        content: {
          heading: "Porozmawiajmy o Twojej imprezie",
          address: "ul. Wesoła 8, 61-001 Poznań",
          phone: "+48 500 600 700",
          email: "eventy@twojafirma.pl",
          mapQuery: "Wesoła 8, Poznań",
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Masz termin? Zablokujmy sprzęt.",
          text: "Podaj datę i liczbę gości — wycenę kompletu przygotujemy tego samego dnia.",
          buttonLabel: "Zapytaj o termin",
          buttonHref: "#kontakt",
        },
      },
    ],
    en: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Equipment for weddings, conferences and company parties",
          subheading:
            "Marquees, tables, sound and lighting — set up on location and collected the next day.",
          ctaText: "See the equipment",
          ctaHref: "#produkty",
        },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          heading: "The logistics are on us",
          items: [
            {
              icon: "package",
              title: "One order, the whole set",
              text: "Tables, chairs, linen and tableware travel together, on one delivery, on one date.",
            },
            {
              icon: "clock",
              title: "Set up before you arrive",
              text: "Our crew puts everything in place hours before the event starts.",
            },
            {
              icon: "sparkles",
              title: "Clean and checked",
              text: "Linen freshly laundered, equipment inspected — the set is checked as it is loaded.",
            },
          ],
        },
      },
      {
        type: "gallery",
        background: "default",
        content: { heading: "Our work", items: [] },
      },
      {
        type: "delivery",
        background: "muted",
        content: {
          heading: "Set-up and take-down",
          text: "We arrive within the agreed window, set the equipment up and come back for it once the event is over. You will not be looking for people to carry tables at two in the morning.",
          items: [
            {
              title: "Set-up the day before",
              text: "Standard for weddings and conferences — the venue is ready ahead of time.",
            },
            {
              title: "Take-down the next day",
              text: "We collect in the morning, unhurried and with no extra rental day.",
            },
          ],
        },
      },
      {
        type: "testimonials",
        background: "default",
        content: {
          heading: "What organizers say",
          items: [
            {
              quote: "The marquee went up on time despite the rain, and the crew stayed until the dance floor was done.",
              author: "Marta Zielińska",
              role: "Wedding for 120 guests",
            },
            {
              quote: "A three-room conference, one order and one point of contact. That is how it should work.",
              author: "Paweł Sikora",
              role: "Event agency",
            },
          ],
        },
      },
      {
        type: "contact",
        background: "muted",
        content: {
          heading: "Let's talk about your event",
          address: "8 Wesola St, 61-001 Poznan",
          phone: "+48 500 600 700",
          email: "events@yourcompany.com",
          mapQuery: "Wesola 8, Poznan",
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Got a date? Let's hold the equipment.",
          text: "Send us the date and the number of guests — you will have a quote for the whole set the same day.",
          buttonLabel: "Ask about a date",
          buttonHref: "#kontakt",
        },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Foto i wideo — klient kupuje pewność na planie, nie cenę; stąd atuty
  // o teście przed wydaniem i sprzęcie zastępczym oraz obszerne FAQ.
  // ---------------------------------------------------------------------
  "photo-video": {
    pl: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Sprzęt foto i wideo na sesję, plan i transmisję",
          subheading:
            "Korpusy, optyka, światło i dźwięk — skonfigurowane i przetestowane przed każdym wydaniem.",
          ctaText: "Zobacz katalog",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "default",
        content: { heading: "Sprzęt w wypożyczalni" },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          heading: "Co dostajesz w cenie najmu",
          items: [
            {
              icon: "badge-check",
              title: "Test przed każdym wydaniem",
              text: "Sprawdzamy matrycę, ostrość i akumulatory, zanim spakujemy zestaw.",
            },
            {
              icon: "package",
              title: "Komplet w walizce",
              text: "Karty, akumulatory, ładowarki i filtry jadą razem z korpusem.",
            },
            {
              icon: "headphones",
              title: "Wsparcie w dniu zdjęciowym",
              text: "Odbieramy telefon także w weekend, gdy coś dzieje się na planie.",
            },
            {
              icon: "shield-check",
              title: "Sprzęt zastępczy",
              text: "Awaria na planie znaczy podmianę zestawu, a nie koniec zdjęć.",
            },
          ],
        },
      },
      {
        type: "pricing",
        background: "default",
        content: {
          heading: "Jak liczymy najem",
          note: "Doba zdjęciowa to 24 godziny od odbioru. Weekend liczymy jak jedną dobę, a przy najmie od pięciu dni schodzimy o 25%.",
        },
      },
      {
        type: "faq",
        background: "muted",
        content: {
          heading: "Pytania przed rezerwacją",
          items: [
            {
              q: "Czy wymagacie ubezpieczenia sprzętu?",
              a: "Przy zestawach powyżej ustalonej wartości prosimy o polisę albo o podwyższoną kaucję. Podpowiemy, co bardziej opłaca się przy Twoim projekcie — wybór należy do Ciebie.",
            },
            {
              q: "Czy mogę przedłużyć najem w trakcie zdjęć?",
              a: "Tak, o ile sprzęt nie jest zarezerwowany dalej. Napisz albo zadzwoń przed końcem doby, a przedłużenie doliczymy do tej samej rezerwacji, bez ponownego odbioru.",
            },
            {
              q: "Co z kartami pamięci i akumulatorami?",
              a: "Karty i akumulatory wchodzą w komplet i są w cenie zestawu. Materiał zgrywasz u siebie — kart nie czyścimy, dopóki nie potwierdzisz, że kopia jest bezpieczna.",
            },
          ],
        },
      },
      {
        type: "contact",
        background: "default",
        content: {
          heading: "Wypożyczalnia",
          address: "ul. Filmowa 3, 00-001 Warszawa",
          phone: "+48 500 600 700",
          email: "rezerwacje@twojafirma.pl",
          mapQuery: "Filmowa 3, Warszawa",
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Masz termin zdjęciowy?",
          text: "Sprawdź dostępność zestawu i zarezerwuj sprzęt online.",
          buttonLabel: "Rezerwuj zestaw",
          buttonHref: "#produkty",
        },
      },
    ],
    en: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Photo and video gear for shoots, sets and live streams",
          subheading:
            "Bodies, glass, lighting and sound — configured and tested before every handover.",
          ctaText: "Browse the catalog",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "default",
        content: { heading: "Gear in stock" },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          heading: "What the rate includes",
          items: [
            {
              icon: "badge-check",
              title: "Tested before every handover",
              text: "We check the sensor, the focus and the batteries before the kit is packed.",
            },
            {
              icon: "package",
              title: "The whole kit in one case",
              text: "Cards, batteries, chargers and filters travel with the body.",
            },
            {
              icon: "headphones",
              title: "Support on shooting days",
              text: "We pick up the phone at weekends too, when something happens on set.",
            },
            {
              icon: "shield-check",
              title: "Replacement gear",
              text: "A failure on set means a swapped kit, not the end of the shoot.",
            },
          ],
        },
      },
      {
        type: "pricing",
        background: "default",
        content: {
          heading: "How we count the rental",
          note: "A shooting day is 24 hours from pickup. A weekend counts as one day, and from five days the rate drops by 25%.",
        },
      },
      {
        type: "faq",
        background: "muted",
        content: {
          heading: "Questions before you book",
          items: [
            {
              q: "Do you require insurance?",
              a: "For kits above an agreed value we ask for a policy or for a higher deposit. We will tell you which works out better for your project — the choice is yours.",
            },
            {
              q: "Can I extend the rental during the shoot?",
              a: "Yes, as long as the gear is not booked after you. Write or call before the day ends and the extension goes onto the same booking, with no second handover.",
            },
            {
              q: "What about memory cards and batteries?",
              a: "Cards and batteries are part of the kit and are included in the rate. You copy the footage yourself — we do not wipe a card until you confirm your backup is safe.",
            },
          ],
        },
      },
      {
        type: "contact",
        background: "default",
        content: {
          heading: "The rental house",
          address: "3 Filmowa St, 00-001 Warsaw",
          phone: "+48 500 600 700",
          email: "bookings@yourcompany.com",
          mapQuery: "Filmowa 3, Warsaw",
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Got a shooting date?",
          text: "Check whether the kit is free and book it online.",
          buttonLabel: "Book a kit",
          buttonHref: "#produkty",
        },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Jedna strona, pięć sekcji — najkrótsza sensowna strona sprzedażowa.
  // Dolna granica {@link STARTER_SECTION_BOUNDS} jest ustawiona pod NIĄ.
  // ---------------------------------------------------------------------
  "one-page-lean": {
    pl: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Wypożyczalnia, która mieści się na jednej stronie",
          subheading:
            "Krótko: co wynajmujesz, dlaczego u Ciebie i jak zarezerwować. Reszta tylko rozprasza.",
          ctaText: "Zobacz ofertę",
          ctaHref: "#produkty",
        },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          heading: "Trzy powody, żeby zacząć u nas",
          items: [
            {
              icon: "clock",
              title: "Rezerwacja w kilka minut",
              text: "Klient wybiera termin i potwierdza — bez telefonów i wymiany maili.",
            },
            {
              icon: "shield-check",
              title: "Jasne zasady kaucji",
              text: "Kwota i warunki zwrotu są widoczne, zanim ktokolwiek zapłaci.",
            },
            {
              icon: "thumbs-up",
              title: "Sprzęt gotowy na godzinę odbioru",
              text: "Przygotowany, sprawdzony i opisany — bez niespodzianek na miejscu.",
            },
          ],
        },
      },
      {
        type: "products",
        background: "default",
        content: { heading: "Co wynajmujemy" },
      },
      {
        type: "contact",
        background: "muted",
        content: {
          heading: "Kontakt",
          address: "ul. Krótka 4, 50-001 Wrocław",
          phone: "+48 500 600 700",
          email: "kontakt@twojafirma.pl",
          mapQuery: "Krótka 4, Wrocław",
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Zaczynamy?",
          text: "Wybierz sprzęt i termin — potwierdzenie dostaniesz od razu.",
          buttonLabel: "Zarezerwuj online",
          buttonHref: "#produkty",
        },
      },
    ],
    en: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "A rental business that fits on a single page",
          subheading:
            "The short version: what you rent, why from you, and how to book it. The rest is noise.",
          ctaText: "See the offer",
          ctaHref: "#produkty",
        },
      },
      {
        type: "usp",
        background: "muted",
        content: {
          heading: "Three reasons to start here",
          items: [
            {
              icon: "clock",
              title: "Booking in minutes",
              text: "The customer picks the dates and confirms — no phone tag, no email threads.",
            },
            {
              icon: "shield-check",
              title: "Clear deposit rules",
              text: "The amount and the refund terms are visible before anybody pays.",
            },
            {
              icon: "thumbs-up",
              title: "Ready at pickup time",
              text: "Prepared, checked and labelled — no surprises at the counter.",
            },
          ],
        },
      },
      {
        type: "products",
        background: "default",
        content: { heading: "What we rent" },
      },
      {
        type: "contact",
        background: "muted",
        content: {
          heading: "Contact",
          address: "4 Krotka St, 50-001 Wroclaw",
          phone: "+48 500 600 700",
          email: "hello@yourcompany.com",
          mapQuery: "Krotka 4, Wroclaw",
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Shall we start?",
          text: "Pick the gear and the dates — the confirmation is instant.",
          buttonLabel: "Book online",
          buttonHref: "#produkty",
        },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Katalog na pierwszym planie — dla tych, u których sprzedaje sam asortyment.
  // Katalog stoi zaraz pod hero, a cała narracja idzie POD nim.
  // ---------------------------------------------------------------------
  "catalog-first": {
    pl: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "Cały katalog od pierwszego ekranu",
          subheading: "Klient wchodzi i od razu widzi, co jest wolne w jego terminie.",
          ctaText: "Przeglądaj katalog",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "default",
        content: { heading: "Dostępny sprzęt" },
      },
      {
        type: "freeform",
        background: "muted",
        content: {
          heading: "O wypożyczalni",
          body: "Napisz w tym miejscu, skąd wzięła się Twoja firma i za co odpowiadasz przed klientem. Sprzęt kupujemy pod realne zapotrzebowanie, serwisujemy go sami i wycofujemy, zanim zacznie zawodzić — to jest ten jeden akapit, który ludzie czytają w całości, więc powiedz w nim coś konkretnego zamiast ogólników o pasji i jakości.",
        },
      },
      {
        type: "pricing",
        background: "default",
        content: {
          heading: "Zasady rozliczenia",
          note: "Stawka dobowa maleje wraz z długością najmu. Kaucja jest zwrotna, a jej wysokość podajemy przy każdej pozycji katalogu.",
        },
      },
      {
        type: "delivery",
        background: "muted",
        content: {
          heading: "Odbiór i dostawa",
          text: "Sprzęt odbierzesz osobiście w magazynie albo dowieziemy go pod wskazany adres. Termin ustalamy przy potwierdzeniu rezerwacji, więc nikt nie czeka pod zamkniętą bramą.",
          items: [
            {
              title: "Odbiór osobisty",
              text: "Bezpłatnie, w godzinach pracy magazynu.",
            },
            {
              title: "Dostawa pod adres",
              text: "Wycena po podaniu kodu pocztowego i terminu najmu.",
            },
          ],
        },
      },
      {
        type: "faq",
        background: "default",
        content: {
          heading: "Najczęstsze pytania",
          items: [
            {
              q: "Jak sprawdzić, czy sprzęt jest wolny w moim terminie?",
              a: "Kalendarz w katalogu pokazuje realną dostępność każdej pozycji. Wybierz daty, a lista zawęzi się do sprzętu wolnego w całym tym okresie.",
            },
            {
              q: "Czy mogę odwołać rezerwację?",
              a: "Tak, bezpłatnie do 48 godzin przed odbiorem. Później zatrzymujemy część kaucji, bo przez ten czas sprzęt był zablokowany dla innych klientów.",
            },
            {
              q: "Czy wystawiacie faktury?",
              a: "Do każdej rezerwacji wystawiamy fakturę VAT. Dane podajesz przy składaniu zamówienia, a dokument wysyłamy mailem po zakończeniu najmu.",
            },
          ],
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Znalazłeś sprzęt na swój termin?",
          text: "Zarezerwuj go online — kalendarz zablokuje pozycję od razu.",
          buttonLabel: "Rezerwuj z katalogu",
          buttonHref: "#produkty",
        },
      },
    ],
    en: [
      {
        type: "hero",
        background: "default",
        content: {
          heading: "The whole catalog from the first screen",
          subheading: "Visitors land and immediately see what is free on their dates.",
          ctaText: "Browse the catalog",
          ctaHref: "#produkty",
        },
      },
      {
        type: "products",
        background: "default",
        content: { heading: "Available equipment" },
      },
      {
        type: "freeform",
        background: "muted",
        content: {
          heading: "About the rental",
          body: "Use this space to say where your business came from and what you answer for in front of a customer. We buy gear against real demand, service it ourselves and retire it before it starts letting people down — this is the one paragraph people read in full, so put something concrete in it instead of generalities about passion and quality.",
        },
      },
      {
        type: "pricing",
        background: "default",
        content: {
          heading: "How billing works",
          note: "The daily rate goes down as the rental gets longer. The deposit is refundable and its amount is listed with every catalog item.",
        },
      },
      {
        type: "delivery",
        background: "muted",
        content: {
          heading: "Pickup and delivery",
          text: "Collect the gear at the depot yourself or have it delivered to the address you give us. We agree the slot when the booking is confirmed, so nobody waits at a closed gate.",
          items: [
            {
              title: "Self pickup",
              text: "Free of charge, during depot hours.",
            },
            {
              title: "Delivery to your address",
              text: "Quoted once we have your postcode and rental dates.",
            },
          ],
        },
      },
      {
        type: "faq",
        background: "default",
        content: {
          heading: "Frequently asked questions",
          items: [
            {
              q: "How do I check whether the gear is free on my dates?",
              a: "The calendar in the catalog shows the real availability of every item. Pick your dates and the list narrows down to gear that is free for the whole period.",
            },
            {
              q: "Can I cancel a booking?",
              a: "Yes, free of charge up to 48 hours before pickup. After that we keep part of the deposit, because the gear was held for you and unavailable to others.",
            },
            {
              q: "Do you issue invoices?",
              a: "Every booking gets a VAT invoice. You give us the billing details when you order and we email the document once the rental ends.",
            },
          ],
        },
      },
      {
        type: "cta",
        background: "inverted",
        content: {
          heading: "Found the gear for your dates?",
          text: "Book it online — the calendar holds the item right away.",
          buttonLabel: "Book from the catalog",
          buttonHref: "#produkty",
        },
      },
    ],
  },
};

/**
 * Sekcje szablonu w kształcie v1 — UPORZĄDKOWANE tak, jak mają stanąć na
 * stronie. Zwraca GŁĘBOKĄ KOPIĘ (ten sam kontrakt, co `presetContentFor`):
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
 * Sekcje szablonu jako PŁÓTNA v2 — to jest postać, którą kreator zapisuje do
 * `content_draft`. Konwersję robi w całości {@link sectionCanvasFrom}; jedyne,
 * co dokładamy, to pasmo tła, bo konwersja widzi pojedynczą sekcję i nie ma
 * z czego wiedzieć, jaki rytm ma cała strona (patrz nagłówek pliku).
 */
export function starterTemplateCanvases(
  id: StarterTemplate,
  locale: string,
): StarterSectionCanvas[] {
  const layout = STARTER_LAYOUTS[id];
  const language = (PRESET_LOCALES as readonly string[]).includes(locale)
    ? (locale as PresetLocale)
    : "pl";

  return starterTemplateSections(id, locale).map(({ type, content, background }) => {
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
        ...sectionCanvasWith(type, content, {
          composition: layout.compositions?.[type],
          media: media.length > 0 ? media : undefined,
          metricRatio: headingMetricRatio(themeTokens(layout.theme).fontPair),
        }),
        background,
      },
    };
  });
}
