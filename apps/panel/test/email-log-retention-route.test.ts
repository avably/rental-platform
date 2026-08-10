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
 * HARMONOGRAM: TA TRASA JUŻ CHODZI — przez dyspozytora (ADR-130).
 *
 * DO ODWOŁANIA JEST NOTA, KTÓRA STAŁA TU WCZEŚNIEJ. Twierdziła, że plan
 * hostingu dopuszcza DWA zadania cron, oba zajęte przez sprzątanie uploadów,
 * więc retencja czeka na zmianę planu. Konsekwencja była taka, że retencja
 * treści wiadomości — czyli kasowanie DRUGIEJ KOPII danych osobowych klienta
 * — nie wykonała się ANI RAZU, a test pilnował, żeby tak zostało.
 *
 * Dwie rzeczy okazały się nieprawdą. Po pierwsze, limit liczby zadań dawno
 * nie wynosi dwóch (dziś 100 na projekt); wiążące są tylko częstotliwość
 * (raz na dobę) i precyzja (±59 min). Po drugie — i to jest lekcja
 * właściwa — „zadanie świadomie bez harmonogramu" po kilku miesiącach nie
 * różni się niczym od zadania zapomnianego.
 *
 * Dziś retencji NIE MA we wpisach crona nadal, ale z innego powodu: woła ją
 * seria dzienna `/api/jobs/daily`, w której jest pierwsza (najtańsza).
 * Osiągalności KAŻDEGO zadania z harmonogramu pilnuje test kompletności
 * w `daily-jobs-route.test.ts` — tu sprawdzamy tylko, że retencja jest
 * w serii i że nikt jej z niej po cichu nie wyjął.
 */
describe("harmonogram retencji — przez serię dzienną", () => {
  const crons = (
    JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string; schedule: string }[];
    }
  ).crons;

  it("wszystkie wpisy są dzienne — częstsze wywraca wdrożenie", () => {
    for (const cron of crons) {
      expect(cron.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    }
  });

  it("retencja JEST w serii dziennej — i to jest jej jedyny wyzwalacz", async () => {
    const { DAILY_JOBS } = await import("@/src/jobs/daily-run");

    expect(DAILY_JOBS.map((job) => job.path)).toContain("/api/jobs/email-log-retention");
    expect(crons.map((cron) => cron.path)).toContain("/api/jobs/daily");
  });
});
