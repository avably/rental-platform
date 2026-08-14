/**
 * ZNAK NAJEMCY W UMOWIE — BAJTY, NIGDY ADRES (ADR-175).
 *
 * ============ DLACZEGO PAKIET NIE PRZYJMUJE ADRESU ============
 *
 * `@react-pdf/renderer` przyjąłby URL w `<Image src>` i POBRAŁBY go w chwili
 * renderu. To jest dokładnie ta zależność, której umowa mieć nie może: bucket
 * ze znakiem stoi po drugiej stronie sieci, jego niedostępność wpięłaby się
 * w środek generowania dokumentu, a `fetch` w tej bibliotece nie ma limitu
 * czasu — wolno odpowiadający zasób zawiesiłby generowanie umowy na czas,
 * którego nikt nie ogranicza. Umowa, która przestaje powstawać, blokuje najem;
 * obraz jest w niej ozdobą względem tej funkcji.
 *
 * Dlatego kontrakt propsów niesie GOTOWE BAJTY (base64) i format. Sieć zostaje
 * po stronie wołającego, gdzie ma limit czasu i gdzie porażka ma dokąd
 * zdegradować: do nazwy najemcy tekstem.
 *
 * ============ DLACZEGO FORMATY SĄ WĘŻSZE NIŻ W MODELU ZNAKU ============
 *
 * `siteLogoSchema` (ADR-160) dopuszcza cztery typy rastrowe: jpg, png, webp,
 * avif. `@react-pdf` dekoduje DWA: PNG i JPEG. Reszty nie odrzuca głośno —
 * wypisuje ostrzeżenie na konsolę i rysuje dokument BEZ OBRAZU. Efektem jest
 * dziura w nagłówku, czyli dokładnie ta „pusta ramka”, której zakazuje
 * rozstrzygnięcie o fallbacku. Skoro biblioteka nie umie odmówić użytecznie,
 * odmawia ta bramka — a dokument dostaje wtedy nazwę tekstem.
 *
 * SVG nie ma tu nawet gałęzi: nie przeszedł już wzorca ścieżki w modelu znaku
 * (aktywny dokument z publicznego bucketa = składowany XSS, ADR-160).
 */

/** Formaty, które renderer PDF potrafi zdekodować. */
export const CONTRACT_LOGO_FORMATS = ["png", "jpg"] as const;
export type ContractLogoFormat = (typeof CONTRACT_LOGO_FORMATS)[number];

/**
 * Znak najemcy w propsach umowy: bajty w base64 + format. Brak tego pola
 * znaczy „najemca nie ma znaku ALBO nie udało się go pobrać" — dla dokumentu
 * to jedno i to samo, bo obie odpowiedzi kończą się tym samym fallbackiem.
 */
export interface ContractLogo {
  /** Zawartość pliku w base64, BEZ przedrostka `data:` — sam ładunek. */
  data: string;
  format: ContractLogoFormat;
}

/**
 * Format wynikający z rozszerzenia ścieżki w buckecie, albo `null`.
 *
 * Wołający pyta o to PRZED pobraniem pliku: znak w webp/avif i tak nie wejdzie
 * do dokumentu, więc ściąganie go byłoby transferem po nic. `jpeg` i `jpg` to
 * ten sam format — wzorzec ścieżki (ADR-160) zapisuje wyłącznie `jpg`, ale
 * rozpoznajemy oba, żeby zmiana wzorca nie zgasiła znaku po cichu.
 */
export function contractLogoFormat(path: string): ContractLogoFormat | null {
  const extension = path.toLowerCase().split(".").pop();
  if (extension === "png") return "png";
  if (extension === "jpg" || extension === "jpeg") return "jpg";
  return null;
}

/** Sygnatury plików — pierwsze bajty, po których format rozpoznaje się PEWNIE. */
const MAGIC: Record<ContractLogoFormat, readonly number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
};

/**
 * Znaczniki KOŃCA pliku: `IEND` z sumą kontrolną (PNG) i `EOI` (JPEG).
 *
 * Sprawdzamy je, bo najczęstsza awaria pobierania nie brudzi początku pliku,
 * tylko go UCINA — zerwane połączenie w połowie transferu daje ładunek
 * z nienaganną sygnaturą i bez końca. Sam nagłówek przepuściłby taki plik do
 * dokumentu, gdzie renderer wypisałby „Incomplete or corrupt PNG file" na
 * konsoli i zostawił pustą ramkę w nagłówku umowy.
 */
const TRAILER: Record<ContractLogoFormat, readonly number[]> = {
  png: [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
  jpg: [0xff, 0xd9],
};

function startsWith(data: Buffer, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => data[index] === byte);
}

function endsWith(data: Buffer, bytes: readonly number[]): boolean {
  const offset = data.length - bytes.length;
  return bytes.every((byte, index) => data[offset + index] === byte);
}

/**
 * Bajty gotowe dla `<Image src>` albo `null` — jedyna droga znaku do dokumentu.
 *
 * ============ DLACZEGO TO SPRAWDZENIE ISTNIEJE ============
 *
 * Bo `@react-pdf` nie rzuca na uszkodzonym pliku. Ładunek z poprawną sygnaturą
 * i śmieciami dalej daje ostrzeżenie „Incomplete or corrupt PNG file” na
 * konsoli i dokument BEZ obrazu — czyli awarię, której nie widzi ani wołający,
 * ani test asercji na wyjątku. Deklarowany format bez pokrycia w bajtach
 * (`format: "png"` przy pliku JPEG) kończy się tak samo.
 *
 * Sprawdzamy więc to, co da się sprawdzić TANIO i PEWNIE: czy zadeklarowany
 * format jest na liście, czy ładunek ma sensowną długość i czy zaczyna się
 * ORAZ kończy znacznikami tego formatu. Dekodowaniem obrazu to nie jest i nie
 * udaje nim być — plik z uszkodzoną SREDNIĄ CZĘŚCIĄ dalej przejdzie. Zdejmuje
 * jednak całą klasę awarii, które zdarzają się naprawdę: zły format, pusty
 * ładunek, HTML strony błędu zamiast obrazu i — najczęstszą — ucięty transfer.
 */
export function contractLogoImage(
  logo: ContractLogo | undefined,
): { data: Buffer; format: ContractLogoFormat } | null {
  if (!logo) return null;
  if (!CONTRACT_LOGO_FORMATS.includes(logo.format)) return null;

  const data = Buffer.from(logo.data, "base64");
  const magic = MAGIC[logo.format];
  const trailer = TRAILER[logo.format];
  if (data.length <= magic.length + trailer.length) return null;
  if (!startsWith(data, magic) || !endsWith(data, trailer)) return null;

  return { data, format: logo.format };
}
