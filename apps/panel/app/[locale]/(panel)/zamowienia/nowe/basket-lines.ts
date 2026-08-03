/**
 * KOSZYK JAKO WIERSZE (R3-1c, uwagi właściciela 3 i 4).
 *
 * ================== DLACZEGO POZYCJA TO NADAL JEDNA SZTUKA ==================
 *
 * `order_items` NIE MA kolumny ilości — sprawdzone w bazie, nie założone:
 * tabela ma `product_id`, `unit_id`, `rental_grosze`, `deposit_grosze` i nic
 * poza tym. Dwie sztuki tego samego produktu to DWA wiersze, bo każdy z nich
 * dostaje własny egzemplarz (`unit_id`) i własną kwotę. Kontrakt wysyłki
 * kreatora (płaska lista `[{productId}]`) też się nie zmienia.
 *
 * „Ilość" jest więc WYŁĄCZNIE sposobem POKAZANIA i ZMIENIANIA tej listy:
 * operator widzi „Nagrzewnica × 3" zamiast trzech identycznych wierszy pod
 * sobą, a zmiana liczby dokłada albo zdejmuje sztuki. Gdyby ilość weszła do
 * modelu, trzeba by odpowiedzieć, jak jeden wiersz trzyma trzy egzemplarze —
 * a na to odpowiedzi nie ma ani w bazie, ani w silniku dostępności.
 *
 * Funkcje są CZYSTE i mieszkają osobno od komponentu, bo to jedyne miejsce,
 * w którym koszyk zmienia kształt: klamry ilości i kolejność wierszy dają się
 * tu przetestować bez renderu (`basket-lines.test.ts`).
 *
 * TERMINU PER POZYCJA NIE MA i nie jest to przeoczenie: termin (`start_date`,
 * `end_date`) siedzi na ZAMÓWIENIU, nie na pozycji, więc „inny termin dla
 * jednej pozycji" nie jest w tym modelu wyrażalny. Osobny termin = osobne
 * zamówienie (tak samo rozstrzyga to przedłużenie najmu).
 */

/** Najmniejsza sensowna ilość: wiersz z zerem to wiersz do usunięcia. */
export const BASKET_MIN_QUANTITY = 1;

/**
 * Górna klamra ilości w JEDNYM wierszu koszyka.
 *
 * To nie jest reguła biznesowa („nikt nie wynajmie 100 sztuk"), tylko
 * bezpiecznik pola liczbowego — bez niej wklejone „1000" tworzy tysiąc pozycji
 * i tysiąc wywołań wyceny, zanim ktokolwiek zdąży zauważyć literówkę.
 * Realną granicą i tak jest liczba wolnych egzemplarzy, którą ekran pokazuje
 * przy wierszu i o którą potyka się podgląd braków.
 */
export const BASKET_MAX_QUANTITY = 99;

export interface BasketLine {
  productId: string;
  quantity: number;
}

/**
 * Płaska lista sztuk → wiersze koszyka, w kolejności PIERWSZEGO wystąpienia
 * produktu. Kolejność pierwszego wystąpienia (a nie np. alfabetyczna) trzyma
 * wiersz w miejscu, w którym operator go dodał — lista, która sama się
 * przestawia po zmianie ilości, gubi kontekst kliknięcia.
 */
export function groupBasketLines(productIds: readonly string[]): BasketLine[] {
  const lines: BasketLine[] = [];
  const indexByProduct = new Map<string, number>();

  for (const productId of productIds) {
    const index = indexByProduct.get(productId);
    if (index === undefined) {
      indexByProduct.set(productId, lines.length);
      lines.push({ productId, quantity: 1 });
      continue;
    }
    lines[index]!.quantity += 1;
  }

  return lines;
}

/** Wiersze koszyka → płaska lista sztuk (kontrakt wysyłki, ADR-024). */
export function flattenBasketLines(lines: readonly BasketLine[]): string[] {
  return lines.flatMap((line) => Array.from({ length: line.quantity }, () => line.productId));
}

/**
 * Ilość z pola formularza → liczba sztuk albo `null`.
 *
 * `null` znaczy „to jeszcze nie jest liczba" (pusty string w trakcie
 * wpisywania) i wywołujący ma wtedy zostawić stan bez zmian — inaczej
 * skasowanie zawartości pola zdejmowałoby wiersz z koszyka w połowie edycji.
 * Wartość spoza klamry jest PRZYCINANA, a nie odrzucana: pole ilości ma
 * jeden oczywisty zakres i przycięcie widać od razu na ekranie (w odróżnieniu
 * od kwoty, gdzie przycięcie zapisałoby liczbę, której nikt nie wpisał).
 */
export function parseBasketQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;

  return clampQuantity(value);
}

/** Ilość wciśnięta w dozwolony zakres — jedyna klamra w całym koszyku. */
export function clampQuantity(value: number): number {
  if (value < BASKET_MIN_QUANTITY) return BASKET_MIN_QUANTITY;
  if (value > BASKET_MAX_QUANTITY) return BASKET_MAX_QUANTITY;
  return Math.trunc(value);
}

/**
 * Nowa lista sztuk po zmianie ilości JEDNEGO wiersza. Produkt spoza koszyka
 * nie zmienia niczego — akcja na wierszu, którego już nie ma (podwójny klik,
 * spóźnione zdarzenie), ma być bez skutku, a nie dokładać nowy wiersz.
 */
export function setLineQuantity(
  productIds: readonly string[],
  productId: string,
  quantity: number,
): string[] {
  const lines = groupBasketLines(productIds);
  if (!lines.some((line) => line.productId === productId)) return [...productIds];

  return flattenBasketLines(
    lines.map((line) =>
      line.productId === productId ? { ...line, quantity: clampQuantity(quantity) } : line,
    ),
  );
}

/** Usunięcie CAŁEGO wiersza (wszystkich sztuk produktu). */
export function removeLine(productIds: readonly string[], productId: string): string[] {
  return productIds.filter((id) => id !== productId);
}

/** Kwoty wiersza: suma po sztukach TEGO produktu — wyłącznie z wyceny silnika. */
export interface BasketLineAmounts {
  rentalGrosze: number;
  depositGrosze: number;
}

/**
 * Kwoty wierszy z wyceny silnika (`priceOrderItems`), zsumowane per produkt.
 *
 * Wejściem są WYCENIONE pozycje, nie cennik — komponent koszyka nie ma prawa
 * pomnożyć ceny dobowej przez liczbę dni, bo silnik liczy inaczej (progi
 * cenowe, mnożnik automatyczny) i druga ścieżka wyceny rozjechałaby się
 * z zamówieniem dokładnie tam, gdzie tenant ma niestandardowy cennik.
 * Jedyne działanie na wynikach silnika, jakie jest tu legalne, to dodawanie —
 * to samo rozstrzygnięcie, co przy sumach zamówienia (`pricing.ts`).
 */
export function sumLineAmounts(
  items: readonly { productId: string; rentalGrosze: number; depositGrosze: number }[],
): Map<string, BasketLineAmounts> {
  const byProduct = new Map<string, BasketLineAmounts>();

  for (const item of items) {
    const current = byProduct.get(item.productId) ?? { rentalGrosze: 0, depositGrosze: 0 };
    byProduct.set(item.productId, {
      rentalGrosze: current.rentalGrosze + item.rentalGrosze,
      depositGrosze: current.depositGrosze + item.depositGrosze,
    });
  }

  return byProduct;
}
