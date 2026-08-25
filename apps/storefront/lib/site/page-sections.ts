/**
 * POWŁOKA PONAD STRONAMI — PODZIAŁ SEKCJI NA „STRONĘ" I „POWŁOKĘ"
 * (faza 0, ADR-154).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Stopka zbudowana w kreatorze renderowała się WYŁĄCZNIE na `/store`, bo była
 * zwykłą sekcją listy, a listę sekcji rysowała tylko trasa katalogu. Klient
 * najemcy klikał w kafel sprzętu i stopka znikała: adres, telefon, godziny
 * otwarcia i odnośniki do dokumentów przestawały istnieć dokładnie w chwili,
 * w której odwiedzający zaczyna sprawdzać, komu właściwie płaci.
 *
 * ==================== ROZSTRZYGNIĘCIE ====================
 *
 * Stopka przestaje być własnością STRONY i staje się własnością POWŁOKI
 * (`StoreChrome`), tak jak wcześniej nagłówek sklepu (K6, ADR-092). Trasa
 * katalogu rysuje odtąd sekcje BEZ przypiętych, a powłoka dokłada przypięte
 * pod spodem — na każdej trasie sklepu, także tam, gdzie sekcji nie ma wcale
 * (koszyk, kasa, regulamin).
 *
 * Kryterium podziału nie jest `type === "footer"`, tylko REJESTR SEKCJI
 * PRZYPIĘTYCH z rdzenia (`isPinnedLastType`). To ten sam zbiór, którym
 * normalizacja kolejności pilnuje, że stopka stoi na końcu — więc drugi typ
 * przypięty (pasek zgód?) wejdzie do powłoki bez dotykania tego pliku, a nie
 * zostanie po cichu w środku strony.
 *
 * ==================== SEMANTYKA, KTÓRA WYCHODZI PRZY OKAZJI ====================
 *
 * Do fazy 0 stopka stała WEWNĄTRZ `<main>` trasy katalogu — czyli landmark
 * `contentinfo` był zagnieżdżony w landmarku treści głównej i przestawał być
 * punktem nawigacji dla czytnika ekranu. Po przeniesieniu do powłoki stoi obok
 * `<main>`, czyli tam, gdzie należy.
 */
import {
  isSectionCanvas,
  isPinnedLastType,
  sectionAnchorHref,
  sectionAnchorIds,
  type PublishedSection,
  type PublishedSite,
} from "@avably/core/site";
import { siteContactHref } from "@avably/ui";

/**
 * Sekcje należące do STRONY — wszystko poza przypiętymi do końca dokumentu.
 * Kolejność zostaje z wejścia (baza sortuje po `position`).
 */
export function pageSections(site: PublishedSite | null): PublishedSection[] {
  return (site?.sections ?? []).filter((section) => !isPinnedLastType(section.type));
}

/**
 * Sekcje należące do POWŁOKI — przypięte do końca dokumentu (dziś: stopka).
 *
 * Baza gwarantuje najwyżej jedną stopkę na stronę (unikat częściowy, 0047),
 * ale funkcja zwraca LISTĘ, bo zbiór typów przypiętych jest z rejestru, a nie
 * z tego jednego niezmiennika — i drugi typ przypięty nie ma powodu być
 * jedyny.
 */
export function shellSections(site: PublishedSite | null): PublishedSection[] {
  return (site?.sections ?? []).filter((section) => isPinnedLastType(section.type));
}

