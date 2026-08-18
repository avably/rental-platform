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
  type PublishedSection,
  type PublishedSite,
} from "@avably/core/site";

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
