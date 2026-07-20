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
 */
import { handleSendEmailHook } from "@/lib/account-email-hook";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleSendEmailHook(request);
}
