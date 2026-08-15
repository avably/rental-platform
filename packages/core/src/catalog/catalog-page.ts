/**
 * STRONA KATALOGU `/katalog` — adres, rozmiar strony i arytmetyka stronicowania
 * (faza 4b, ADR-186, migracja 0085).
 *
 * ==================== CZEGO NIE BYŁO ====================
 *
 * Pełnej listy katalogu nie było w produkcie. Sekcja `products` pokazuje do
 * 24 pozycji (`PRODUCTS_LIMITS`) i odsyła „do katalogu" pod `/store` — czyli
 * pod adres WEWNĘTRZNY strony głównej, na której odwiedzający właśnie stoi.
 * Przy 200 pozycjach to nie jest niedoróbka odnośnika, tylko brakująca strona
 * sklepu: 176 pozycji oferty nie miało ani jednego adresu, pod którym da się
 * je przejrzeć.
 *
 * ==================== TRZY ROZSTRZYGNIĘCIA, KTÓRE ŻYJĄ W TYM PLIKU ====================
 *
 * 1. ROZMIAR STRONY JEST STAŁĄ, NIE PARAMETREM ADRESU. Gdyby liczba pozycji
 *    na stronie przychodziła z adresu, ten sam katalog miałby nieskończenie
 *    wiele podziałów na strony — czyli nieskończenie wiele adresów o tej samej
 *    treści. Wyszukiwarka indeksowałaby duplikaty, a klient dostawałby cudzy
 *    podział przy każdym wklejonym linku. Sufit `CATALOG_PAGE_MAX_SIZE` istnieje
 *    mimo to, bo bramka po stronie bazy nie może wierzyć wołającemu.
 *
 * 2. NUMER STRONY JEST PARAMETREM ZAPYTANIA, NIE SEGMENTEM ŚCIEŻKI.
 *    `/katalog/2` byłoby drugim segmentem pod `/katalog` — a to jest miejsce,
 *    którego jeszcze potrzebujemy (taksonomia katalogu, Faza 7). Parametr
 *    mówi przy tym prawdę o tym, czym jest: WIDOKIEM tej samej kolekcji, a nie
 *    inną stroną. Adres pozostaje linkowalny i indeksowalny w całości — pełny
 *    URL z parametrem jest adresem pierwszej klasy, a strony 2+ mają kanon
 *    wskazujący SAME SIEBIE (patrz `catalogPagePath`).
 *
 * 3. STRONA PIERWSZA NIE NOSI PARAMETRU. `/katalog?strona=1` i `/katalog` to
 *    ta sama treść, więc jeden z nich musi być kanonem — a kanonem jest adres
 *    krótszy, ten, który wkleja człowiek.
 */

/** Pierwszy segment adresu strony katalogu. */
export const CATALOG_PATH_SEGMENT = "katalog";

/**
 * Nazwa parametru numeru strony. Polska, bo sklep najemcy jest JEDNOJĘZYCZNY
 * (oś marketingowa `/pl` i `/en` to inna powierzchnia) — ten sam argument, co
 * przy segmencie `produkt` w ADR-182.
 */
export const CATALOG_PAGE_PARAM = "strona";

/**
 * ILE POZYCJI NA STRONIE — 24.
 *
 * Liczba nie jest wzięta z sufitu. Jest to (a) sufit sekcji sprzętu
 * (`PRODUCTS_LIMITS` kończy się na 24), więc katalog nie pokazuje na raz mniej
 * niż strona główna; (b) wielokrotność OBU szerokości siatki kafli (2 kolumny
 * poniżej 64 rem, 3 powyżej — `PRODUCT_GRID_STEPS`), więc każda strona poza
 * ostatnią domyka rzędy same z siebie; (c) rozmiar, przy którym koperta jednej
 * strony jest o rząd wielkości mniejsza od koperty katalogu — dla fikstury
 * pomiarowej ok. 27 KB wobec 227 KB.
 */
export const CATALOG_PAGE_SIZE = 24;

