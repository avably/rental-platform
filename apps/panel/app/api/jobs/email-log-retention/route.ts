import { cronAuthorized } from "@/src/jobs/cron-auth";
import { purgeEmailLogBodies } from "@/src/jobs/purge-email-log-bodies";

/**
 * Retencja treści wysłanych wiadomości (C2b/R3, ADR-116).
 *
 * HARMONOGRAM: woła ją SERIA DZIENNA `/api/jobs/daily` (ADR-130), w której
 * idzie pierwsza, bo jest najtańsza — jedno wywołanie funkcji bazy. Ta trasa
 * zostaje do wywołania RĘCZNEGO (diagnostyka, ponowienie po awarii serii).
 *
 * Stała tu wcześniej nota, że harmonogramu nie ma świadomie, bo plan hostingu
 * dopuszcza dwa zadania cron i oba zajmuje sprzątanie uploadów. Ten limit
 * dawno nie obowiązuje, a skutkiem noty było to, że kasowanie DRUGIEJ KOPII
 * danych osobowych klienta nie wykonało się ani razu. Uzasadnienie i lekcja:
 * ADR-130.
 */
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  // Brak konfiguracji NIGDY nie znaczy „wpuszczaj".
  if (!secret) {
    return Response.json({ error: "Job nie jest skonfigurowany." }, { status: 503 });
  }
  if (!cronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    return Response.json(await purgeEmailLogBodies());
  } catch (error) {
    console.error("Retencja treści wiadomości nie powiodła się.", error);
    return Response.json({ error: "Retencja nie powiodła się." }, { status: 500 });
  }
}
