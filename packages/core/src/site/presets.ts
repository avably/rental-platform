/**
 * Presety treści sekcji (kreator sekcyjny A2, ADR-082) — treść STARTOWA, którą
 * dostaje świeżo dodana sekcja. Zamiast pustego formularza operator widzi
 * gotowy, sensowny przykład i tylko go poprawia (wzorzec „preset = sekcja rodzi
 * się z treścią").
 *
 * Dwa języki, RĘCZNIE pisane (nie klucze i18n — to DANE tenanta), z PARYTETEM
 * STRUKTURY: preset PL i EN danego typu mają te same pola i tę samą liczbę
 * pozycji tablic; różni je wyłącznie tekst. Parytet pilnuje test w CI
 * (presets.test.ts) — brakujące pole w jednym języku = czerwony.
 *
 * Każdy preset SPEŁNIA schemat swojego typu z index.ts (osobny test parsuje
 * wszystkie presety). Galeria nie niesie zdjęć (bucket sekcji jest pusty do
 * pierwszego uploadu) — jej „przykładem" jest nagłówek i pusta lista.
 */
import type {
  SectionContent,
  SectionType,
} from "./index";

/** Języki presetów — parytet treści szablonów pilnowany w CI. */
export const PRESET_LOCALES = ["pl", "en"] as const;
export type PresetLocale = (typeof PRESET_LOCALES)[number];

/** Mapa presetów: język → typ → treść startowa (spełnia schemat typu). */
type PresetTable = Record<PresetLocale, Record<SectionType, SectionContent>>;

