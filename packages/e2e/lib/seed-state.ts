import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stan zasiany przed przebiegiem — jedyny kanał między global-setupem
 * (proces Node) a testami (osobne procesy workerów Playwrighta). Plik na
 * dysku, nie zmienna: workerzy nie współdzielą pamięci z setupem.
 */
export type SeedState = {
  /** Slug tenanta; unikalny per przebieg, żeby współdzielona lokalna baza,
   * negatywny cache rozwiązywania hosta (30 s) i limity checkoutu
   * (30/tenant/h) nigdy nie przeciekały między przebiegami. */
  slug: string;
  tenantId: string;
  ownerEmail: string;
  ownerPassword: string;
  productId: string;
  productName: string;
  priceDayGrosze: number;
  unitCount: number;
  pickupLocationName: string;
  /** Identyfikator konta Connect w `payment_accounts` — stub API płatności
   * odpowiada dla niego stanem „gotowe do obciążeń". */
  providerAccountId: string;
};

const HERE = dirname(fileURLToPath(import.meta.url));
export const ARTIFACTS_DIR = join(HERE, "..", ".artefakty");
export const SEED_STATE_PATH = join(ARTIFACTS_DIR, "seed-state.json");

export function readSeedState(): SeedState {
  try {
    return JSON.parse(readFileSync(SEED_STATE_PATH, "utf8")) as SeedState;
  } catch (error) {
    throw new Error(
      `Nie mogę odczytać stanu seeda (${SEED_STATE_PATH}) — global-setup nie zasiał ` +
        `środowiska? Szczegół: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
