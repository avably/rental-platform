/**
 * Send Email Hook Supabase Auth — PIERWSZY webhook w projekcie (ADR-048).
 *
 * Cała logika (weryfikacja podpisu, mapowanie typu akcji, złożenie i wysyłka
 * wiadomości) mieszka w `lib/account-email-hook.ts`. Tutaj zostaje wyłącznie
 * spięcie z Next.js, bo plik `route.ts` może eksportować jedynie handlery HTTP
 * — a rdzeń musi dać się zawołać z testu z WSTRZYKNIĘTYM transportem i
 * sekretem (wzorzec `runProxy`).
 *
 * TRASA JEST PUBLICZNA I TAK MA BYĆ: woła ją GoTrue, nie zalogowany operator,
 * więc żaden guard sesji tu nie pasuje. Chroni ją PODPIS (Standard Webhooks),
 * fail-closed: bez poprawnego podpisu nie ma wysyłki, a bez skonfigurowanego
 * sekretu endpoint w ogóle nie działa. Klasyfikacja tej trasy jest pilnowana
 * przez bramkę `test/protected-routes.test.ts`.
 *
 * `force-dynamic`: żądanie niesie podpis liczony z surowego ciała i nagłówków,
 * więc nie ma tu czego prerenderować ani cache'ować.
 *
 * DZIENNIK KONT (ADR-054): to JEDYNE miejsce, które buduje klienta service-role
 * dla tej ścieżki. `@avably/db/service` wolno importować tylko w
 * app/api/webhooks/** (reguła no-restricted-imports) — rdzeń hooka dostaje
 * gotowy sink przez wstrzyknięcie i sam service-role nie dotyka.
 */
import { createServiceClient } from "@avably/db/service";

import {
  handleSendEmailHook,
  serviceRoleLogSink,
  type AccountEmailLogSink,
} from "@/lib/account-email-hook";

export const dynamic = "force-dynamic";

/**
 * Sink dziennika budowany LENIWIE i BEZPIECZNIE. Brak klucza sekretnego
 * Supabase (SUPABASE_SECRET_KEY, legacy SUPABASE_SERVICE_ROLE_KEY — ADR-142)
 * nie może wywrócić webhooka (mail leci mimo braku dziennika — ADR-054 D4):
 * createServiceClient rzuca przy braku klucza, więc łapiemy to i zwracamy
 * undefined (wysyłka bez logu), zostawiając ślad w logach serwera. Rozwiązanie
 * RAZ na proces — env nie pojawia się w trakcie życia procesu.
 */
let sinkResolved = false;
let cachedSink: AccountEmailLogSink | undefined;
function accountEmailLogSink(): AccountEmailLogSink | undefined {
  if (!sinkResolved) {
    sinkResolved = true;
    try {
      cachedSink = serviceRoleLogSink(createServiceClient());
    } catch (err) {
      console.warn(
        `[supabase-email] platformowy dziennik kont wyłączony — ` +
          `${err instanceof Error ? err.message : "brak konfiguracji service-role"}. ` +
          "Wysyłka działa; wpisy nie powstają (ADR-054).",
      );
      cachedSink = undefined;
    }
  }
  return cachedSink;
}

export async function POST(request: Request): Promise<Response> {
  return handleSendEmailHook(request, { logSink: accountEmailLogSink() });
}