const PRESETS: PresetTable = {
  pl: {
    hero: {
      heading: "Wypożycz sprzęt bez papierologii",
      subheading: "Rezerwacja online, odbiór na miejscu albo z dostawą — wszystko w jednym miejscu.",
      ctaText: "Zobacz katalog",
      ctaHref: "#produkty",
    },
    products: {
      heading: "Nasz sprzęt",
    },
    categories: {
      heading: "Przeglądaj kategorie",
    },
    pricing: {
      heading: "Jak rozliczamy najem",
      note: "Ceny za dobę. Dłuższy najem — niższa stawka. Kaucję zwracamy po sprawdzeniu sprzętu.",
    },
    faq: {
      heading: "Najczęstsze pytania",
      items: [
        {
          q: "Jak zarezerwować sprzęt?",
          a: "Wybierz termin w katalogu i złóż rezerwację online — potwierdzenie dostaniesz mailem.",
        },
        {
          q: "Czy pobieracie kaucję?",
          a: "Tak, kaucję zwracamy po sprawdzeniu zwróconego sprzętu.",
        },
      ],
    },
    contact: {
      heading: "Kontakt",
      address: "ul. Przykładowa 1, 00-001 Warszawa",
      phone: "+48 500 600 700",
      email: "kontakt@twojafirma.pl",
      mapQuery: "Przykładowa 1, Warszawa",
    },
    freeform: {
      heading: "O nas",
      body: "Napisz kilka zdań o swojej wypożyczalni — co wynajmujesz, dla kogo i dlaczego warto.",
    },
    testimonials: {
      heading: "Co mówią klienci",
      items: [
        {
          quote: "Sprzęt gotowy na czas, obsługa konkretna. Wrócę.",
          author: "Anna Kowalska",
          role: "Organizatorka eventów",
        },
        {
          quote: "Prosta rezerwacja i uczciwa kaucja. Polecam.",
          author: "Marek Nowak",
          role: "Wykonawca",
        },
      ],
    },
    gallery: {
      heading: "Nasze realizacje",
      items: [],
    },
    usp: {
      heading: "Dlaczego my",
      items: [
        {
          icon: "truck",
          title: "Dostawa pod adres",
          text: "Przywieziemy i odbierzemy sprzęt tam, gdzie go potrzebujesz.",
        },
        {
          icon: "shield-check",
          title: "Kaucja zwrotna",
          text: "Jasne zasady, zwrot po sprawdzeniu sprzętu.",
        },
        {
          icon: "clock",
          title: "Szybka rezerwacja",
          text: "Rezerwujesz online w kilka minut.",
        },
        {
          icon: "wrench",
          title: "Sprawdzony sprzęt",
          text: "Każdy egzemplarz serwisowany przed wynajmem.",
        },
      ],
    },
    cta: {
      heading: "Gotowy, żeby wypożyczyć?",
      text: "Sprawdź dostępność i zarezerwuj termin online.",
      buttonLabel: "Zobacz katalog",
      buttonHref: "#produkty",
    },
    directions: {
      address: "ul. Przykładowa 1, 00-001 Warszawa",
      mapsUrl: "https://maps.google.com",
      hours: "Pon–Pt 9:00–17:00, Sob 9:00–13:00",
    },
    delivery: {
      heading: "Dostawa i odbiór",
      text: "Dowozimy sprzęt pod wskazany adres i odbieramy po zakończeniu najmu.",
      items: [
        {
          title: "Dostawa lokalna",
          text: "Na terenie miasta — realizacja tego samego dnia.",
        },
        {
          title: "Odbiór osobisty",
          text: "Za darmo w naszym punkcie po wcześniejszej rezerwacji.",
        },
      ],
    },
    footer: {
      businessName: "Wypożyczalnia Przykład",
      address: "ul. Przykładowa 1, 00-001 Warszawa",
      phone: "+48 500 100 200",
      email: "kontakt@przyklad.pl",
      hours: "Pon–Pt 9:00–17:00, Sob 9:00–13:00",
      links: [
        { label: "Regulamin", href: "/regulamin" },
        { label: "Polityka prywatności", href: "/prywatnosc" },
        { label: "Kontakt", href: "#kontakt" },
      ],
      legal: "© Wypożyczalnia Przykład. Wszelkie prawa zastrzeżone.",
    },
  },
  en: {
    hero: {
      heading: "Rent gear without the paperwork",
      subheading: "Book online, pick up on site or get it delivered — all in one place.",
      ctaText: "Browse catalog",
      ctaHref: "#produkty",
    },
    products: {
      heading: "Our equipment",
    },
    categories: {
      heading: "Browse categories",
    },
    pricing: {
      heading: "How rental pricing works",
      note: "Prices per day. Longer rental, lower rate. Deposit refunded after we check the gear.",
    },
    faq: {
      heading: "Frequently asked questions",
      items: [
        {
          q: "How do I book equipment?",
          a: "Pick your dates in the catalog and book online — you'll get an email confirmation.",
        },
        {
          q: "Do you charge a deposit?",
          a: "Yes, we refund the deposit after we check the returned gear.",
        },
      ],
    },
    contact: {
      heading: "Contact",
      address: "1 Example St, 00-001 Warsaw",
      phone: "+48 500 600 700",
      email: "hello@yourcompany.com",
      mapQuery: "Example 1, Warsaw",
    },
    freeform: {
      heading: "About us",
      body: "Write a few sentences about your rental business — what you rent, for whom, and why it's worth it.",
    },
    testimonials: {
      heading: "What clients say",
      items: [
        {
          quote: "Gear ready on time, straight-talking service. I'll be back.",
          author: "Anna Kowalska",
          role: "Event organizer",
        },
        {
          quote: "Simple booking and a fair deposit. Recommended.",
          author: "Marek Nowak",
          role: "Contractor",
        },
      ],
    },
    gallery: {
      heading: "Our work",
      items: [],
    },
    usp: {
      heading: "Why us",
      items: [
        {
          icon: "truck",
          title: "Delivery to your door",
          text: "We bring and collect the gear wherever you need it.",
        },
        {
          icon: "shield-check",
          title: "Refundable deposit",
          text: "Clear rules, refunded after we check the gear.",
        },
        {
          icon: "clock",
          title: "Fast booking",
          text: "Book online in a couple of minutes.",
        },
        {
          icon: "wrench",
          title: "Maintained equipment",
          text: "Every unit is serviced before it goes out.",
        },
      ],
    },
    cta: {
      heading: "Ready to rent?",
      text: "Check availability and book your dates online.",
      buttonLabel: "Browse catalog",
      buttonHref: "#produkty",
    },
    directions: {
      address: "1 Example St, 00-001 Warsaw",
      mapsUrl: "https://maps.google.com",
      hours: "Mon–Fri 9:00–17:00, Sat 9:00–13:00",
    },
    delivery: {
      heading: "Delivery and pickup",
      text: "We deliver gear to your address and collect it once the rental ends.",
      items: [
        {
          title: "Local delivery",
          text: "Within the city — same-day where possible.",
        },
        {
          title: "Self pickup",
          text: "Free at our location after booking ahead.",
        },
      ],
    },
    footer: {
      businessName: "Example Rentals",
      address: "1 Example St, 00-001 Warsaw",
      phone: "+48 500 100 200",
      email: "hello@example.com",
      hours: "Mon–Fri 9:00–17:00, Sat 9:00–13:00",
      links: [
        { label: "Terms", href: "/regulamin" },
        { label: "Privacy policy", href: "/prywatnosc" },
        { label: "Contact", href: "#kontakt" },
      ],
      legal: "© Example Rentals. All rights reserved.",
    },
  },
};

/**
 * Treść startowa sekcji danego typu w danym języku. Zwraca GŁĘBOKĄ KOPIĘ —
 * wołający (edytor) mutuje ją w stanie formularza, więc współdzielenie
 * referencji ze stałą modułu byłoby cichym błędem. `locale` spoza allowlisty
 * degraduje do "pl" (domyślny język tenanta).
 */
export function presetContentFor(type: SectionType, locale: string): SectionContent {
  const table = (PRESET_LOCALES as readonly string[]).includes(locale)
    ? PRESETS[locale as PresetLocale]
    : PRESETS.pl;
  return structuredClone(table[type]);
}
