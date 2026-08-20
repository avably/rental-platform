/**
 * Bramka wejścia tras zadań cyklicznych — JEDNA implementacja (ADR-130).
 *
 * ================== CO TU DOWODZIMY I DLACZEGO NA DWA SPOSOBY ==============
 *
 * Stałoczasowe porównanie sekretu ma tę niewygodną własność, że jego UTRATA
 * NIE MA OBJAWU BEHAWIORALNEGO: `===` i `timingSafeEqual` zwracają to samo
 * dla każdego wejścia, odmowa wygląda identycznie, a różnica rzędu nanosekund
 * tonie w szumie pomiaru. Test „zły sekret → 401" przechodzi na zielono
 * w OBU wersjach — czyli nie broni niczego, mimo że wygląda jak dowód.
 *
 * Zanim powstał ten plik, w repozytorium NIE BYŁO ani jednej bramki na tę oś:
 * dowolna z pięciu tras zadań mogła osunąć się do zwykłego `===`, a CI nie
 * miało jak tego zauważyć. Dlatego dowód jest dwuczęściowy:
 *
 *   1. ZACHOWANIE — bramka odmawia we wszystkich wariantach złego wejścia
 *      i (to jest ta część, która naprawdę potrafi paść) NIE RZUCA przy
 *      nagłówku innej długości niż sekret.
 *   2. KONTRAKT ŹRÓDŁA — `timingSafeEqual` jest realnie użyte, a żadna trasa
 *      nie porównuje sekretu na własną rękę.
 *
 * Kontrakt źródła czyta plik PO USUNIĘCIU KOMENTARZY. Bez tego wystarczyłoby
 * wymienić implementację na `===` i zostawić słowo `timingSafeEqual`
 * w komentarzu obok, żeby bramka świeciła na zielono nad kodem, którego już
 * nie broni.
 */
import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { cronAuthorized } from "@/src/jobs/cron-auth";

const SECRET = "sekret-crona-0123456789-abcdefghij";

