/**
 * Trasa joba rekoncyliacji — bramka autoryzacji (L11, ADR-104).
 *
 * DOWODZIMY NIE KODU ODPOWIEDZI, TYLKO BRAKU PRACY. Sam status 401 nie
 * wyklucza tego, że job zdążył odpytać dostawcę o cudze pieniądze i zapisać
 * stan, zanim handler zdecydował się odmówić. Dlatego każdy przypadek
 * negatywny sprawdza DWIE rzeczy: odmowę i to, że rdzeń NIE ZOSTAŁ WYWOŁANY
 * ANI RAZU.
 *
 * Rdzeń jest tu podstawiony atrapą, bo przedmiotem tej suity jest wyłącznie
 * bramka wejścia — samą pętlę na żywej bazie bada payment-reconciliation.test.ts.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const job = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/src/jobs/reconcile-payments", () => ({
  reconcilePayments: async () => {
    job.calls += 1;
    return {
      scanned: 0,
      settled: 0,
      expired: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      entries: [],
    };
  },
}));

const { GET } = await import("@/app/api/jobs/payment-reconciliation/route");

const SECRET = "sekret-crona-l11-0123456789";

function request(authorization?: string): Request {
  return new Request("https://panel.test/api/jobs/payment-reconciliation", {
    headers: authorization ? { authorization } : {},
  });
}

describe("trasa joba rekoncyliacji — autoryzacja", () => {
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
    // Ta sama długość, jeden znak inny: przypadek, który przechodzi przy
    // porównaniu po prefiksie i przy pomyłkowym `startsWith`.
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

    // Nawet „poprawny" nagłówek nie ma jak przejść, skoro nie ma z czym go
    // porównać. Pusty sekret nie może znaczyć „wpuszczaj wszystkich".
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(job.calls).toBe(0);
  });

  it("POPRAWNY sekret → 200 i rdzeń wywołany dokładnie raz", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(job.calls).toBe(1);
    await expect(response.json()).resolves.toMatchObject({ scanned: 0 });
  });
});

/**
 * HARMONOGRAM: DLACZEGO TEJ TRASY NIE MA W `vercel.json` (ADR-104).
 *
 * Rekomendacja zadania brzmiała „co 15 minut". Plan hostingu na to nie
 * pozwala i nie jest to kwestia gęstości, tylko LICZBY: dopuszcza DWA
 * zadania cron, wyłącznie dzienne — a oba sloty są zajęte przez sprzątanie
 * uploadów zdjęć (produktów i sekcji). Trzeci wpis nie „chodziłby rzadziej",
 * tylko wywracałby wdrożenie, a wpis dzienny nie miałby dokąd wejść.
 *
 * Dlatego trasa jest gotowa i zabezpieczona, ale NIEPODPIĘTA pod harmonogram,
 * a operator ma dziś ścieżkę natychmiastową (przycisk „sprawdź status
 * płatności"), która rozwiązuje właściwy problem: brak wyjścia z zakleszczenia.
 *
 * Ten test pilnuje, żeby powyższe pozostało DECYZJĄ, a nie przeoczeniem:
 * dopisanie crona bez zmiany planu pali go razem z wdrożeniem, a nie po nim.
 * Po przejściu na plan bez tego limitu należy dopisać do `vercel.json` wpis
 * ze ścieżką `/api/jobs/payment-reconciliation` i harmonogramem co 15 minut,
 * a potem poprawić ten test wraz z bliźniaczym w product-image-upload-cleanup.
 */
describe("harmonogram rekoncyliacji — bramka planu hostingu", () => {
  const crons = (
    JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string; schedule: string }[];
    }
  ).crons;

  it("konfiguracja mieści się w limicie: najwyżej dwa zadania, wszystkie dzienne", () => {
    expect(crons.length).toBeLessThanOrEqual(2);
    for (const cron of crons) {
      // Dzienny harmonogram ma konkretną minutę i godzinę — `*` albo `*/n`
      // na tych polach oznacza częstotliwość, której plan nie dopuszcza.
      expect(cron.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    }
  });

  it("rekoncyliacja NIE jest podpięta pod harmonogram — świadomie, nie przez pomyłkę", () => {
    expect(crons.map((cron) => cron.path)).not.toContain("/api/jobs/payment-reconciliation");
  });
});
