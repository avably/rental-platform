/**
 * Walidacja wejść akcji modelu sekcyjnego storefrontu (Zadanie 2.3a, ADR-041).
 * Kształt TREŚCI sekcji pochodzi WYŁĄCZNIE z @avably/core/site — ten moduł
 * dokłada tylko otoczkę akcji (identyfikatory, pozycje, spójność reorderu).
 * Czyste funkcje/schematy — testowalne bez kontekstu Next (test/site-validation.test.ts).
 *
 * Komunikaty po polsku — wzorzec repo (lib/validation.ts).
 */
import { z } from "zod";

import {
  HOME_PAGE_SLUG,
  PAGE_SITE_KIND,
  PAGE_SLUG_MAX_LENGTH,
  PAGE_SLUG_PATTERN,
  PRODUCT_TEMPLATE_SITE_KIND,
  SITE_KINDS,
  STARTER_TEMPLATES,
  isReservedPageSlug,
  sectionInputSchema,
  siteStyleSchema,
  suggestPageSlug,
} from "@avably/core/site";

import { uuidSchema } from "./catalog-validation";

/**
 * Wynik akcji modelu sekcyjnego — kontrakt dla edytora 2.3b. Rozmyślnie NIE
 * FormState (te akcje woła edytor programowo, nie useActionState z FormData);
 * `error` jest gotowym komunikatem dla operatora.
 */
export type SiteActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Górna granica pozycji/liczby sekcji — strona to kilkanaście sekcji, nie tysiące. */
export const MAX_SECTIONS = 100;

/**
 * Ile WERSJI strony może mieć jeden sklep (0048, ADR-093). Limit stoi po
 * stronie aplikacji, a nie w CHECK-u bazy, i to jest świadome: liczba wersji
 * jest decyzją PRODUKTOWĄ (docelowo różnicowaną planem), a nie niezmiennikiem
 * danych. Niezmiennikiem jest co innego — najwyżej jedna wersja ŻYWA — i tego
 * pilnuje unikat częściowy w bazie.
 */
export const MAX_SITES = 10;

/**
 * Ile PRODUKTÓW może mieć własną stronę (wyjątek od szablonu-matki) — LUSTRO
 * triggera `sites_product_exception_limit` z migracji 0088 (ADR-199), wyłącznie
 * do ZDANIA w interfejsie („użyto X z 5"). Bramką jest BAZA: akcja forka nie
 * liczy limitu przed wstawką, tylko łapie odmowę PT409 — drugie źródło prawdy
 * o limicie w TS rozjechałoby się z triggerem przy pierwszej zmianie planu.
 */
export const MAX_PRODUCT_EXCEPTIONS = 5;

/**
 * Nazwa wersji strony. Lustro CHECK-a `sites_name_length_check` (0048): 1–80
 * znaków po przycięciu. `trim` w schemacie, żeby „   " nie przechodziło jako
 * nazwa, którą baza i tak odrzuci.
 */
const siteNameSchema = z
  .string()
  .trim()
  .min(1, "Nazwa strony nie może być pusta.")
  .max(80, "Nazwa strony może mieć najwyżej 80 znaków.");

/**
 * ADRES STRONY (Faza 2, 0073, ADR-157) — walidacja z UZASADNIENIEM.
 *
 * Trzy odmowy, każda z własnym zdaniem, bo operator ma usłyszeć, CO poprawić:
 * kształt, długość i rezerwacja. Kolejność sprawdzeń jest celowa (kształt →
 * rezerwacja): „adres zarezerwowany" o wejściu `Moja Strona` byłoby myleniem.
 *
 * BRAMKĄ JEST BAZA, nie ten schemat. CHECK `sites_slug_shape` i trigger
 * `sites_slug_guard` stoją niżej i widzą także zapis surowym PostgREST-em.
 * Ten schemat istnieje po to, żeby operator dostał zdanie zamiast 23514 —
 * i żeby dostał je W POLU, zanim cokolwiek wyśle.
 *
 * PUSTY SLUG PRZECHODZI TYLKO JAKO JAWNA STRONA GŁÓWNA. `suggestPageSlug`
 * zwraca pustkę dla nazwy bez ani jednego znaku ASCII („???"), więc bez tej
 * gałęzi operator wyprodukowałby DRUGĄ stronę główną, nie zauważając niczego.
 */
