/**
 * Dyspozytor zadań dziennych (ADR-130).
 *
 * ================== JAKĄ AWARIĘ TO SPRZĄTA ==================
 *
 * W `app/api/jobs/` leżą CZTERY trasy zadań, a harmonogram wołał DWIE.
 * `payment-reconciliation` (L11/ADR-104) i `email-log-retention` (C2b/ADR-116)
 * były napisane, przetestowane i zabezpieczone — i nie uruchomiły się ANI RAZU,
 * bo nie miały wpisu w `vercel.json`. To nie był dług projektowy, tylko gotowy
 * kod bez wyzwalacza; rekoncyliacja jest przy tym siatką bezpieczeństwa na
 * zgubiony webhook dostawcy, więc jej milczenie było niewidoczne z definicji.
 *
 * Dyspozytor woła te same rdzenie co trasy pojedyncze — NIE POWIELA ICH
 * LOGIKI. Trasy pojedyncze zostają, żeby dało się odpalić jedno zadanie ręcznie
 * (diagnostyka, ponowienie po awarii) bez czekania na całą serię.
 *
 * ================== DLACZEGO SZEREGOWO, A NIE RÓWNOLEGLE ==================
 *
 * Wszystkie zadania serii chodzą klientem `service_role` z pominięciem RLS
 * i biją w tę samą bazę. Szeregowo znaczy: w danej chwili dokładnie jedno
 * z nich obciąża bazę i Storage. `Promise.all` skróciłby przebieg, ale
 * zamieniłby przewidywalny profil obciążenia w tyleż równoległych skoków
 * w oknie, w którym nikt tego nie ogląda.
 *
 * ================== ODPORNOŚĆ: AWARIA JEDNEGO NIE UBIJA RESZTY ==============
 *
 * Każde zadanie biegnie we WŁASNYM `try/catch`. Wyjątek jednego zamienia się
 * w jego własny wpis ze statusem `failed` i NIE przerywa pętli — inaczej
 * pojedyncza awaria Stripe'a zabierałaby ze sobą retencję danych osobowych,
 * z którą nie ma nic wspólnego.
 *
 * ================== BUDŻET CZASU ==================
 *
 * Funkcja na planie Hobby ma 300 s (domyślne i maksymalne — patrz ADR-130).
 * Zadania pod rząd mogą ten budżet przekroczyć, a przekroczenie bez planu to
 * `FUNCTION_INVOCATION_TIMEOUT`: praca ucięta w losowym miejscu i BRAK
 * ODPOWIEDZI, czyli brak jakiegokolwiek raportu. Dlatego:
 *
 *   1. KOLEJNOŚĆ OD NAJTAŃSZYCH. Tanie zadania (garść round-tripów każde) idą
 *      przodem i domykają się na pewno; najdroższa rekoncyliacja płatności —
 *      do stu wywołań sieciowych u dostawcy — idzie OSTATNIA, bo jest też
 *      najbardziej wznawialna (patrz niżej). Siatki Fazy B (zwroty kaucji,
 *      konta Connect) są tanie i wznawialne, więc siadają wśród przednich.
 *   2. TWARDY BUDŻET PER ZADANIE, a ich suma NIE PRZEKRACZA budżetu przebiegu
 *      (pilnuje tego test). Dzięki temu żadne zadanie nie może zjeść cudzego
 *      przydziału: nawet gdy zadania przednie wykorzystają swoje limity co do
 *      milisekundy, rekoncyliacja płatności dostanie swoje.
 *   3. NIE ZACZYNAMY TEGO, CZEGO NIE SKOŃCZYMY. Przed każdym zadaniem liczymy
 *      pozostały czas; gdy go nie ma, zadanie dostaje status `skipped`
 *      Z POWODEM zamiast wystartować i zostać zabite w połowie.
 *   4. PRZERWANIE JEST JAWNE. Zadanie, które przekroczy swój limit, dostaje
 *      status `timeout` w odpowiedzi — nigdy cichego zniknięcia.
 *
 * DLACZEGO UCIĘCIE JEST BEZPIECZNE. Żadne z tych zadań nie ma stanu
 * „w połowie" na poziomie jednostki pracy: retencja to POJEDYNCZE wywołanie
 * funkcji bazy (transakcja — albo się stała, albo nie), a sprzątanie uploadów
 * i rekoncyliacja przetwarzają rekord po rekordzie, zatwierdzając każdy
 * osobno. Zaległość, której przebieg nie zdążył ruszyć, jest po prostu
 * zaległością — następne wywołanie zaczyna od niej. Dyspozytor NIE WPROWADZA
 * tu nowego ryzyka; wprowadza raport z tego, co się nie zmieściło.
 *
 * UCZCIWIE O `withTimeout`: limit czasu ZDEJMUJE NAM CZEKANIE, ale nie
 * anuluje pracy już rozpoczętej — rdzenie nie przyjmują sygnału przerwania.
 * Porzucona praca biegnie do zburzenia funkcji przez platformę. Jest to
 * dopuszczalne WYŁĄCZNIE dzięki akapitowi wyżej (każda jednostka zatwierdzana
 * osobno, całość idempotentna przy powtórzeniu) i nie wolno tego mylić
 * z anulowaniem.
 */
