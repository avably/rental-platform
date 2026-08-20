/**
 * Trasa joba rekoncyliacji zwrotów kaucji w `pending` (Faza B — siatka na
 * zgubiony webhook `charge.refund.updated`).
 *
 * Autoryzacja 1:1 z pozostałymi jobami: `Bearer $CRON_SECRET` porównany
 * w CZASIE STAŁYM. Trasa stoi otworem na internet, a jej skutkiem jest
 * odczyt zwrotów u dostawcy i domknięcie rozliczenia kaucji — więc żadnej
 * ścieżki „bez sekretu, ale z lokalnego IP" tu nie ma. Brak skonfigurowanego
 * sekretu to 503, nie przepustka.
 *
 * ⚠ Rdzeń (`src/jobs/reconcile-deposit-refunds.ts`) domyka WYŁĄCZNIE Z ODCZYTU
 * i NIGDY nie inicjuje drugiego `POST /v1/refunds`. Plik trasy może eksportować
 * tylko handlery HTTP; rdzeń jest osobno, żeby dało się go zawołać z testu
 * z wstrzykniętym odczytem u dostawcy.
 */
import { cronAuthorized } from "@/src/jobs/cron-auth";
import { reconcileDepositRefunds } from "@/src/jobs/reconcile-deposit-refunds";

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
    return Response.json(await reconcileDepositRefunds());
  } catch (error) {
    // Do logu POWÓD, do odpowiedzi zdanie bez szczegółów: komunikat błędu
    // bazy albo dostawcy bywa echem żądania i potrafi nieść identyfikatory
    // (re_..., acct_...), których ta trasa nie ma prawa oddać.
    console.error("Rekoncyliacja zwrotów kaucji nie powiodła się.", error);
    return Response.json({ error: "Rekoncyliacja nie powiodła się." }, { status: 500 });
  }
}
