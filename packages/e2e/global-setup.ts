import { mkdirSync, writeFileSync } from "node:fs";

import { seedTenant } from "./lib/seed";
import { ARTIFACTS_DIR, SEED_STATE_PATH } from "./lib/seed-state";

/**
 * Global setup Playwrighta: sieje środowisko (tenant + katalog + strona
 * sklepu + konto płatności) i zapisuje stan do pliku, z którego czytają
 * testy w procesach workerów.
 */
export default async function globalSetup(): Promise<void> {
  const state = await seedTenant();
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(SEED_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(`[e2e] zasiano tenanta ${state.slug} (${state.tenantId || "BEZ ZAPISU DO BAZY"})`);
}