import { cleanupProductImageUploads } from "@/src/jobs/cleanup-product-image-uploads";
import { cleanupSiteImageUploads } from "@/src/jobs/cleanup-site-image-uploads";
import { purgeEmailLogBodies } from "@/src/jobs/purge-email-log-bodies";
import { reconcileBilling } from "@/src/jobs/reconcile-billing";
import { reconcileConnectAccounts } from "@/src/jobs/reconcile-connect-accounts";
import { reconcileDepositRefunds } from "@/src/jobs/reconcile-deposit-refunds";
import { reconcilePayments } from "@/src/jobs/reconcile-payments";

/**
 * Budżet CAŁEGO przebiegu. Poniżej limitu funkcji (300 s) o zapas na zwrócenie
 * odpowiedzi i narzut platformy — przebieg ma się skończyć RAPORTEM, a nie
 * zabiciem funkcji w połowie zdania.
 */
export const DAILY_RUN_BUDGET_MS = 270_000;

export type DailyJobStatus =
  /** Zadanie wykonało się do końca. */
  | "ok"
  /** Zadanie rzuciło wyjątkiem. */
  | "failed"
  /** Zadanie przekroczyło swój limit czasu — przestaliśmy na nie czekać. */
  | "timeout"
  /** Nie starczyło budżetu przebiegu — zadanie NIE zostało uruchomione. */
  | "skipped";

/** Jedno zadanie w serii dziennej. */
export interface DailyJob {
  /** Nazwa = katalog trasy pojedynczej. Test kompletności porównuje ją z dyskiem. */
  name: string;
  /** Ścieżka trasy pojedynczej — ta sama praca, wywoływana ręcznie. */
  path: string;
  /** Twardy limit czasu tego zadania. Suma limitów ≤ DAILY_RUN_BUDGET_MS. */
  budgetMs: number;
  run: () => Promise<unknown>;
}

/** Wynik JEDNEGO zadania — to on sprawia, że „200 OK" nie jest całą wiedzą. */
export interface DailyJobReport {
  name: string;
  path: string;
  status: DailyJobStatus;
  /** Czas trwania w ms; dla `skipped` zawsze 0. */
  ms: number;
  /** Ładunek zwrócony przez rdzeń — liczniki przebiegu. */
  detail?: unknown;
  /**
   * Zdanie BEZ SZCZEGÓŁÓW. Powód pełny idzie do logu (`console.error`), bo
   * komunikat bazy albo dostawcy bywa echem żądania i potrafi nieść cudze
   * identyfikatory — ta sama zasada, co w trasach pojedynczych.
   */
  error?: string;
}

export interface DailyRunReport {
  /** `true` tylko wtedy, gdy KAŻDE zadanie skończyło się `ok`. */
  ok: boolean;
  ms: number;
  jobs: DailyJobReport[];
}

/**
 * REJESTR — jedyne źródło prawdy o tym, co wchodzi w serię dzienną.
 *
 * KOLEJNOŚĆ JEST CZĘŚCIĄ PROJEKTU, nie kwestią gustu: od najtańszego do
 * najdroższego (uzasadnienie w nagłówku pliku). Rekoncyliacja zamyka listę.
 *
 * Dopisanie trasy zadania BEZ dopisania jej tutaj pali test kompletności
 * (`daily-jobs-route.test.ts`) — to dokładnie ta klasa przeoczenia, przez
 * którą dwa gotowe zadania przeleżały bez wyzwalacza.
 */