/**
 * SUFIT liczby pozycji, jaką wolno wyprosić JEDNYM odczytem strony katalogu —
 * LUSTRO zacisku w `app.get_public_catalog_page` (0085).
 *
 * Nie broni tajemnicy (katalog jest publiczny i `app.get_public_catalog` oddaje
 * go w całości), tylko ODPOWIEDZIALNOŚCI ODCZYTU: funkcja stronicująca ma
 * kosztować O(strony), a nie O(katalogu), niezależnie od tego, co poda
 * wołający. Dwukrotność rozmiaru strony zostawia zapas na zmianę
 * `CATALOG_PAGE_SIZE` bez migracji i nie otwiera drogi do „stronicowania"
 * po tysiąc pozycji na raz.
 */
export const CATALOG_PAGE_MAX_SIZE = 48;

/**
 * ADRES PUBLICZNY strony katalogu — JEDYNE miejsce, w którym numer strony
 * zamienia się w ścieżkę.
 *
 * Woła go trasa (kanon), odnośnik „zobacz cały katalog", nawigacja stron
 * i mapa strony. Ścieżka pisana z ręki w każdym z tych miejsc rozjechałaby się
 * przy pierwszej zmianie kształtu adresu — a rozjazd kanonu z linkiem to
 * duplikat, którego najemca nigdy nie zauważy sam (lekcja ADR-158).
 *
 * Numer ≤ 1 daje adres bez parametru, bo strona pierwsza go nie nosi
 * (rozstrzygnięcie 3 w nagłówku).
 */
export function catalogPagePath(page = 1): string {
  const base = `/${CATALOG_PATH_SEGMENT}`;
  return page > 1 ? `${base}?${CATALOG_PAGE_PARAM}=${page}` : base;
}

/**
 * ILE STRON MA KATALOG O `total` POZYCJACH — co najmniej JEDNA.
 *
 * Katalog pusty ma stronę pierwszą i to nie jest sztuczka arytmetyczna:
 * „katalog jest w przygotowaniu" jest treścią, którą trzeba komuś pokazać pod
 * adresem, do którego prowadzą linki. Zero stron znaczyłoby 404 na `/katalog`
 * u najemcy, który dopiero wprowadza sprzęt.
 */
export function catalogPageCount(total: number, pageSize = CATALOG_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Przesunięcie okna wyników dla strony `page` (1-based). */
export function catalogPageOffset(page: number, pageSize = CATALOG_PAGE_SIZE): number {
  return Math.max(0, (Math.max(1, Math.trunc(page)) - 1) * pageSize);
}

/**
 * NUMER STRONY Z PARAMETRU ADRESU — `null` znaczy „to nie jest numer strony".
 *
 * ==================== DLACZEGO `null`, A NIE CICHE 1 ====================
 *
 * Zwrócenie 1 dla `?strona=abc` (albo `0`, albo `-3`, albo `01`) zamieniłoby
 * KAŻDY ciąg znaków w prawidłowy adres tej samej treści. To nie jest tolerancja,
 * tylko wytwórnia duplikatów: jeden katalog dostawałby nieskończony zbiór
 * adresów, wszystkie indeksowalne, wszystkie z tą samą pierwszą stroną.
 * Wołający (trasa) zamienia `null` na 404 — adres, którego nie ma, ma nie
 * odpowiadać treścią.
 *
 * Forma KANONICZNA jest wymagana także w zapisie: `01` odpada, bo `String(1)`
 * to `"1"`. Bez tego `?strona=0000002` byłoby drugim adresem strony drugiej.
 *
 * Parametr powtórzony (`?strona=2&strona=3`) też odpada: Next oddaje wtedy
 * tablicę, a zgadywanie, który wpis jest „ten prawdziwy", jest zgadywaniem.
 */
export function parseCatalogPageParam(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return 1;
  if (typeof raw !== "string") return null;
  if (!/^[1-9][0-9]*$/.test(raw)) return null;

  const page = Number(raw);
  // Poza zakres bezpiecznych liczb całkowitych nie wchodzimy: `Number` zaokrągla
  // je po cichu, więc `String(page) === raw` przestaje być dowodem kanoniczności.
  if (!Number.isSafeInteger(page) || String(page) !== raw) return null;
  return page;
}
