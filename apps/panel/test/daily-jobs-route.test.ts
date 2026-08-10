/**
 * Seria dzienna — dyspozytor zadań cyklicznych (ADR-130).
 *
 * Ta suita pilnuje CZTERECH osi, z których każda odpowiada za inną awarię:
 *
 *   1. BRAMKA WEJŚCIA — jak w trasach pojedynczych, ale stawka jest wyższa:
 *      ta trasa uruchamia wszystkie cztery zadania. Każdy przypadek negatywny
 *      dowodzi NIE KODU ODPOWIEDZI, TYLKO BRAKU PRACY: 401 nic nie znaczy,
 *      jeśli seria zdążyła się wykonać, zanim handler odmówił.
 *   2. ODPORNOŚĆ — awaria jednego zadania nie może zabrać pozostałych,
 *      a odpowiedź musi ją ODNOTOWAĆ. „200 OK" bez wyniku per zadanie
 *      wygląda jak dowód, a nim nie jest.
 *   3. BUDŻET CZASU — przekroczenie ma kończyć się jawnym raportem, a nie
 *      pracą uciętą w losowym miejscu i zabitą funkcją bez odpowiedzi.
 *   4. KOMPLETNOŚĆ — patrz nagłówek ostatniego bloku. To ta oś, której brak
 *      pozwolił dwóm gotowym zadaniom przeleżeć bez wyzwalacza.
 */
import { readFileSync, readdirSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rdzenie zadań podstawione atrapami — przedmiotem tej suity jest DYSPOZYTOR,
 * nie praca, którą woła (tę badają suity poszczególnych zadań). Rejestr
 * `DAILY_JOBS` pozostaje PRAWDZIWY: gdyby był atrapą, test kompletności
 * dowodziłby zgodności atrapy z atrapą.
 */
const cores = vi.hoisted(() => ({
  purgeEmailLogBodies: vi.fn(),
  cleanupSiteImageUploads: vi.fn(),
  cleanupProductImageUploads: vi.fn(),
  reconcilePayments: vi.fn(),
}));

vi.mock("@/src/jobs/purge-email-log-bodies", () => ({
  purgeEmailLogBodies: cores.purgeEmailLogBodies,
}));
vi.mock("@/src/jobs/cleanup-site-image-uploads", () => ({
  cleanupSiteImageUploads: cores.cleanupSiteImageUploads,
}));
vi.mock("@/src/jobs/cleanup-product-image-uploads", () => ({
  cleanupProductImageUploads: cores.cleanupProductImageUploads,
}));
vi.mock("@/src/jobs/reconcile-payments", () => ({
  reconcilePayments: cores.reconcilePayments,
}));

const { GET } = await import("@/app/api/jobs/daily/route");
const { DAILY_JOBS, DAILY_RUN_BUDGET_MS, runDailyJobs } = await import("@/src/jobs/daily-run");

const SECRET = "sekret-crona-serii-dziennej-0123456789";

function request(authorization?: string): Request {
  return new Request("https://panel.test/api/jobs/daily", {
    headers: authorization ? { authorization } : {},
  });
}

/** Ile razy w sumie ruszyła JAKAKOLWIEK praca. */
function totalCalls(): number {
  return Object.values(cores).reduce((sum, core) => sum + core.mock.calls.length, 0);
}

const previousSecret = process.env.CRON_SECRET;

beforeEach(() => {
  for (const core of Object.values(cores)) {
    core.mockReset();
    core.mockResolvedValue({ done: true });
  }
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

describe("seria dzienna — bramka autoryzacji", () => {
  it("BEZ nagłówka → 401 i zero pracy", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(totalCalls()).toBe(0);
  });

  it("ZŁY sekret → 401 i zero pracy", async () => {
    const response = await GET(request("Bearer zupelnie-inny-sekret"));

    expect(response.status).toBe(401);
    expect(totalCalls()).toBe(0);
  });

  it("sekret różniący się JEDNYM bajtem → 401 i zero pracy", async () => {
    const almost = `${SECRET.slice(0, -1)}X`;
    expect(almost).toHaveLength(SECRET.length);
    expect(almost).not.toBe(SECRET);

    const response = await GET(request(`Bearer ${almost}`));

    expect(response.status).toBe(401);
    expect(totalCalls()).toBe(0);
  });

  it("sekret będący PREFIKSEM poprawnego → 401 i zero pracy", async () => {
    const response = await GET(request(`Bearer ${SECRET.slice(0, -3)}`));

    expect(response.status).toBe(401);
    expect(totalCalls()).toBe(0);
  });

  it("sam sekret bez schematu `Bearer` → 401 i zero pracy", async () => {
    const response = await GET(request(SECRET));

    expect(response.status).toBe(401);
    expect(totalCalls()).toBe(0);
  });

  it("BRAK skonfigurowanego sekretu → 503 i zero pracy (nigdy przepustka)", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(totalCalls()).toBe(0);
  });

  it("odmowa jest JEDNOLITA — brak nagłówka i zły sekret nie różnią się niczym", async () => {
    const withoutHeader = await GET(request());
    const withWrongSecret = await GET(request("Bearer zupelnie-inny-sekret"));

    expect(withoutHeader.status).toBe(withWrongSecret.status);
    await expect(withoutHeader.json()).resolves.toEqual(await withWrongSecret.json());
  });
});

describe("seria dzienna — przebieg udany", () => {
  it("POPRAWNY sekret → 200, każdy rdzeń wywołany DOKŁADNIE RAZ", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    for (const [name, core] of Object.entries(cores)) {
      expect(core, `rdzeń ${name}`).toHaveBeenCalledTimes(1);
    }
  });

  it("odpowiedź niesie wynik KAŻDEGO zadania — nazwa, status, czas", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));
    const body = (await response.json()) as {
      ok: boolean;
      ms: number;
      jobs: { name: string; path: string; status: string; ms: number; detail?: unknown }[];
    };

    expect(body.ok).toBe(true);
    expect(body.jobs).toHaveLength(DAILY_JOBS.length);
    for (const entry of body.jobs) {
      expect(entry.status).toBe("ok");
      expect(entry.name).toBeTruthy();
      expect(entry.path).toMatch(/^\/api\/jobs\//);
      expect(typeof entry.ms).toBe("number");
      // Ładunek rdzenia wraca w odpowiedzi — bez niego „ok" nie niesie liczb.
      expect(entry.detail).toEqual({ done: true });
    }
  });
});

