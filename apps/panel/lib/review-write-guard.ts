/**
 * Bramka ZAPISU uwag przeglądu (ADR-206) — bez wymogu superadmina.
 *
 * ROZDZIAŁ ZAPIS/PRZEGLĄD. Właściciel przechodzi produkt ekran po ekranie
 * i zostawia uwagi także tam, gdzie NIKT nie jest zalogowany: rejestracja,
 * logowanie, onboarding organizacji. Wymóg sesji superadmina (reviewGuard)
 * blokował tam zapis z konstrukcji, więc ZAPIS (POST/PATCH uwagi) dostaje
 * własną, słabszą bramkę: REVIEW_MODE=1 (kill-switch) + rate limit po IP
 * (anty-spam). PRZEGLĄD zebranych uwag (GET, ekran /admin/przeglad-uwagi,
 * ingest) ZOSTAJE superadminowy — wszyscy zostawiają uwagi, tylko
 * właściciel je czyta. Tej granicy pilnują testy: zdjęcie superadmina
 * z ODCZYTU to regresja, nie feature.
 *
 * ŚWIADOME RYZYKO (zapisane w ADR-206): panel — inaczej niż storefront
 * (ADR-128, bramka VERCEL_ENV) — nie ma drugiej bramki środowiska, bo jego
 * rejestracja jest z definicji publiczna, a przegląd dotyczy także
 * produkcji. Gdy REVIEW_MODE=1, każdy kto dopisze ?review=1 może zostawić
 * komentarz. Model użycia: właściciel włącza flagę na czas przeglądu
 * i zdejmuje ją po nim; poza trybem endpoint odpowiada 404 i nie zdradza
 * istnienia (wzorzec reviewGuard).
 *
 * ZAPIS IDZIE service_rolem (szew app/api/review/client.ts), NIE klientem
 * sesji: RLS 0033 pozostaje superadminowe jako obrona w głąb (bezpośredni
 * dostęp do bazy dalej odbija — anon nie ma nawet grantów), a jedyną drogą
 * zapisu bez sesji superadmina jest ten kontrolowany endpoint. To brama
 * review, nie ścieżka żądań tenanta — dokładnie klasa wyjątku, którą
 * ADR-099 dopuszcza (wzorzec ingest/ADR-115).
 *
 * Kolejność sprawdzeń jest częścią kontraktu: kill-switch PRZED rate
 * limitem (wyłączone narzędzie nie pali budżetu limitu i nie zdradza się
 * odpowiedzią 429), rate limit PRZED parsowaniem multipart (limit ma
 * chronić także przed kosztem parsowania załączników do 8 MB).
 */
import { clientIpFromHeaders } from "@avably/security/client-ip";
import { REVIEW_COMMENT_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

import { getAuthContext } from "./auth";
import { createSupabaseServerClient } from "./supabase-server";

/** Progi anty-spamowe: seria uwag z jednego przeglądu mieści się z zapasem. */
export const REVIEW_WRITE_LIMIT = 30;
export const REVIEW_WRITE_WINDOW_SECONDS = 600;

export interface ReviewWriteContext {
  /**
   * Snapshot aktora do kolumny `created_by` (0033): id usera, gdy żądanie
   * niesie sesję (dowolną — nie tylko superadmina), null dla anonima.
   * To metadana, NIE bramka — dostęp rozstrzygają REVIEW_MODE i rate limit.
   */
  createdBy: string | null;
}

export async function reviewWriteGuard(request: Request): Promise<ReviewWriteContext | Response> {
  if (process.env.REVIEW_MODE !== "1") return new Response("Not Found", { status: 404 });

  // IP z zaufanego źródła (x-real-ip / ostatni hop XFF — L2, ADR-106);
  // bez nagłówków proxy wspólny kubełek "unknown" (fail-closed na ostro).
  const ip = clientIpFromHeaders(request.headers);
  const rateLimit = await checkRateLimit(`review-write:ip:${ip}`, {
    limit: REVIEW_WRITE_LIMIT,
    windowSeconds: REVIEW_WRITE_WINDOW_SECONDS,
    prefix: REVIEW_COMMENT_RATE_LIMIT_PREFIX,
  });
  if (!rateLimit.success) {
    // 429, nie 404: bramka trybu już przeszła, więc narzędzie jest jawnie
    // włączone — nakładka ma pokazać sensowną odmowę zamiast udawać brak.
    return Response.json({ error: "Za dużo uwag naraz. Odczekaj chwilę." }, { status: 429 });
  }

  let createdBy: string | null = null;
  try {
    const ctx = await getAuthContext(await createSupabaseServerClient());
    createdBy = ctx?.user.id ?? null;
  } catch {
    // Poza kontekstem żądania Next (`cookies()` rzuca) — brak snapshotu
    // aktora NIE zamyka zapisu: bramką dostępu są REVIEW_MODE + rate limit,
    // a `createdBy` zostaje przy wartości startowej null.
  }

  return { createdBy };
}
