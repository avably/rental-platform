/**
 * Stan widoczności sklepu dla ekranu po założeniu organizacji (M-UX-01,
 * audyt właściciela 17.08, ADR-193).
 *
 * Do tej naprawy ekran `/organizacja/nowa/gotowe` mówił STAŁĄ FRAZĄ „Sklep
 * jest już publiczny" — w chwili, w której świeży tenant nie ma ani jednego
 * produktu, ani opublikowanej strony głównej, więc pod adresem stoi pustka.
 * Zdanie pod adresem wynika odtąd ze STANU, liczonego z TYCH SAMYCH sygnałów
 * co karta „Zacznij tutaj" (`fetchStartCardSignals`) — celowo bez drugiej,
 * własnej wersji zapytania o publikację: semantyka „strona główna
 * opublikowana" (kind + slug_published, ADR-168/178) ma JEDNO miejsce prawdy
 * i tu jest wyłącznie konsumowana.
 *
 * Trzy stany (kolejność rozstrzygania od najmocniejszego faktu):
 *  1. `published`   — strona główna sklepu jest opublikowana; dopiero TU wolno
 *                     powiedzieć „sklep jest publiczny",
 *  2. `unpublished` — produkty są, ale strona główna nie jest opublikowana,
 *  3. `no-products` — zero produktów (stan świeżego konta).
 */
import type { StartCardSignals } from "@/lib/dashboard/start-card";

export type StoreVisibilityState = "published" | "unpublished" | "no-products";

export function storeVisibilityState(
  signals: Pick<StartCardSignals, "firstProductName" | "publishedAt">,
): StoreVisibilityState {
  if (signals.publishedAt !== null) return "published";
  if (signals.firstProductName !== null) return "unpublished";
  return "no-products";
}

/** Klucz zdania stanu w `organizationCreated.*` — jeden słownik na oba języki. */
export const STORE_STATE_MESSAGE_KEYS: Record<StoreVisibilityState, string> = {
  published: "storeStatePublished",
  unpublished: "storeStateUnpublished",
  "no-products": "storeStateNoProducts",
};