describe("seria dzienna — odporność", () => {
  it("awaria JEDNEGO zadania NIE ubija pozostałych", async () => {
    cores.cleanupSiteImageUploads.mockRejectedValue(new Error("Storage niedostępny."));

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = (await response.json()) as { ok: boolean; jobs: { name: string; status: string }[] };

    // Trzy pozostałe rdzenie WYKONANE mimo awarii drugiego w kolejności.
    expect(cores.purgeEmailLogBodies).toHaveBeenCalledTimes(1);
    expect(cores.cleanupProductImageUploads).toHaveBeenCalledTimes(1);
    expect(cores.reconcilePayments).toHaveBeenCalledTimes(1);

    // ...i odpowiedź to ODNOTOWUJE, zamiast milczeć.
    expect(body.ok).toBe(false);
    const failed = body.jobs.find((entry) => entry.name === "site-image-uploads");
    expect(failed?.status).toBe("failed");
    expect(body.jobs.filter((entry) => entry.status === "ok")).toHaveLength(3);
    expect(body.jobs).toHaveLength(DAILY_JOBS.length);
  });

  it("awaria zadania daje 500 — przebieg z padniętym zadaniem NIE świeci na zielono", async () => {
    cores.reconcilePayments.mockRejectedValue(new Error("Dostawca nie odpowiada."));

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(500);
  });

  it("awaria KAŻDEGO zadania z osobna zostawia pozostałe trzy wykonane", async () => {
    for (const target of Object.keys(cores) as (keyof typeof cores)[]) {
      for (const core of Object.values(cores)) {
        core.mockReset();
        core.mockResolvedValue({ done: true });
      }
      cores[target].mockRejectedValue(new Error("awaria"));

      const response = await GET(request(`Bearer ${SECRET}`));
      const body = (await response.json()) as { jobs: { status: string }[] };

      for (const [name, core] of Object.entries(cores)) {
        expect(core, `${target} padło, a ${name} nie ruszyło`).toHaveBeenCalledTimes(1);
      }
      expect(body.jobs.filter((entry) => entry.status === "ok"), `padło ${target}`).toHaveLength(3);
    }
  });

  it("komunikat awarii NIE wycieka do odpowiedzi, ale TRAFIA do logu", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // Komunikat bazy/dostawcy bywa echem żądania i potrafi nieść cudze
    // identyfikatory — do ciała odpowiedzi nie ma wstępu.
    cores.reconcilePayments.mockRejectedValue(new Error("pi_1234_TAJNE_ID_KLIENTA"));

    const response = await GET(request(`Bearer ${SECRET}`));
    const raw = await response.text();

    expect(raw).not.toContain("pi_1234_TAJNE_ID_KLIENTA");
    expect(raw).toContain("payment-reconciliation");
    // ...a powód jest odczytywalny z logu funkcji, bez zgadywania.
    expect(logged.mock.calls.flat().map(String).join(" ")).toContain("pi_1234_TAJNE_ID_KLIENTA");
  });
});

