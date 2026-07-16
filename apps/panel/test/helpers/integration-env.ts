/**
 * Strażnik jawności testów integracyjnych.
 *
 * `describe.skipIf(!hasEnv)` wygasza testy po cichu: suita bez zmiennych
 * SUPABASE_LOCAL_* jest na zbiorczym wyniku tak samo zielona jak suita,
 * która naprawdę przebiegła. Ten moduł zamienia ciche pominięcie w decyzję:
 *
 *   - komplet zmiennych → testy biegną normalnie,
 *   - brak zmiennych + ALLOW_INTEGRATION_SKIP=1 → pominięcie JAWNE
 *     (vitest nadal raportuje „skipped", ale ktoś musiał o nie poprosić),
 *   - brak zmiennych bez flagi → czerwony test-strażnik z listą braków.
 *
 * Ta sama kopia żyje w packages/db/test/helpers i apps/storefront/test/helpers
 * — suity testowe apek i pakietów nie współdzielą kodu (wzorem powielanych
 * list REQUIRED_ENV); zmiany wprowadzać we wszystkich trzech.
 */
import { it } from "vitest";

export function integrationEnv(required: readonly string[]): boolean {
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length === 0) return true;

  if (process.env.ALLOW_INTEGRATION_SKIP !== "1") {
    it(`strażnik: testy integracyjne bez zmiennych ${missing.join(", ")}`, () => {
      throw new Error(
        [
          `Testy integracyjne zostałyby pominięte po cichu — brak zmiennych: ${missing.join(", ")}.`,
          "Uruchom lokalny Supabase (`supabase start` w packages/db) i wyeksportuj zmienne",
          "z `supabase status -o env` (patrz docs/konwencje-migracji.md), albo pomiń je",
          "jawnie: ALLOW_INTEGRATION_SKIP=1 pnpm test.",
        ].join("\n"),
      );
    });
  }

  return false;
}
