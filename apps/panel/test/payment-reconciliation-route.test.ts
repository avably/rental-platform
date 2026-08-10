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
 * HARMONOGRAM: REKONCYLIACJA WRESZCIE CHODZI (ADR-130).
 *
 * Do odwołania jest nota, która stała tu wcześniej: że plan hostingu dopuszcza
 * DWA zadania cron, oba sloty zajmuje sprzątanie uploadów, więc rekoncyliacja
 * zostaje niepodpięta „świadomie". Limit liczby zadań dawno nie wynosi dwóch
 * (dziś 100 na projekt); wiążące są tylko częstotliwość — raz na dobę —
 * i precyzja ±59 min. Rekomendowane „co 15 minut" nadal jest poza zasięgiem
 * tego planu, ale RAZ DZIENNIE było w zasięgu przez cały czas.
 *
 * Skutek starej noty: pętla, która jest jedynym wyjściem z zakleszczenia
 * `payment_status='pending'` przy zgubionym webhooku, nie wykonała się ani
 * razu. Przycisk operatora („sprawdź status płatności") rozwiązuje przypadek
 * ZAUWAŻONY — a siatka bezpieczeństwa jest po to, żeby łapać niezauważone.
 *
 * Dziś rekoncyliację woła seria dzienna `/api/jobs/daily`, w której idzie
 * OSTATNIA: jest najdroższa (do stu odczytów u dostawcy przez sieć)
 * i najbardziej wznawialna, więc ucięcie budżetu boli ją najmniej.
 * Osiągalności każdego zadania pilnuje `daily-jobs-route.test.ts`.
 */
describe("harmonogram rekoncyliacji — przez serię dzienną", () => {
  const crons = (
    JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string; schedule: string }[];
    }
  ).crons;

  it("wszystkie wpisy są dzienne — częstszy wywraca wdrożenie, nie CI", () => {
    for (const cron of crons) {
      // Dzienny harmonogram ma konkretną minutę i godzinę — `*` albo `*/n`
      // na tych polach oznacza częstotliwość, której plan nie dopuszcza.
      expect(cron.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    }
  });

  it("rekoncyliacja JEST w serii dziennej, i to na końcu", async () => {
    const { DAILY_JOBS } = await import("@/src/jobs/daily-run");

    expect(DAILY_JOBS.at(-1)?.path).toBe("/api/jobs/payment-reconciliation");
    expect(crons.map((cron) => cron.path)).toContain("/api/jobs/daily");
  });
});