export const pageSlugSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .superRefine((slug, ctx) => {
    if (slug === HOME_PAGE_SLUG) return;
    if (slug.length > PAGE_SLUG_MAX_LENGTH) {
      ctx.addIssue({
        code: "custom",
        message: `Adres może mieć najwyżej ${PAGE_SLUG_MAX_LENGTH} znaków.`,
      });
      return;
    }
    if (!PAGE_SLUG_PATTERN.test(slug)) {
      ctx.addIssue({
        code: "custom",
        message:
          "Adres może zawierać wyłącznie małe litery bez ogonków, cyfry i myślniki (np. jak-dziala-wynajem).",
      });
      return;
    }
    if (isReservedPageSlug(slug)) {
      ctx.addIssue({
        code: "custom",
        message: `Adres „${slug}" jest zarezerwowany przez sklep — wybierz inny.`,
      });
    }
  });

/**
 * Slug WYMAGANY (strona treściowa): pusty przechodzi tylko przez jawną gałąź
 * strony głównej wyżej, a tu jest błędem z własnym zdaniem — pusty adres
 * WPISANY W POLE znaczy „nie dało się wyprowadzić go z nazwy", nie „to strona
 * główna". Intencję „zakładam stronę główną" niesie POMINIĘCIE klucza `slug`,
 * a nie jego pusta wartość (patrz `createSiteInputSchema`), więc ten zakaz
 * dotyczy wyłącznie adresu podanego wprost i zostaje nietknięty.
 */
const contentPageSlugSchema = pageSlugSchema.superRefine((slug, ctx) => {
  if (slug === HOME_PAGE_SLUG) {
    ctx.addIssue({
      code: "custom",
      message: "Podaj adres strony — z tej nazwy nie da się go wyprowadzić.",
    });
  }
});

export const createSiteInputSchema = z.object({
  name: siteNameSchema,
  /**
   * POMINIĘTY SLUG = STRONA GŁÓWNA (`/`) — i to jest JEDYNA droga do jej
   * założenia (ADR-168). Panel podaje adres jawnie dla podstron, a okno
   * „Utwórz stronę główną" wysyła sam `name`.
   *
   * Czego ten schemat NIE potrafi i potrafić nie może: sprawdzić, czy najemca
   * ma już stronę główną. To jest stan BAZY, nie kształt wejścia — więc
   * zawężenie „pusty adres wolno wziąć, dopóki strona główna nie istnieje"
   * stoi w `createSite` (odczyt przed wstawką), a ostateczną bramką zostaje
   * unikat `sites_live_slug_unique_idx` (23505 przy publikacji drugiej żywej
   * strony pod tym samym adresem).
   */
  slug: contentPageSlugSchema.optional(),
  /**
   * ROLA zakładanej strony (faza 5, 0080, ADR-178). Pominięta = `page`, czyli
   * dokładnie to, czym był każdy wiersz przed fazą 5 — wywołania sprzed niej
   * nie zmieniają znaczenia ani o jotę.
   *
   * Rola jest NIEZMIENNA (trigger `sites_kind_guard`), więc jest to jedyny
   * moment w życiu wiersza, w którym da się ją podać. `renameSiteInputSchema`
   * jej nie zna i znać nie może.
   */
  kind: z.enum(SITE_KINDS).optional(),
});
export type CreateSiteInput = z.infer<typeof createSiteInputSchema>;

/**
 * SZABLON NIE MA ADRESU — odmowa jako ZDANIE, albo `null`, gdy wejście jest
 * spójne (faza 5, ADR-178).
 *
 * Reguła stoi TU, a nie w `superRefine` schematu, bo jest tą samą klasą
 * rozstrzygnięcia, co „strona główna może być jedna": pyta o ZWIĄZEK dwóch
 * pól wejścia, a odpowiedź musi być tym samym zdaniem dla akcji i dla testu.
 * Bramką ostateczną i tak jest CHECK `sites_product_template_no_slug` — ta
 * funkcja istnieje po to, żeby odmowa miała uzasadnienie zamiast surowego
 * 23514.
 */
