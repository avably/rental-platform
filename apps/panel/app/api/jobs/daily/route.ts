/**
 * Trasa serii dziennej — JEDEN wpis crona, cztery zadania (ADR-130).
 *
 * Bramka wejścia jest 1:1 z trasami pojedynczymi: `Bearer $CRON_SECRET`
 * porównany w CZASIE STAŁYM, brak sekretu w środowisku to 503, a nie
 * przepustka. Drugiego mechanizmu tu nie ma z rozmysłu — ta trasa uruchamia
 * WSZYSTKIE cztery zadania naraz, więc jest najbardziej łakomym celem
 * w całym `app/api/jobs/`, a nie miejscem na wyjątek.
 *
 * ODMOWA JEST JEDNOLITA: brak nagłówka, zły sekret, sekret o innej długości
 * i sekret różniący się jednym bajtem dają dokładnie to samo 401 bez ciała
 * diagnostycznego. Żadna odpowiedź nie mówi, KTÓRA część była błędna —
 * inaczej trasa stałaby się wyrocznią do zgadywania sekretu.
 *
 * KOD ODPOWIEDZI NIESIE STAN SERII. 200 wyłącznie wtedy, gdy wszystkie cztery
 * zadania skończyły się `ok`; w każdym innym razie 500. To celowe: lista
 * wywołań crona w panelu hostingu pokazuje właśnie kod odpowiedzi, więc
 * przebieg, w którym rekoncyliacja padła, NIE MOŻE świecić na zielono.
 * Ciało odpowiedzi w obu przypadkach niesie wynik każdego zadania z osobna.
 */
import { cronAuthorized } from "@/src/jobs/cron-auth";
import { runDailyJobs } from "@/src/jobs/daily-run";

export const runtime = "nodejs";

/**
 * Limit czasu funkcji. Na planie Hobby 300 s jest ZARAZEM domyślną i maksymalną
 * wartością, więc ten wpis niczego dziś nie podnosi — zapisuje ZAŁOŻENIE,
 * na którym stoi budżet przebiegu (`DAILY_RUN_BUDGET_MS`). Gdyby platforma
 * kiedyś obniżyła domyślną wartość, seria nie zaczęłaby się po cichu urywać.
 */
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "Job nie jest skonfigurowany." }, { status: 503 });
  }
  if (!cronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  // `runDailyJobs` nie rzuca — awaria pojedynczego zadania jest jego własnym
  // wpisem w raporcie. `try/catch` zostaje mimo to, bo brak odpowiedzi byłby
  // gorszy niż jakakolwiek odpowiedź: cron bez ciała to przebieg, o którym
  // nie wiadomo nic.
  try {
    const report = await runDailyJobs();
    return Response.json(report, { status: report.ok ? 200 : 500 });
  } catch (error) {
    console.error("Seria dzienna nie powiodła się.", error);
    return Response.json({ error: "Seria dzienna nie powiodła się." }, { status: 500 });
  }
}
