/**
 * Trasa joba rekoncyliacji płatności (L11, ADR-104).
 *
 * Autoryzacja 1:1 z jobami obrazkowymi: `Bearer $CRON_SECRET` porównany
 * w CZASIE STAŁYM. Ta trasa stoi otworem na internet, a jej skutkiem jest
 * odpytywanie dostawcy płatności o cudze pieniądze i zapis stanu rozliczeń
 * — więc żadnej ścieżki „bez sekretu, ale z lokalnego IP" tu nie ma i nie
 * będzie. Brak skonfigurowanego sekretu to 503, nie przepustka.
 *
 * Rdzeń mieszka w `src/jobs/reconcile-payments.ts`, bo plik trasy może
 * eksportować wyłącznie handlery HTTP, a ta ścieżka musi dać się zawołać
 * z testu z wstrzykniętym klientem bazy, odczytem u dostawcy i zegarem.
 */
import { timingSafeEqual } from "node:crypto";

import { reconcilePayments } from "@/src/jobs/reconcile-payments";

export const runtime = "nodejs";

/**
 * Porównanie odporne na atak czasowy. Różnica długości kończy się `false`
 * BEZ wołania `timingSafeEqual` — ta rzuca przy różnych długościach buforów,
 * a rzucony wyjątek zamieniłby odmowę w 500.
 */
function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "Job nie jest skonfigurowany." }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    return Response.json(await reconcilePayments());
  } catch (error) {
    // Do logu POWÓD, do odpowiedzi zdanie bez szczegółów: komunikat błędu
    // bazy albo dostawcy bywa echem żądania i potrafi nieść identyfikatory,
    // których ta trasa nie ma prawa oddać.
    console.error("Rekoncyliacja płatności nie powiodła się.", error);
    return Response.json({ error: "Rekoncyliacja nie powiodła się." }, { status: 500 });
  }
}
