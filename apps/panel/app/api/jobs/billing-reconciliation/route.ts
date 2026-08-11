/**
 * Trasa joba rekoncyliacji subskrypcji SaaS (J2 faza 2a, ADR-136).
 *
 * Autoryzacja 1:1 z pozostałymi jobami: `Bearer $CRON_SECRET` porównany
 * w CZASIE STAŁYM; brak sekretu = 503, nie przepustka. Skutkiem trasy jest
 * odczyt subskrypcji u dostawcy i zapis stanu rozliczeniowego tenantów —
 * żadnej furtki „z lokalnego IP" nie ma i nie będzie.
 *
 * Wołana z serii dziennej (ADR-130, wpis w DAILY_JOBS) — trasa pojedyncza
 * zostaje do ręcznego uruchomienia (diagnostyka, ponowienie po awarii).
 * Rdzeń w `src/jobs/reconcile-billing.ts`: plik trasy eksportuje wyłącznie
 * handler HTTP, a rdzeń daje się zawołać z testu z wstrzykniętym klientem
 * bazy i odczytem u dostawcy.
 */
import { cronAuthorized } from "@/src/jobs/cron-auth";
import { reconcileBilling } from "@/src/jobs/reconcile-billing";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "Job nie jest skonfigurowany." }, { status: 503 });
  }
  if (!cronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    return Response.json(await reconcileBilling());
  } catch (error) {
    // Do logu powód pełny, do odpowiedzi zdanie bez szczegółów (echo błędu
    // dostawcy/bazy potrafi nieść cudze identyfikatory).
    console.error("Rekoncyliacja subskrypcji SaaS nie powiodła się.", error);
    return Response.json({ error: "Rekoncyliacja nie powiodła się." }, { status: 500 });
  }
}