/**
 * KOTWICE POWŁOKI POZA STRONĄ, NA KTÓREJ STOJĄ ICH CELE.
 *
 * ==================== PROBLEM, KTÓRY TWORZY FAZA 0 ====================
 *
 * Stopka z presetu prowadzi na `#kontakt` i `#produkty` — kotwice sekcji, które
 * stoją na stronie katalogu. Dopóki stopka renderowała się tylko tam, odnośniki
 * działały. Wpuszczenie jej na WSZYSTKIE trasy sklepu wpuszcza je na strony,
 * na których celu nie ma: klient na karcie produktu klikałby „Kontakt" i nie
 * działoby się NIC — bez błędu, bez zmiany adresu, bez śladu w konsoli. To jest
 * dokładnie ta klasa cichej awarii, którą zamknął rejestr kotwic (ADR-097
 * i poprzedzające), więc faza 0 nie ma prawa otworzyć jej z powrotem.
 *
 * ==================== ROZWIĄZANIE: ADRES BEZWZGLĘDNY ZAMIAST KOTWICY ====================
 *
 * Poza stroną z sekcjami czysta kotwica `#kontakt` staje się `/store#kontakt`,
 * czyli prowadzi tam, gdzie jej cel NAPRAWDĘ jest. Przepisanie dotyczy
 * WYŁĄCZNIE klucza `href` o wartości zaczynającej się od `#` — bo to jest
 * jedyna nazwa, pod którą cel odnośnika mieszka we WSZYSTKICH trzech
 * generacjach treści (`links[].href` v1, `href` elementu płótna v2,
 * `items[].href` sekcji strukturalnej v3). Adres bezwzględny, względny i pełny
 * URL zostają nietknięte: one już wiedzą, dokąd prowadzą.
 *
 * Przepisanie jest CZYSTE (nowe obiekty) — treść z bazy zostaje bez zmian,
 * a strona katalogu dostaje tę samą stopkę z kotwicami działającymi w miejscu.
 */
export function withAnchorBase(sections: PublishedSection[], base: string): PublishedSection[] {
  return sections.map(
    (section) => ({ ...section, content: rebaseAnchors(section.content, base) }) as PublishedSection,
  );
}

/**
 * „KONTAKT" W STOPCE PROWADZI DO KONTAKTU, NIGDY DO SEKCJI CTA
 * (S-38 audytu 2026-08-25).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Preset stopki linkuje „Kontakt" do kotwicy pasma wezwania (`#rezerwacja`),
 * bo skład szablonu nie ma sekcji kontaktu, a kotwica własnej stopki nie
 * przewija (pomiar w `starter-templates.ts`). Skutek na sklepie: klient
 * szukający kontaktu ląduje w marketingowym CTA („Otwórz katalog") — etykieta
 * obiecuje co innego niż cel. Treść szablonów należy do pasa E9, więc naprawa
 * NIE zmienia zapisanej treści — jest przekształceniem renderu powłoki, jak
 * `withAnchorBase` wyżej (i naprawia też stopki JUŻ opublikowane).
 *
 * ==================== REGUŁA ====================
 *
 *   1. Strona główna MA sekcję kontaktu → cel staje się `#kontakt`
 *      (a `withAnchorBase` przepisze go na podstronach na `/#kontakt`).
 *   2. Nie ma sekcji kontaktu, ale stopka niesie e-mail → `mailto:` z tego
 *      e-maila — kontakt w jednym tapnięciu zamiast skoku do CTA.
 *   3. Nie ma ani sekcji, ani e-maila (stan bez realnych danych) → odnośnik
 *      zostaje, bo lepszego celu nie istnieje skąd wziąć.
 *
 * Zasięg: WYŁĄCZNIE wartości `href` równe kotwicy CTA — to jedyny przypadek,
 * w którym cel kłamie etykiecie. Odnośniki do innych kotwic i adresów zostają.
 */
export function withFooterContactTarget(
  footer: PublishedSection[],
  site: PublishedSite | null,
): PublishedSection[] {
  const ctaHref = sectionAnchorHref("cta");
  if (!footer.some((section) => hasHrefValue(section.content, ctaHref))) return footer;

  const homeHasContact = pageSections(site).some((section) => section.type === "contact");
  const target = homeHasContact ? sectionAnchorHref("contact") : footerMailto(footer);
  if (!target) return footer;

  return footer.map(
    (section) =>
      ({ ...section, content: rewriteHrefs(section.content, ctaHref, target) }) as PublishedSection,
  );
}