export function productTemplateSlugIssue(input: {
  kind?: string;
  slug?: string;
}): string | null {
  if (input.kind !== PRODUCT_TEMPLATE_SITE_KIND) return null;
  if (input.slug === undefined) return null;
  return "Szablon strony produktu nie ma własnego adresu — pokazuje się pod adresem każdego sprzętu.";
}

/**
 * CZY TEN KOMPLET STRON MA JUŻ SZABLON STRONY PRODUKTU (ADR-178).
 *
 * Bliźniak `hasHomePage` i z tego samego powodu: pytanie o STAN BAZY, zadawane
 * przez akcję (przed wstawką) i przez ekran (żeby nie proponować czasownika,
 * który i tak odmówi). Bramką ostateczną jest unikat
 * `sites_live_product_template_idx`, ale on pilnuje wyłącznie ŻYWEGO szablonu
 * — dwa szkice to dla bazy stan legalny, a dla operatora dwie strony, z których
 * jedna nigdy nie wejdzie do sklepu. Dlatego to pytanie obejmuje WSZYSTKIE
 * wiersze roli, nie tylko żywe.
 */
export function hasProductTemplate(pages: readonly { kind: string }[]): boolean {
  return pages.some((page) => page.kind === PRODUCT_TEMPLATE_SITE_KIND);
}

/** Rola wiersza zastanego — wejście mapowań, w których kolumny brak. */
export const DEFAULT_SITE_KIND = PAGE_SITE_KIND;

/**
 * Wejście akcji FORKA (faza B, ADR-200): własna strona wskazanego produktu.
 * Sam identyfikator — treść przyjeżdża z KOPII szablonu-matki, a nazwa
 * z katalogu (obie ze STANU BAZY, nigdy z wejścia): klient, który mógłby
 * podać treść albo nazwę, mógłby też podać cudzą.
 */
export const forkProductPageInputSchema = z.object({
  productId: uuidSchema,
});
export type ForkProductPageInput = z.infer<typeof forkProductPageInputSchema>;

/**
 * ILE PRODUKTÓW MA JUŻ WŁASNĄ STRONĘ — licznik „użyto X z 5" (ADR-200,
 * zabezpieczenie §4.3 dokumentu architektury: wyjątek, którego nie da się
 * policzyć, przestaje być wyjątkiem).
 *
 * Liczy PRODUKTY (zbiór `productId`), nie wiersze — dokładnie tak, jak trigger
 * `sites_product_exception_limit` w bazie (count distinct product_id): drugi
 * szkic tego samego produktu limitu nie zjada, więc licznik, który liczyłby
 * wiersze, pokazywałby „3 z 5" najemcy, któremu baza odmówi dopiero przy 6.
 * PRODUKCIE. Jedna definicja dla ekranu i testu.
 */
export function countProductExceptions(
  pages: readonly { productId?: string | null }[],
): number {
  return new Set(
    pages
      .map((page) => page.productId)
      .filter((productId): productId is string => typeof productId === "string"),
  ).size;
}

/**
 * CZY TA ODMOWA BAZY TO LIMIT WŁASNYCH STRON PRODUKTU (ADR-199/200).
 *
 * Trigger `sites_product_exception_limit` odmawia SQLSTATE `PT409` z hintem-
 * -tokenem `sites_product_exception_limit` — dopasowanie idzie po KODZIE
 * i HINCIE, nigdy po treści zdania (zdanie jest dla człowieka i ma prawo się
 * zmienić). Dwa kanały świadomie: kod niesie klasę odmowy, hint jej źródło —
 * wystarcza każdy z nich, żeby transportowa zguba drugiego nie zamieniła
 * czytelnej odmowy w surowy komunikat.
 */
export function isProductExceptionLimitError(error: {
  code?: string;
  hint?: string | null;
}): boolean {
  return error.code === "PT409" || error.hint === "sites_product_exception_limit";
}

/**
 * CZY TEN KOMPLET STRON MA STRONĘ GŁÓWNĄ — jedna definicja dla akcji i dla
 * ekranu (ADR-168).
 *
 * Pytanie musi objąć OBA adresy wiersza, a nie sam szkic: strona, której szkic
 * przeniesiono pod inny adres, DALEJ stoi w sklepie pod `/`, dopóki nie zostanie
 * opublikowana ponownie (`slug_published` jest bliźniakiem, 0073/ADR-091).
 * Sam `slug` odpowiadałby „strony głównej nie ma" o sklepie, w którym klienci
 * właśnie ją oglądają — i zapraszał do założenia drugiej.
 */
