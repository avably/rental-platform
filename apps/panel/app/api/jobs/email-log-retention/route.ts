import { timingSafeEqual } from "node:crypto";

import { purgeEmailLogBodies } from "@/src/jobs/purge-email-log-bodies";

/**
 * Retencja treści wysłanych wiadomości (C2b/R3, ADR-116).
 *
 * HARMONOGRAMU W `vercel.json` NIE MA i to jest decyzja, nie przeoczenie —
 * dokładnie ta sama bramka planu hostingu, która zatrzymała rekoncyliację
 * płatności (L11/ADR-104): plan dopuszcza DWA zadania cron, oba sloty zajmuje
 * sprzątanie uploadów zdjęć. Trzeci wpis wywróciłby wdrożenie. Trasa jest
 * gotowa i zabezpieczona, wywołanie jest natychmiastowe z zewnątrz, a test
 * `email-log-retention-route.test.ts` pilnuje, żeby dopisanie crona bez zmiany
 * planu paliło CI, a nie produkcję.
 */
export const runtime = "nodejs";

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  // Brak konfiguracji NIGDY nie znaczy „wpuszczaj".
  if (!secret) {
    return Response.json({ error: "Job nie jest skonfigurowany." }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    return Response.json(await purgeEmailLogBodies());
  } catch (error) {
    console.error("Retencja treści wiadomości nie powiodła się.", error);
    return Response.json({ error: "Retencja nie powiodła się." }, { status: 500 });
  }
}