/**
 * KOTWICA BEZ CELU PROWADZI DO KATALOGU (S-10 audytu 2026-08-25).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Presety i szablony startowe wpisują w przycisk hero adres `#produkty`
 * (`starter-templates.ts`, `presets.ts`) — a kotwica `produkty` powstaje
 * WYŁĄCZNIE tam, gdzie na stronie stoi sekcja sprzętu. Najemca, który zbudował
 * stronę bez tej sekcji (albo postawił hero na podstronie treściowej), dostaje
 * przycisk, który po kliknięciu NIE ROBI NIC: przeglądarka nie ma czego
 * znaleźć, adres się nie zmienia, konsola milczy. To ta sama klasa cichej
 * awarii, którą zamknął rejestr kotwic (`section-anchors.ts`) — tyle że od
 * drugiej strony: tam brakowało `id` w dokumencie, tu brakuje SEKCJI.
 *
 * ==================== DLACZEGO W RENDERZE, A NIE W DANYCH ====================
 *
 * Treść najemcy zostaje nietknięta — i to jest wymóg, nie wygoda. Sekcja
 * sprzętu bywa dodana jutro (operator buduje stronę etapami), a przepisany
 * w bazie `ctaHref` już by nie wrócił do `#produkty`: naprawa danych zamroziłaby
 * stan z chwili, w której akurat patrzyliśmy. Przekształcenie renderu liczy się
 * PRZY KAŻDEJ ODSŁONIE, więc dodanie sekcji samo przywraca kotwicę.
 *
 * To jest ta sama droga, którą idą `withAnchorBase` i `withFooterContactTarget`
 * wyżej: czysta funkcja nad listą sekcji, wołana przez trasę tuż przed
 * rendererem.
 *
 * ==================== ZASIĘG ====================
 *
 * WYŁĄCZNIE gołe kotwice (`#coś`) — adres bezwzględny, względny, pełny URL,
 * `tel:` i `mailto:` wiedzą, dokąd prowadzą. Kotwica, której cel NA TEJ STRONIE
 * stoi, zostaje bez zmian; dopiero brak celu zamienia ją na katalog, bo katalog
 * jest jedynym miejscem, o którym wiemy, że na pewno istnieje i że odpowiada na
 * intencję „pokaż mi ofertę".
 *
 * Klucz `href` jest jedyną nazwą celu we WSZYSTKICH trzech generacjach treści
 * (v1 `ctaHref` ma własną nazwę, więc dochodzi osobno — patrz `ANCHOR_KEYS`).
 */
const ANCHOR_KEYS = new Set(["href", "ctaHref", "buttonHref", "mapsUrl"]);

export function withCatalogFallbackAnchors(
  sections: PublishedSection[],
  fallback: string,
): PublishedSection[] {
  // Kotwice, które NA TEJ STRONIE naprawdę powstaną — ta sama funkcja, której
  // renderer używa do wystawienia `id` w dokumencie. Drugie, „prawie takie
  // samo" wyliczenie rozjechałoby się z rendererem przy pierwszej zmianie
  // reguły „pierwsza sekcja typu wygrywa".
  const live = new Set(sectionAnchorIds(sections).values());

  return sections.map(
    (section) =>
      ({ ...section, content: rewriteDeadAnchors(section.content, live, fallback) }) as PublishedSection,
  );
}

/** Rekurencyjne przepisanie martwych kotwic — czyste, jak {@link rebaseAnchors}. */
function rewriteDeadAnchors(node: unknown, live: Set<string>, fallback: string): unknown {
  if (Array.isArray(node)) return node.map((item) => rewriteDeadAnchors(item, live, fallback));
  if (typeof node !== "object" || node === null) return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] =
      ANCHOR_KEYS.has(key) && typeof value === "string" && value.startsWith("#")
        ? live.has(value.slice(1))
          ? value
          : fallback
        : rewriteDeadAnchors(value, live, fallback);
  }
  return out;
}

/** Czy treść niesie GDZIEKOLWIEK `href` o dokładnie tej wartości. */
function hasHrefValue(node: unknown, href: string): boolean {
  if (Array.isArray(node)) return node.some((item) => hasHrefValue(item, href));
  if (typeof node !== "object" || node === null) return false;
  return Object.entries(node as Record<string, unknown>).some(([key, value]) =>
    key === "href" && typeof value === "string" ? value === href : hasHrefValue(value, href),
  );
}

/** Rekurencyjne przepisanie `href === from` na `to` — czyste, jak {@link rebaseAnchors}. */
function rewriteHrefs(node: unknown, from: string, to: string): unknown {
  if (Array.isArray(node)) return node.map((item) => rewriteHrefs(item, from, to));
  if (typeof node !== "object" || node === null) return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] =
      key === "href" && typeof value === "string" && value === from
        ? to
        : rewriteHrefs(value, from, to);
  }
  return out;
}