describe("bramka sekretu harmonogramu — zachowanie", () => {
  it("poprawny nagłówek przechodzi", () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("brak nagłówka odpada", () => {
    expect(cronAuthorized(null, SECRET)).toBe(false);
  });

  it("pusty nagłówek odpada", () => {
    expect(cronAuthorized("", SECRET)).toBe(false);
  });

  it("sam sekret bez schematu `Bearer` odpada", () => {
    expect(cronAuthorized(SECRET, SECRET)).toBe(false);
  });

  it("różnica JEDNEGO bajtu przy tej samej długości odpada", () => {
    const almost = `${SECRET.slice(0, -1)}X`;
    expect(almost).toHaveLength(SECRET.length);
    expect(cronAuthorized(`Bearer ${almost}`, SECRET)).toBe(false);
  });

  it("prefiks poprawnego sekretu odpada", () => {
    expect(cronAuthorized(`Bearer ${SECRET.slice(0, -3)}`, SECRET)).toBe(false);
  });

  it("nagłówek DŁUŻSZY od sekretu odpada, ale NIE RZUCA", () => {
    // `timingSafeEqual` rzuca przy buforach różnej długości. Gdyby zabrakło
    // wcześniejszego porównania długości, ten przypadek zamieniłby odmowę
    // 401 w błąd serwera 500 — czyli w informację, że zgadywana długość
    // była nie ta.
    expect(() => cronAuthorized(`Bearer ${SECRET}-nadmiar`, SECRET)).not.toThrow();
    expect(cronAuthorized(`Bearer ${SECRET}-nadmiar`, SECRET)).toBe(false);
  });

  it("nagłówek KRÓTSZY od sekretu odpada, ale NIE RZUCA", () => {
    expect(() => cronAuthorized("Bearer x", SECRET)).not.toThrow();
    expect(cronAuthorized("Bearer x", SECRET)).toBe(false);
  });

  it("odmowa nie zależy od tego, ILE znaków się zgadza", () => {
    // Wyrocznia „prefiks poprawny" byłaby drogą do odgadnięcia sekretu
    // znak po znaku. Wynik ma być jednakowy dla każdego złego wejścia.
    const guesses = ["Bearer s", `Bearer ${SECRET.slice(0, 10)}`, `Bearer ${SECRET.slice(0, 30)}`];
    for (const guess of guesses) {
      expect(cronAuthorized(guess, SECRET), guess).toBe(false);
    }
  });
});

/** Usuwa komentarze blokowe i liniowe — bramka ma czytać KOD, nie prozę. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const jobsDir = new URL("../app/api/jobs/", import.meta.url);

describe("bramka sekretu harmonogramu — kontrakt źródła", () => {
  it("porównanie jest STAŁOCZASOWE — `timingSafeEqual` w kodzie, nie w komentarzu", () => {
    const source = stripComments(
      readFileSync(new URL("../src/jobs/cron-auth.ts", import.meta.url), "utf8"),
    );

    expect(source).toContain('from "node:crypto"');
    expect(source).toMatch(/timingSafeEqual\(/);
    // Porównanie długości PRZED `timingSafeEqual` — bez niego różna długość
    // rzuca zamiast odmówić (patrz test zachowania wyżej).
    expect(source).toMatch(/\.length === .*\.length/);
  });

  it("ŻADNA trasa zadania nie porównuje sekretu na własną rękę", () => {
    const routes = readdirSync(jobsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(routes.length).toBeGreaterThanOrEqual(5);
    for (const route of routes) {
      const source = stripComments(
        readFileSync(new URL(`${route}/route.ts`, jobsDir), "utf8"),
      );

      expect(source, `${route}: trasa importuje wspólną bramkę`).toContain(
        'from "@/src/jobs/cron-auth"',
      );
      expect(source, `${route}: trasa woła wspólną bramkę`).toContain("cronAuthorized(");
      // Własna kopia porównania to piąte miejsce, które może się osunąć
      // niezauważenie — dokładnie ten stan ADR-130 likwiduje.
      expect(source, `${route}: brak własnego porównania sekretu`).not.toMatch(
        /timingSafeEqual|Buffer\.from/,
      );
    }
  });

  it("KAŻDA trasa zadania odmawia bez sekretu i przy złym sekrecie", async () => {
    // Kontrakt źródła mówi, że bramka jest zaimportowana; ten test mówi, że
    // jest WYWOŁANA. Bez niego import mógłby zostać, a wywołanie zniknąć.
    //
    // Moduły wyliczone STATYCZNIE, a ich zbiór porównany z katalogami na
    // dysku: pętla po pustej albo niepełnej liście przeszłaby na zielono,
    // nie sprawdziwszy niczego.
    const handlers: Record<string, Promise<{ GET: (request: Request) => Promise<Response> }>> = {
      "billing-reconciliation": import("@/app/api/jobs/billing-reconciliation/route"),
      daily: import("@/app/api/jobs/daily/route"),
      "email-log-retention": import("@/app/api/jobs/email-log-retention/route"),
      "payment-reconciliation": import("@/app/api/jobs/payment-reconciliation/route"),
      "product-image-uploads": import("@/app/api/jobs/product-image-uploads/route"),
      "reconcile-connect-accounts": import("@/app/api/jobs/reconcile-connect-accounts/route"),
      "reconcile-deposit-refunds": import("@/app/api/jobs/reconcile-deposit-refunds/route"),
      "site-image-uploads": import("@/app/api/jobs/site-image-uploads/route"),
    };
    const routes = readdirSync(jobsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(Object.keys(handlers).sort(), "nowa trasa zadania bez wpisu w tym teście").toEqual(
      [...routes].sort(),
    );

    const previous = process.env.CRON_SECRET;

    try {
      for (const route of routes) {
        const { GET } = await handlers[route]!;
        const url = `https://panel.test/api/jobs/${route}`;

        process.env.CRON_SECRET = SECRET;
        const wrong = await GET(new Request(url, { headers: { authorization: "Bearer zle" } }));
        expect(wrong.status, `${route}: zły sekret`).toBe(401);

        const missing = await GET(new Request(url));
        expect(missing.status, `${route}: brak nagłówka`).toBe(401);

        delete process.env.CRON_SECRET;
        const unset = await GET(
          new Request(url, { headers: { authorization: `Bearer ${SECRET}` } }),
        );
        expect(unset.status, `${route}: brak CRON_SECRET w środowisku`).toBe(503);
      }
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previous;
    }
  });
});
