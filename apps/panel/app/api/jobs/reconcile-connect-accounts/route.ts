/**
 * Trasa joba rekoncyliacji kont Connect (Faza B — siatka na zgubiony
 * `account.updated`).
 *
 * Autoryzacja 1:1 z pozostałymi jobami: `Bearer $CRON_SECRET` porównany
 * w CZASIE STAŁYM. Trasa stoi otworem na internet, a jej skutkiem jest
 * odpytywanie dostawcy o stan kont połączonych i zapis migawki gotowości —
 * więc żadnej ścieżki „bez sekretu, ale z lokalnego IP" tu nie ma. Brak
 * skonfigurowanego sekretu to 503, nie przepustka.
 *
 * Rdzeń mieszka w `src/jobs/reconcile-connect-accounts.ts`, bo plik trasy może
 * eksportować wyłącznie handlery HTTP, a ta ścieżka musi dać się zawołać
 * z testu z wstrzykniętym klientem bazy i odczytem u dostawcy.
 */
import { cronAuthorized } from "@/src/jobs/cron-auth";
import { reconcileConnectAccounts } from "@/src/jobs/reconcile-connect-accounts";

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
    return Response.json(await reconcileConnectAccounts());
  } catch (error) {
    // Do logu POWÓD, do odpowiedzi zdanie bez szczegółów: komunikat błędu
    // bazy albo dostawcy bywa echem żądania i potrafi nieść identyfikatory,
    // których ta trasa nie ma prawa oddać.
    console.error("Rekoncyliacja kont Connect nie powiodła się.", error);
    return Response.json({ error: "Rekoncyliacja nie powiodła się." }, { status: 500 });
  }
}
