/**
 * Bramka tras ingest uwag przeglądu (ADR-099/ADR-115).
 *
 * Panel przyjmuje uwagi przeglądu OD RELAYA storefrontu — jedynego miejsca,
 * które po ADR-099 nie ma już własnej drogi do bazy. Uwierzytelnieniem jest
 * wąski wspólny sekret (wzorzec CRON_SECRET z app/api/jobs/**): porównanie
 * stałoczasowe, 503 gdy sekret nieskonfigurowany (brak konfiguracji nigdy
 * nie znaczy „wpuszczaj"), 401 przy złym tokenie.
 *
 * REVIEW_MODE jest sprawdzany PO STRONIE PANELU, zanim spojrzymy na token:
 * relay „i tak nie zawoła" poza trybem przeglądu, ale endpoint dysponujący
 * kluczem omijającym RLS nie może polegać na grzeczności wołającego.
 * Wyłączony tryb przeglądu = 404 nawet z poprawnym tokenem — endpoint
 * znika na go-live razem z resztą narzędzia (wzorzec reviewGuard).
 *
 * Komunikaty odpowiedzi celowo nie nazywają zmiennych środowiskowych
 * (dyscyplina U1 — treści oddawane przeglądarce bez nazw konfiguracji).
 */
import { timingSafeEqual } from "node:crypto";

export function reviewIngestGuard(request: Request): Response | null {
  if (process.env.REVIEW_MODE !== "1") return new Response("Not Found", { status: 404 });

  const secret = process.env.REVIEW_INGEST_TOKEN;
  if (!secret) {
    return Response.json(
      { error: "Przyjmowanie uwag przeglądu nie jest skonfigurowane." },
      { status: 503 },
    );
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  return null;
}
