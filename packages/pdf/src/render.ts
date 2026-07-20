import { renderToBuffer } from "@react-pdf/renderer";

import { ContractDocument } from "./contract-template";
import { registerFonts } from "./fonts";
import type { ContractPdfProps } from "./types";

/**
 * Renderuje umowę najmu do bajtów PDF z czystych danych wejściowych.
 *
 * Jedyny publiczny punkt wejścia pakietu (poza typem `ContractPdfProps`).
 * Bez bazy, bez sieci, bez wiedzy o tenantach — dostaje gotowy kontrakt
 * propsów i zwraca dokument. Zadanie Z7 woła dokładnie tę sygnaturę.
 *
 * `ContractDocument` wołamy jak funkcję, by na wejściu `renderToBuffer` znalazł
 * się element `<Document>` (typ `ReactElement<DocumentProps>`), a nie element
 * komponentu-opakowania o wymaganych propsach `ContractPdfProps`. Komponent nie
 * używa hooków, więc bezpośrednie wywołanie jest bezpieczne.
 */
export async function renderContractPdf(props: ContractPdfProps): Promise<Uint8Array> {
  registerFonts();
  const buffer = await renderToBuffer(ContractDocument(props));
  return new Uint8Array(buffer);
}
