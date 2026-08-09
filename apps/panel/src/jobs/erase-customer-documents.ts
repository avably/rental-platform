import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@avably/db/service";

/**
 * Kasowanie plików umów przy realizacji żądania usunięcia danych klienta
 * (C2b, ADR-116, migracja 0056).
 *
 * PDF umowy jest NAJWIĘKSZĄ kopią danych osobowych w systemie: imię, adres,
 * dane do faktury i warunki najmu w jednym pliku. Anonimizacja, która zostawia
 * ten plik, nie jest anonimizacją.
 *
 * DLACZEGO TO NIE JEST SQL: `docs/konwencje-migracji.md` zabrania kasowania
 * `storage.objects` wprost z bazy — omija to warstwę zarządzającą obiektem
 * i rozjeżdża metadane z plikiem. Funkcja SQL zwraca więc same ŚCIEŻKI,
 * a bajty kasuje Storage API.
 *
 * DLACZEGO service_role: polityki bucketa `rental-contracts` (0026) pozwalają
 * sesji najemcy skasować wyłącznie WŁASNY, OSIEROCONY upload
 * (`owner = auth.uid()` ORAZ brak wiersza w `contract_documents`).
 * Zarejestrowanej umowy nie skasuje ŻADNA sesja — i tak ma być, bo umowa nie
 * może znikać jednym kliknięciem operatora. Jedyną drogą jest Storage API
 * kluczem serwisowym, a ten mieszka wyłącznie w `src/jobs/**`.
 *
 * KOLEJNOŚĆ: wołane PO udanym zapisie w bazie. Odwrotna zostawiałaby skasowane
 * umowy przy nietkniętych danych osobowych. Operacja jest idempotentna —
 * funkcja SQL oddaje ścieżki przy każdym wywołaniu, także powtórnym, więc
 * przerwane sprzątanie domyka się ponowieniem.
 */

const CONTRACT_BUCKET = "rental-contracts";

export interface ContractRemovalResult {
  /** Ile ścieżek zgłoszono do skasowania. */
  requested: number;
  /** Ile obiektów Storage faktycznie potwierdziło usunięcie. */
  removed: number;
}

export async function removeContractDocuments(
  paths: readonly string[],
  db?: SupabaseClient,
): Promise<ContractRemovalResult> {
  if (paths.length === 0) return { requested: 0, removed: 0 };

  const client = db ?? createServiceClient();
  const { data, error } = await client.storage.from(CONTRACT_BUCKET).remove([...paths]);

  // Błąd Storage NIE jest sukcesem: wołający musi móc powiedzieć operatorowi,
  // że pliki zostały, i ponowić operację.
  if (error) throw new Error(error.message);

  return { requested: paths.length, removed: (data ?? []).length };
}