export function hasHomePage(
  pages: readonly { slug: string; slugPublished: string | null; kind?: string }[],
): boolean {
  return pages.some(
    (page) =>
      /*
        ROLA WCHODZI DO WARUNKU (faza 5, ADR-178) — inaczej SZABLON STRONY
        PRODUKTU udawałby stronę główną. Szablon nie ma adresu, więc jego slug
        jest pusty; sam pusty slug przestał więc znaczyć „korzeń sklepu".
        Bez tego członu najemca, który zbudował szablon i nie ma jeszcze strony
        głównej, dostawałby na ekranie „strona główna jest" i odmowę przy
        próbie jej założenia — czyli dokładnie tę wadę, którą zamknął ADR-168,
        wpuszczoną z powrotem innymi drzwiami.

        Domyślka `?? PAGE_SITE_KIND` obsługuje wołających sprzed fazy 5:
        wiersze bez roli SĄ stronami, bo taka jest wartość zastana kolumny.
      */
      (page.kind ?? PAGE_SITE_KIND) === PAGE_SITE_KIND &&
      (page.slug === HOME_PAGE_SLUG || page.slugPublished === HOME_PAGE_SLUG),
  );
}

export const renameSiteInputSchema = z.object({
  siteId: uuidSchema,
  name: siteNameSchema,
  /**
   * Adres jest opcjonalny, bo strona GŁÓWNA go nie zmienia — jej adresem jest
   * `/` i nie ma tam czego edytować. Nieobecność znaczy „nie ruszaj adresu",
   * a nie „ustaw pusty".
   */
  slug: contentPageSlugSchema.optional(),
  /**
   * Czy stary adres ma dostać 308 przy najbliższej publikacji (0075, ADR-159).
   * Pytanie zadawane W TYM SAMYM oknie, w którym zmienia się adres — bo to
   * jedyny moment, w którym operator wie, czy stary adres gdzieś już żyje.
   * Nieobecność znaczy „nie ruszaj ustawienia", nie „wyłącz".
   */
  redirectOldSlug: z.boolean().optional(),
});
export type RenameSiteInput = z.infer<typeof renameSiteInputSchema>;

/**
 * Odmowa adresu jako ZDANIE, albo `null` gdy adres jest dobry.
 *
 * Formularz woła TO SAMO, co akcja serwerowa — inaczej pole mówiłoby „ok",
 * a zapis wracał z błędem, którego operator nie umie powiązać z tym, co wpisał.
 * Bramką i tak jest baza; ta funkcja istnieje po to, żeby odmowa padła W POLU,
 * z uzasadnieniem, zanim cokolwiek zostanie wysłane.
 */