export const DAILY_JOBS: readonly DailyJob[] = [
  {
    // Zwroty kaucji utknięte w `pending` (Faza B) — siatka na zgubiony webhook
    // `charge.refund.updated`. Wierszy zwykle ZERO (utyka tylko przy zgubionym
    // zdarzeniu), a każdy to jeden odczyt u dostawcy; ucięcie budżetu zostawia
    // resztę w `pending` (stanie, w którym była). Najtańszy → pierwszy.
    name: "reconcile-deposit-refunds",
    path: "/api/jobs/reconcile-deposit-refunds",
    budgetMs: 15_000,
    run: () => reconcileDepositRefunds(),
  },
  {
    // Pull stanu kont Connect (Faza B) — siatka na zgubiony `account.updated`.
    // Do stu kont × jeden odczyt u dostawcy, ale kolejność `last_synced_at asc`
    // odświeża najstarsze najpierw, więc ucięcie zostawia w zaległości konta
    // ŚWIEŻO odświeżone. Odczyty biegną szeregowo (throttling z konstrukcji).
    name: "reconcile-connect-accounts",
    path: "/api/jobs/reconcile-connect-accounts",
    budgetMs: 15_000,
    run: () => reconcileConnectAccounts(),
  },
  {
    // Jedno wywołanie funkcji bazy (`app.purge_email_log_bodies`) — najtańsze
    // co do pracy. Budżet zszedł z 30 s na 15 s, żeby dwie nowe siatki Fazy B
    // zmieściły się w budżecie przebiegu (suma limitów ≤ DAILY_RUN_BUDGET_MS —
    // pilnuje test): jeden round-trip do bazy mieści się z ogromnym zapasem.
    name: "email-log-retention",
    path: "/api/jobs/email-log-retention",
    budgetMs: 15_000,
    run: () => purgeEmailLogBodies(),
  },
  {
    // Rekoncyliacja subskrypcji SaaS (ADR-136) — siatka bezpieczeństwa na
    // zgubiony webhook billingu, nie drugi zegar (zasada 1 dunningu).
    // Garść tenantów z subskrypcją × jeden odczyt u dostawcy — tania; budżet
    // zszedł z 30 s na 15 s z tego samego powodu co retencja maili wyżej.
    name: "billing-reconciliation",
    path: "/api/jobs/billing-reconciliation",
    budgetMs: 15_000,
    run: () => reconcileBilling(),
  },
  {
    // Kilka round-tripów + kasowanie obiektów Storage, porcja ograniczona.
    name: "site-image-uploads",
    path: "/api/jobs/site-image-uploads",
    budgetMs: 45_000,
    run: () => cleanupSiteImageUploads(),
  },
  {
    name: "product-image-uploads",
    path: "/api/jobs/product-image-uploads",
    budgetMs: 45_000,
    run: () => cleanupProductImageUploads(),
  },
  {
    // NAJDROŻSZE I OSTATNIE: do stu zamówień, każde z odczytem u dostawcy
    // przez sieć. Zarazem najbardziej wznawialne — każde zamówienie jest
    // zatwierdzane osobno, więc ucięcie zostawia resztę w `pending`, czyli
    // w stanie, w którym i tak była. Budżet zszedł ze 150 s na 120 s, żeby
    // rekoncyliacja billingu zmieściła się w budżecie przebiegu (suma
    // limitów ≤ DAILY_RUN_BUDGET_MS — pilnuje test): 100 zamówień × ~1 s
    // odczytu wciąż mieści się z zapasem.
    name: "payment-reconciliation",
    path: "/api/jobs/payment-reconciliation",
    budgetMs: 120_000,
    run: () => reconcilePayments(),
  },
];

/** Rzucane przez `withTimeout`; odróżnia przekroczenie limitu od awarii zadania. */
class JobTimeoutError extends Error {}

