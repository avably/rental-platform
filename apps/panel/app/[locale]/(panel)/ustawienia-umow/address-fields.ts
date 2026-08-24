/**
 * Rozbicie/złożenie adresu firmy (uwaga właściciela #1).
 *
 * ══ DLACZEGO NIE MIGRACJA ══
 *
 * `contract_document` ma sztywny CHECK pięciu kluczy (0026): `address` to
 * JEDEN łańcuch (1–500 znaków), a klauzula `value - array[...] = '{}'` odrzuca
 * KAŻDY dodatkowy klucz — nie da się dopisać `street`/`zip`/`city` bez zmiany
 * kontraktu, który współdzieli szablon PDF (`preview.ts` czyta `settings.address`).
 * Dlatego kanonem zostaje pojedynczy `address`, a rozbicie na pola żyje
 * WYŁĄCZNIE w UI: formularz składa trzy pola w jedną linię przy zapisie
 * (`composeAddress`) i rozbija zapisany łańcuch przy wejściu (`parseAddress`).
 * Zero zmian schematu, zero ruchu w szablonie umowy.
 *
 * ══ FORMAT KANONICZNY ══
 *
 * "ulica i numer, kod miejscowość" — dokładnie ten sam kształt, który składa
 * `lookupCompanyByNipAction` z rejestru (`street`, `zip city`), więc adres
 * pobrany z GUS i adres wpisany ręcznie zapisują się identycznie.
 *
 * ══ PARSOWANIE JEST BEZSTRATNE ══
 *
 * `parseAddress` nigdy nie gubi znaków: kiedy ogona nie da się rozpoznać jako
 * „kod miejscowość", CAŁY oryginał ląduje w polu „ulica i numer". Złożenie
 * takiego stanu z powrotem oddaje ten sam łańcuch — round-trip jest stabilny
 * także dla adresów spoza wzorca (pilnuje tego test contract-address-fields).
 */

export interface AddressFields {
  street: string;
  zip: string;
  city: string;
}

/** Polski kod pocztowy na początku ogona: "09-411 Płock" → ["09-411", "Płock"]. */
const POSTAL_PREFIX = /^(\d{2}-\d{3})\s+(.+)$/;

/**
 * Trzy pola → kanoniczny łańcuch. Puste segmenty wypadają, więc sam adres
 * ulicy (bez kodu/miasta) składa się do samej ulicy, a nie do "ulica, ".
 * Wynik pusty dla pustych pól — walidacja `address` (min 1) domyka to po
 * stronie serwera dokładnie tym samym komunikatem co dotąd.
 */
export function composeAddress(fields: AddressFields): string {
  const locality = [fields.zip.trim(), fields.city.trim()].filter(Boolean).join(" ");
  return [fields.street.trim(), locality].filter(Boolean).join(", ");
}

/**
 * Kanoniczny łańcuch → trzy pola. Rozdziela po OSTATNIM przecinku (numer lokalu
 * „ul. Kwiatowa 5, m. 3" zostaje przy ulicy), a ogon uznaje za „kod miasto"
 * tylko wtedy, gdy zaczyna się polskim kodem pocztowym. W innym razie oddaje
 * cały oryginał w polu „ulica i numer" — nic nie ginie.
 */
export function parseAddress(address: string | null | undefined): AddressFields {
  const value = (address ?? "").trim();
  if (!value) return { street: "", zip: "", city: "" };

  const lastComma = value.lastIndexOf(",");
  if (lastComma === -1) return { street: value, zip: "", city: "" };

  const head = value.slice(0, lastComma).trim();
  const tail = value.slice(lastComma + 1).trim();
  const match = POSTAL_PREFIX.exec(tail);
  if (head && match) return { street: head, zip: match[1], city: match[2].trim() };

  return { street: value, zip: "", city: "" };
}