export function pageSlugIssue(value: string): string | null {
  const parsed = contentPageSlugSchema.safeParse(value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Nieprawidłowy adres strony.");
}

/**
 * Adres proponowany z nazwy — TA SAMA funkcja, której używa formularz do
 * podpowiedzi. Druga kopia rozjechałaby się z pierwszą przy pierwszej zmianie
 * transliteracji, a operator zobaczyłby wtedy inny adres, niż dostał zapisany.
 */
export function suggestSiteSlug(name: string): string {
  return suggestPageSlug(name);
}

const positionSchema = z.number().int().min(0).max(1_000_000);

/**
 * Wejście upsertu sekcji. `sectionId` obecne = aktualizacja draftu istniejącej
 * sekcji (typ NIEZMIENNY — zmiana typu to usunięcie + dodanie, inaczej stara
 * treść published innego kształtu wisiałaby pod nowym typem); nieobecne =
 * dodanie nowej sekcji na końcu (albo na podanej pozycji).
 *
 * `insertBefore` (E2) opisuje MIEJSCE świeżej sekcji SĄSIADEM: nowa sekcja ma
 * stanąć bezpośrednio przed wskazaną. Indeksu tu NIE MA świadomie — indeks jest
 * prawdziwy tylko na liście, na której go policzono, więc drugie kliknięcie
 * „+" wysłane bez czekania na pierwsze trafiałoby obok wskazanego miejsca
 * (lekcja K6-delty, ADR-092 decyzja 1b). Pole jest ignorowane przy
 * AKTUALIZACJI: kolejność zmienia `reorderSections`, nie zapis treści.
 */
export const upsertSectionInputSchema = z
  .object({
    siteId: uuidSchema,
    sectionId: uuidSchema.optional(),
    position: positionSchema.optional(),
    insertBefore: uuidSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .and(sectionInputSchema);
export type UpsertSectionInput = z.infer<typeof upsertSectionInputSchema>;

export const reorderSectionsInputSchema = z.object({
  siteId: uuidSchema,
  orderedIds: z
    .array(uuidSchema)
    .min(1, "Kolejność nie może być pusta.")
    .max(MAX_SECTIONS, "Za dużo sekcji."),
});

export const toggleSectionInputSchema = z.object({
  sectionId: uuidSchema,
  enabled: z.boolean(),
});


/**
 * Wejście zapisu STYLU SKLEPU (K5, ADR-090; poziom najemcy od ADR-161).
 * Kształt samego stylu pochodzi z @avably/core/site — tu jest tylko otoczka
 * akcji, jak przy sekcjach.
 *
 * BEZ POLA `siteId` I TO JEST ASERCJA, NIE OSZCZĘDNOŚĆ: styl przestał być
 * właściwością podstrony, więc wejście, które umiałoby wskazać stronę, byłoby
 * wejściem obiecującym coś, czego model nie potrafi (ADR-161).
 *
 * Styl jedzie w CAŁOŚCI, a nie jako łatka pojedynczego pola. Scalanie po
 * stronie serwera („zmień sam akcent, resztę zostaw") wymagałoby odczytu przed
 * zapisem, a to jest wyścig: dwie karty kreatora otwarte na tym samym sklepie
 * nadpisywałyby sobie nawzajem wybór, i to niedeterministycznie. Panel trzyma
 * pełny stan stylu i odsyła go w komplecie — ostatni zapis wygrywa, ale wygrywa
 * PRZEWIDYWALNIE.
 */
export const updateStoreStyleInputSchema = z.object({
  style: siteStyleSchema,
});
export type UpdateStoreStyleInput = z.infer<typeof updateStoreStyleInputSchema>;

/**
 * Wejście zastosowania SZABLONU STARTOWEGO (K5, ADR-090) — operacja
 * DESTRUKCYJNA dla szkicu, stąd `confirm` w interfejsie, a nie tutaj: schemat
 * pilnuje kształtu, a nie intencji operatora.
 *
 * `locale` decyduje o języku treści przykładowej i degraduje do PL tak samo jak
 * presety sekcji (`presetContentFor`) — jedna zasada dla całej treści startowej.
 */
export const applyStarterTemplateInputSchema = z.object({
  siteId: uuidSchema,
  starterId: z.enum(STARTER_TEMPLATES),
  locale: z.string().trim().min(2).max(10),
});
export type ApplyStarterTemplateInput = z.infer<typeof applyStarterTemplateInputSchema>;

/**
 * Plan zmiany kolejności: orderedIds musi być PERMUTACJĄ kompletu sekcji
 * strony. Podzbiór (sekcja pominięta) albo obcy id oznaczałyby cichą utratę
 * lub przywłaszczenie pozycji — odmawiamy zamiast zgadywać. Zwraca listę
 * (id → position) do zapisania albo komunikat odmowy.
 */
export function reorderPlan(
  currentIds: readonly string[],
  orderedIds: readonly string[],
): { ok: true; updates: { id: string; position: number }[] } | { ok: false; error: string } {
  if (new Set(orderedIds).size !== orderedIds.length) {
    return { ok: false, error: "Kolejność zawiera zduplikowane sekcje." };
  }
  const current = new Set(currentIds);
  if (orderedIds.length !== current.size || orderedIds.some((id) => !current.has(id))) {
    return {
      ok: false,
      error: "Kolejność nie obejmuje dokładnie wszystkich sekcji strony — odśwież edytor.",
    };
  }
  return { ok: true, updates: orderedIds.map((id, index) => ({ id, position: index })) };
}