/**
 * Czeka na `promise` najwyżej `ms`.
 *
 * ODRZUCENIE PO TERMINIE NIE JEST TU PROBLEMEM — i warto wiedzieć dlaczego,
 * bo stała w tym miejscu owijka „chroniąca" przed czymś, co nie zachodzi.
 * `Promise.race` SUBSKRYBUJE KAŻDE wejście, więc obietnica zadania ma
 * odbiorcę niezależnie od tego, czy wygrała wyścig. Gdy przegra, a potem
 * odrzuci, odrzucenie jest już OBSERWOWANE: nie staje się `unhandledRejection`
 * i nie ma jak zabić procesu. Przegrany wyścig pozostaje przegrany —
 * spóźnione odrzucenie nie zmienia wyniku `race`.
 *
 * `clearTimeout` w `finally` jest natomiast konieczny: zwisający timer trzyma
 * pętlę zdarzeń i potrafi przedłużyć życie funkcji po zwróceniu odpowiedzi.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new JobTimeoutError(`Zadanie ${name} przekroczyło limit ${ms} ms.`));
    }, ms);
  });

  return Promise.race([promise, expiry]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export interface RunDailyJobsOptions {
  /** Podmieniany w teście; produkcja bierze `DAILY_JOBS`. */
  jobs?: readonly DailyJob[];
  budgetMs?: number;
}

/**
 * Wykonuje serię dzienną i zwraca wynik KAŻDEGO zadania z osobna.
 *
 * Ta funkcja NIE RZUCA. Wyjątek zadania jest wynikiem tego zadania, nie
 * wynikiem przebiegu — przebieg kończy się raportem zawsze, bo raport jest
 * jedynym śladem, jaki ta praca po sobie zostawia.
 */
export async function runDailyJobs(options: RunDailyJobsOptions = {}): Promise<DailyRunReport> {
  const jobs = options.jobs ?? DAILY_JOBS;
  const budgetMs = options.budgetMs ?? DAILY_RUN_BUDGET_MS;
  const startedAt = Date.now();
  const reports: DailyJobReport[] = [];

  for (const job of jobs) {
    const remaining = budgetMs - (Date.now() - startedAt);

    // NIE ZACZYNAJ TEGO, CZEGO NIE SKOŃCZYSZ. Start bez budżetu kończy się
    // zabiciem funkcji przez platformę — a wtedy nie ma ani wyniku, ani
    // odpowiedzi, ani informacji, że zadanie w ogóle próbowało.
    if (remaining <= 0) {
      reports.push({
        name: job.name,
        path: job.path,
        status: "skipped",
        ms: 0,
        error: "Budżet czasu przebiegu wyczerpany — zadanie nie zostało uruchomione.",
      });
      continue;
    }

    const slice = Math.min(job.budgetMs, remaining);
    const jobStartedAt = Date.now();

    try {
      const detail = await withTimeout(job.run(), slice, job.name);
      reports.push({
        name: job.name,
        path: job.path,
        status: "ok",
        ms: Date.now() - jobStartedAt,
        detail,
      });
    } catch (error) {
      const timedOut = error instanceof JobTimeoutError;
      // Do LOGU powód pełny — po to, żeby przyczynę dało się odczytać
      // z podglądu funkcji bez zgadywania.
      console.error(`[daily] zadanie ${job.name} nie powiodło się.`, error);
      reports.push({
        name: job.name,
        path: job.path,
        status: timedOut ? "timeout" : "failed",
        ms: Date.now() - jobStartedAt,
        error: timedOut
          ? `Zadanie przekroczyło limit ${slice} ms i zostało porzucone; zaległość wraca w następnym przebiegu.`
          : "Zadanie zakończyło się błędem — powód w logu funkcji.",
      });
    }
  }

  const report: DailyRunReport = {
    ok: reports.every((entry) => entry.status === "ok"),
    ms: Date.now() - startedAt,
    jobs: reports,
  };

  // Jedna linia podsumowania obok wpisów per zadanie: w podglądzie funkcji
  // widać stan całej serii bez rozwijania ciała odpowiedzi.
  console.info(
    `[daily] ${report.ok ? "OK" : "UWAGA"} w ${report.ms} ms — ` +
      report.jobs.map((entry) => `${entry.name}:${entry.status}(${entry.ms}ms)`).join(", "),
  );

  return report;
}