/**
 * Pierwszy e-mail z treści stopki jako `mailto:` — rozpoznanie CAŁEJ wartości
 * tekstowej tym samym sądem, którym render stopki linkuje kontakt (S-29),
 * więc obie naprawy nie mają jak rozjechać się o definicję „e-maila".
 */
function footerMailto(footer: PublishedSection[]): string | null {
  for (const section of footer) {
    const found = findMailto(section.content);
    if (found) return found;
  }
  return null;
}

function findMailto(node: unknown): string | null {
  if (typeof node === "string") {
    const href = siteContactHref(node);
    return href?.startsWith("mailto:") ? href : null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findMailto(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object" || node === null) return null;
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findMailto(value);
    if (found) return found;
  }
  return null;
}

/** Rekurencyjne przejście po treści sekcji — patrz {@link withAnchorBase}. */
function rebaseAnchors(node: unknown, base: string): unknown {
  if (Array.isArray(node)) return node.map((item) => rebaseAnchors(item, base));
  if (typeof node !== "object" || node === null) return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] =
      key === "href" && typeof value === "string" && value.startsWith("#")
        ? `${base}${value}`
        : rebaseAnchors(value, base);
  }
  return out;
}

/**
 * NAGŁÓWEK DOKUMENTU JEST JUŻ ZAJĘTY — nagłówki pierwszego poziomu z treści
 * najemcy schodzą na drugi (ADR-189).
 *
 * ==================== PO CO TO ISTNIEJE ====================
 *
 * Strona sprzętu zaczyna się od STAŁEGO BLOKU (`ProductDetail`), a ten wnosi
 * WIDOCZNY `<h1>` z nazwą pozycji — bo dokumentem jest ta pozycja, nie sekcja,
 * którą operator postawił pod spodem. Treść z kreatora idzie POD blokiem i jest
 * dalszą częścią tego samego dokumentu, więc jej hero nie ma prawa wydać
 * DRUGIEGO `h1`: dwa nagłówki pierwszego poziomu to dwa konkurujące tytuły
 * jednego dokumentu, a czytnik ekranu nie ma czym ich rozstrzygnąć. Tę właśnie
 * wadę zgłosił audyt właściciela („ekran produktu ma dwa `h1`").
 *
 * ==================== DLACZEGO PRZEKSZTAŁCENIE TREŚCI, A NIE PROPS ====================
 *
 * Poziom nagłówka jest w treści (`level` elementu płótna), a nie w wyglądzie,
 * więc rozstrzygnięcie „który dokument ma tytuł" należy do WOŁAJĄCEGO: ta sama
 * lista sekcji na stronie treściowej jest całym dokumentem i tam `h1` jest
 * poprawny. Renderer zostaje bez nowego propsu i bez wiedzy o tym, kto go woła
 * — dokładnie jak przy `withAnchorBase` wyżej, które z tego samego powodu
 * przepisuje kotwice w treści, a nie w rendererze.
 *
 * ZMIANA JEST TYLKO SEMANTYCZNA. Klasa wyglądu nagłówka na płótnie idzie
 * z `level`, więc zejście na 2 zmienia też krój — i to jest świadome: nagłówek
 * sekcji POD tytułem strony ma wyglądać jak nagłówek sekcji. Geometria elementu
 * (`layout`) jest absolutna i nie zależy od poziomu, więc układ płótna zostaje
 * co do piksela.
 *
 * ZASIĘG: płótno v2, czyli JEDYNY kształt, w którym kreator zapisuje sekcję
 * nagłówkową (`sectionCanvasFrom` konwertuje każdą dodawaną sekcję, a szablon
 * strony sprzętu istnieje dopiero od fazy 5 — długo po K2). Sekcja
 * strukturalna v3 nie wydaje `h1` w żadnym układzie, a treść v1 nie ma jak
 * trafić do szablonu sprzętu.
 */
export function withDemotedHeadings(sections: PublishedSection[]): PublishedSection[] {
  return sections.map((section) => {
    if (!isSectionCanvas(section.content)) return section;
    const elements = section.content.elements.map((element) =>
      element.kind === "heading" && element.level === 1 ? { ...element, level: 2 as const } : element,
    );
    return { ...section, content: { ...section.content, elements } } as PublishedSection;
  });
}