describe("seria dzienna — budżet czasu", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("zadanie przekraczające swój limit dostaje `timeout`, a NASTĘPNE i tak rusza", async () => {
    const started: string[] = [];
    const report = await runDailyJobs({
      budgetMs: 10_000,
      jobs: [
        {
          name: "wolne",
          path: "/api/jobs/wolne",
          budgetMs: 20,
          run: async () => {
            started.push("wolne");
            await sleep(500);
            return { done: true };
          },
        },
        {
          name: "szybkie",
          path: "/api/jobs/szybkie",
          budgetMs: 1_000,
          run: async () => {
            started.push("szybkie");
            return { done: true };
          },
        },
      ],
    });

    expect(report.jobs[0]?.status).toBe("timeout");
    expect(report.jobs[1]?.status).toBe("ok");
    expect(started).toEqual(["wolne", "szybkie"]);
    expect(report.ok).toBe(false);
  });

  it("po wyczerpaniu budżetu przebiegu zadanie jest `skipped` i NIE ZOSTAJE URUCHOMIONE", async () => {
    // To jest sedno „przekroczenie nie zostawia pracy w połowie": zadania,
    // którego nie ma jak dokończyć, w ogóle nie zaczynamy.
    const nieruszone = vi.fn(async () => ({ done: true }));
    const report = await runDailyJobs({
      budgetMs: 30,
      jobs: [
        {
          name: "pozeracz",
          path: "/api/jobs/pozeracz",
          budgetMs: 10_000,
          run: async () => {
            await sleep(80);
            return { done: true };
          },
        },
        {
          name: "nieruszone",
          path: "/api/jobs/nieruszone",
          budgetMs: 1_000,
          run: nieruszone,
        },
      ],
    });

    expect(nieruszone).not.toHaveBeenCalled();
    expect(report.jobs[1]?.status).toBe("skipped");
    expect(report.jobs[1]?.ms).toBe(0);
    // Pominięcie jest WIDOCZNE — nie znika z raportu.
    expect(report.jobs[1]?.error).toMatch(/[Bb]udżet/);
    expect(report.jobs).toHaveLength(2);
    expect(report.ok).toBe(false);
  });

  it("porzucone zadanie NIE wywraca przebiegu późnym odrzuceniem", async () => {
    // Obietnica, która odrzuca JUŻ PO przegranej z limitem czasu.
    //
    // UCZCIWIE O SILE TEGO TESTU: nie da się go zapalić przez uproszczenie
    // `withTimeout`, bo `Promise.race` subskrybuje każde wejście i spóźnione
    // odrzucenie ma odbiorcę z samej konstrukcji — sprawdzone osobno
    // (`unhandledRejection` nie pada). Test zostaje jako zabezpieczenie
    // REGRESJI: gdyby ktoś kiedyś zastąpił `race` własną pętlą oczekiwania,
    // ta własność przestałaby być darmowa i wtedy ten przypadek ją złapie.
    const report = await runDailyJobs({
      budgetMs: 10_000,
      jobs: [
        {
          name: "spozniony-blad",
          path: "/api/jobs/spozniony-blad",
          budgetMs: 20,
          run: async () => {
            await sleep(120);
            throw new Error("odrzucenie po terminie");
          },
        },
      ],
    });

    expect(report.jobs[0]?.status).toBe("timeout");
    await sleep(200); // czas, w którym późne odrzucenie zdążyłoby wybuchnąć
    expect(report.jobs).toHaveLength(1);
  });

  it("suma limitów per zadanie MIEŚCI SIĘ w budżecie przebiegu", () => {
    // Bez tego zadanie na końcu listy mogłoby nie dostać ani milisekundy,
    // mimo że każdy limit z osobna wygląda rozsądnie.
    const sum = DAILY_JOBS.reduce((total, job) => total + job.budgetMs, 0);

    expect(sum).toBeLessThanOrEqual(DAILY_RUN_BUDGET_MS);
  });

  it("budżet przebiegu zostawia zapas na zwrócenie odpowiedzi w limicie funkcji", async () => {
    const { maxDuration } = await import("@/app/api/jobs/daily/route");

    expect(DAILY_RUN_BUDGET_MS).toBeLessThan(maxDuration * 1_000);
  });

  it("rekoncyliacja idzie OSTATNIA — najdroższa i najbardziej wznawialna", () => {
    expect(DAILY_JOBS.at(-1)?.name).toBe("payment-reconciliation");
    // Kolejność od najtańszego: limity nie maleją wzdłuż listy.
    const budgets = DAILY_JOBS.map((job) => job.budgetMs);
    expect([...budgets].sort((a, b) => a - b)).toEqual(budgets);
  });
});

