/**
 * Trasa retencji treści wiadomości — bramka autoryzacji (C2b/R3, ADR-116).
 *
 * DOWODZIMY NIE KODU ODPOWIEDZI, TYLKO BRAKU PRACY. Status 401 sam z siebie
 * nie wyklucza, że przebieg zdążył wyczyścić treści wiadomości WSZYSTKICH
 * najemców, zanim handler zdecydował się odmówić — a tego skutku nie da się
 * cofnąć. Dlatego każdy przypadek negatywny sprawdza DWIE rzeczy: odmowę
 * i to, że rdzeń NIE ZOSTAŁ WYWOŁANY ANI RAZU.
 *
 * Rdzeń jest podstawiony atrapą — przedmiotem tej suity jest wyłącznie bramka
 * wejścia; samą funkcję na żywej bazie bada packages/db/test/customer-erasure.test.ts.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const job = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/src/jobs/purge-email-log-bodies", () => ({
  purgeEmailLogBodies: async () => {
    job.calls += 1;
    return { purged: 0, days: 90 };
  },
}));

const { GET } = await import("@/app/api/jobs/email-log-retention/route");

const SECRET = "sekret-crona-retencji-0123456789";

function request(authorization?: string): Request {
  return new Request("https://panel.test/api/jobs/email-log-retention", {
    headers: authorization ? { authorization } : {},
  });
}

describe("trasa retencji treści wiadomości — autoryzacja", () => {
  const previous = process.env.CRON_SECRET;

  beforeEach(() => {
    job.calls = 0;
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });

  it("BEZ nagłówka → 401 i zero pracy", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(job.calls).toBe(0);
  });

  it("ZŁY sekret → 401 i zero pracy", async () => {
    const response = await GET(request("Bearer zupelnie-inny-sekret"));

    expect(response.status).toBe(401);
    expect(job.calls).toBe(0);
  });

  it("sekret różniący się JEDNYM bajtem → 401 i zero pracy", async () => {
    const almost = `${SECRET.slice(0, -1)}X`;
    expect(almost).toHaveLength(SECRET.length);
    expect(almost).not.toBe(SECRET);

    const response = await GET(request(`Bearer ${almost}`));

    expect(response.status).toBe(401);
    expect(job.calls).toBe(0);
  });

  it("sekret będący PREFIKSEM poprawnego → 401 i zero pracy", async () => {
    const response = await GET(request(`Bearer ${SECRET.slice(0, -3)}`));

    expect(response.status).toBe(401);
    expect(job.calls).toBe(0);
  });

  it("sam sekret bez schematu `Bearer` → 401", async () => {
    const response = await GET(request(SECRET));

    expect(response.status).toBe(401);
    expect(job.calls).toBe(0);
  });

  it("BRAK skonfigurowanego sekretu → 503 i zero pracy (nigdy przepustka)", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(job.calls).toBe(0);
  });

  it("POPRAWNY sekret → 200 i rdzeń wywołany dokładnie raz", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(job.calls).toBe(1);
    await expect(response.json()).resolves.toMatchObject({ purged: 0, days: 90 });
  });
});

/**
 * HARMONOGRAM: DLACZEGO TEJ TRASY NIE MA W `vercel.json` (ADR-116).
 *
 * Ta sama bramka planu hostingu, która zatrzymała rekoncyliację płatności
 * (L11/ADR-104): plan dopuszcza DWA zadania cron, wyłącznie dzienne, a oba
 * sloty zajmuje sprzątanie uploadów zdjęć. Trzeci wpis nie „chodziłby
 * rzadziej", tylko wywracałby wdrożenie.
 *
 * Retencja znosi to lepiej niż rekoncyliacja: jest z natury okresowa i nic
 * nie traci na tym, że przebieg spóźni się o dzień — czyści to samo, tylko
 * później. Do czasu zmiany planu wywołuje ją harmonogram zewnętrzny albo
 * ręczne wywołanie trasy z sekretem.
 *
 * Ten test pilnuje, żeby powyższe pozostało DECYZJĄ, a nie przeoczeniem:
 * dopisanie crona bez zmiany planu pali CI, a nie produkcję.
 */
describe("harmonogram retencji — bramka planu hostingu", () => {
  const crons = (
    JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string; schedule: string }[];
    }
  ).crons;

  it("konfiguracja mieści się w limicie: najwyżej dwa zadania, wszystkie dzienne", () => {
    expect(crons.length).toBeLessThanOrEqual(2);
    for (const cron of crons) {
      expect(cron.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    }
  });

  it("retencja NIE jest podpięta pod harmonogram — świadomie, nie przez pomyłkę", () => {
    expect(crons.map((cron) => cron.path)).not.toContain("/api/jobs/email-log-retention");
  });
});