/**
 * KOMPLETNOŚĆ — oś, której brak kosztował dwa gotowe zadania.
 *
 * `payment-reconciliation` i `email-log-retention` były napisane,
 * przetestowane i zabezpieczone, a mimo to nie uruchomiły się ani razu: nikt
 * nie sprawdzał, czy KAŻDE zadanie w `app/api/jobs/` jest osiągalne
 * z harmonogramu. Ciche pominięcie nie miało jak zapalić się na czerwono.
 *
 * DLATEGO ŹRÓDŁEM PRAWDY JEST DYSK, NIE REJESTR. Gdyby ten test porównywał
 * rejestr sam ze sobą, usunięcie z niego wpisu przechodziłoby na zielono —
 * zbiór skurczyłby się po obu stronach równania. Katalogi tras są niezależne
 * od rejestru, więc wypadnięcie zadania z dyspozytora nie ma się gdzie ukryć.
 */
describe("seria dzienna — kompletność", () => {
  const jobsDir = new URL("../app/api/jobs/", import.meta.url);

  /** Katalogi tras zadań — niezależny od rejestru spis tego, co istnieje. */
  const routeDirs = readdirSync(jobsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const crons = (
    JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string; schedule: string }[];
    }
  ).crons;

  const DISPATCHER_PATH = "/api/jobs/daily";

  it("KAŻDA trasa zadania jest osiągalna z harmonogramu — wprost albo przez dyspozytora", () => {
    const scheduled = new Set(crons.map((cron) => cron.path));
    const dispatched = new Set(DAILY_JOBS.map((job) => job.path));

    expect(routeDirs.length).toBeGreaterThanOrEqual(5);
    for (const dir of routeDirs) {
      const path = `/api/jobs/${dir}`;
      expect(
        scheduled.has(path) || dispatched.has(path),
        `Trasa ${path} nie jest osiągalna z harmonogramu: nie ma jej ani w vercel.json, ani w DAILY_JOBS. ` +
          "Zadanie bez wyzwalacza nie uruchomi się nigdy.",
      ).toBe(true);
    }
  });

  it("każdy wpis rejestru wskazuje ISTNIEJĄCĄ trasę — brak wpisów-widm", () => {
    for (const job of DAILY_JOBS) {
      expect(routeDirs, `wpis ${job.name} nie ma odpowiadającej trasy`).toContain(job.name);
      expect(job.path).toBe(`/api/jobs/${job.name}`);
    }
  });

  it("dyspozytor NIE woła samego siebie", () => {
    expect(DAILY_JOBS.map((job) => job.path)).not.toContain(DISPATCHER_PATH);
  });

  it("nazwy zadań są unikalne", () => {
    const names = DAILY_JOBS.map((job) => job.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("dwa zadania, które nigdy nie ruszyły, SĄ w serii", () => {
    const paths = DAILY_JOBS.map((job) => job.path);
    expect(paths).toContain("/api/jobs/payment-reconciliation");
    expect(paths).toContain("/api/jobs/email-log-retention");
  });
});

/**
 * HARMONOGRAM — co jest realnym ograniczeniem, a co już nim nie jest.
 *
 * DO ODWOŁANIA: „plan Hobby dopuszcza DWA zadania cron". To było prawdą, gdy
 * powstawały ADR-104 i ADR-116, i dlatego oba zadania zostały bez wyzwalacza.
 * Dziś dokumentacja hostingu podaje 100 zadań na projekt (ADR-130), a wiążące
 * pozostają DWA inne ograniczenia — i tych pilnuje ten blok:
 *
 *   - CZĘSTOTLIWOŚĆ: wyłącznie raz na dobę. Wyrażenie, które uruchomiłoby się
 *     częściej, PADA PRZY WDROŻENIU — czyli psuje produkcję, nie CI.
 *   - PRECYZJA: ±59 minut, więc realnie wybieramy GODZINĘ, nie minutę.
 */
describe("harmonogram serii dziennej", () => {
  const crons = (
    JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string; schedule: string }[];
    }
  ).crons;

  it("każdy wpis jest DZIENNY — częstszy wywraca wdrożenie, nie CI", () => {
    for (const cron of crons) {
      expect(cron.schedule, `harmonogram ${cron.path}`).toMatch(/^\d+ \d+ \* \* \*$/);
    }
  });

  it("seria dzienna ma wpis w harmonogramie", () => {
    expect(crons.map((cron) => cron.path)).toContain("/api/jobs/daily");
  });

  it("chodzi w oknie najniższego ruchu operatora (1:xx UTC = 3:xx w Polsce latem)", () => {
    const daily = crons.find((cron) => cron.path === "/api/jobs/daily");
    const hour = Number(daily?.schedule.split(" ")[1]);

    // Cron hostingu liczy w UTC; operator w PL ma UTC+2 latem, UTC+1 zimą.
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(2);
  });
});
