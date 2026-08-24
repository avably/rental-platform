/**
 * Bramka budżetów wydajności (ADR-262) — pilnuje WAGI FRONTU (rozmiar
 * pierwszego ładowania JS per trasa) przed regresją, zanim wzrośnie ruch.
 *
 * ── CO MIERZYMY (i czego ŚWIADOMIE nie) ──────────────────────────────────
 * Pełne metryki runtime (LCP / CLS / INP) wymagają ŻYWEJ przeglądarki albo
 * stagingu (Lighthouse / WebPageTest) — w bramce lokalnej (Actions off,
 * czysty `next build` + `pnpm test`) tego nie ma. Zamiast forsować metrykę,
 * której nie da się rzetelnie zmierzyć bez przeglądarki, mierzymy WYKONALNY
 * i wartościowy proxy: **rozmiar transferu (gzip) pierwszego ładowania JS
 * per trasa** z artefaktu `next build`. To jedyny front-endowy budżet, który
 * bramka lokalna policzy deterministycznie, z pliku, bez sieci.
 *   → FOLLOW-UP (poza tym zadaniem): runtime LCP/CLS/INP przez Lighthouse CI
 *     na stagingu z realnym tenantem — osobna bramka, wymaga przeglądarki.
 *
 * ── SKĄD LICZYMY (kształt manifestu Next 16 / Turbopack) ─────────────────
 * Next 16 z Turbopackiem NIE wypisuje już kolumny „First Load JS" w tabeli
 * `next build` ANI nie tworzy korzeniowego `app-build-manifest.json`
 * (webpackowy kształt zniknął). Pierwsze ładowanie składamy z dwóch źródeł
 * na trasę:
 *   1. `.next/build-manifest.json` → `rootMainFiles` + `polyfillFiles`
 *      = WSPÓLNY runtime ładowany na KAŻDEJ trasie App Routera (baseline).
 *   2. `.next/server/app/<trasa>/page_client-reference-manifest.js` →
 *      obiekt `globalThis.__RSC_MANIFEST[...]`, klucz `clientModules`:
 *      wszystkie moduły klienckie drzewa trasy (layout + strona) i ich
 *      `chunks`. Suma UNII tych chunków (bez CSS) = JS pierwszego ładowania.
 * Rozmiar = suma `gzipSync(plik).length` KAŻDEGO unikalnego chunka (każdy
 * chunk to osobna odpowiedź HTTP, kompresowana niezależnie) — czyli realny
 * transfer, nie rozmiar na dysku.
 *
 * ── DETERMINIZM ──────────────────────────────────────────────────────────
 * `gzipSync` (poziom domyślny 6) jest deterministyczny dla danych wejściowych;
 * treść chunków jest stała dla stałego źródła. Drobne wahania między buildami
 * pochłania margines budżetu (patrz `perf-budgets.json`).
 *
 * ── UŻYCIE ───────────────────────────────────────────────────────────────
 *   node scripts/perf-budget-check.mjs                # sprawdź obie apki
 *   node scripts/perf-budget-check.mjs storefront     # jedna apka
 *   node scripts/perf-budget-check.mjs --update        # przelicz baseline
 *                                                      # + zapisz budżety
 * Bez `.next` danej apki: raport „pominięto (brak buildu)", kod wyjścia 0
 * (brak buildu to nie regresja — patrz test `perf-budget.test.ts`).
 * Przy `--update` budżet = baseline × (1 + margines) zaokrąglony w górę do
 * 1 KiB; `critical`/marginesy z istniejącego pliku są zachowane.
 *
 * Zero instalacji — same moduły wbudowane Node. Zero wpływu na runtime/dane:
 * to tylko odczyt artefaktu buildu.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KORZEN = fileURLToPath(new URL("..", import.meta.url));

/** Apki objęte bramką (nazwa katalogu w `apps/`). */
export const APKI = ["storefront", "panel"];

/** Marginesy domyślne (gdy `perf-budgets.json` jeszcze nie istnieje). */
export const MARGINESY_DOMYSLNE = { critical: 0.1, default: 0.15, shared: 0.12 };

/**
 * Trasy krytyczne per apka (ciaśniejszy margines). Storefront: ścieżki
 * kupującego. Panel: pulpit (`/[locale]`) — layout panelu jedzie w KAŻDEJ
 * trasie i we wspólnym baseline, więc jego regresję łapie budżet `shared`
 * oraz każdy budżet trasy.
 */
export const TRASY_KRYTYCZNE = {
  storefront: ["/store", "/katalog", "/kategoria/[slug]", "/produkt/[slug]"],
  panel: ["/[locale]"],
};

const KiB = 1024;

/** Ścieżka chunka z manifestu → ścieżka na dysku w `.next`. */
function chunkNaDysku(nextDir, chunk) {
  const rel = chunk.replace(/^\/_next\//, "").replace(/^\//, "");
  return path.join(nextDir, rel);
}

/**
 * Rozmiar gzip pojedynczego chunka (z cache — ten sam chunk bywa współdzielony
 * przez wiele tras). Chunk nie-JS albo nieobecny na dysku liczy się jako 0.
 */
function rozmiarGzip(nextDir, chunk, cache) {
  const p = chunkNaDysku(nextDir, chunk);
  if (cache.has(p)) return cache.get(p);
  let sz = 0;
  if (chunk.endsWith(".js") && existsSync(p)) sz = gzipSync(readFileSync(p)).length;
  cache.set(p, sz);
  return sz;
}

/**
 * Wyłuskuje obiekt `globalThis.__RSC_MANIFEST[<trasa>] = {…}` z pliku
 * `page_client-reference-manifest.js`. Bierze wszystko PO przypisaniu
 * z nawiasem `[…]` (pomija inicjalizator `__RSC_MANIFEST = … || {}`) do
 * końca pliku — przypisanie trasy jest ostatnią instrukcją, więc jest
 * odporne na minifikację i łamanie linii.
 */
export function parsujRscManifest(tresc) {
  // Klucz trasy sam bywa w nawiasach (`[slug]`), więc nie da się liczyć na
  // pierwszy `]`; dopasowanie do `] = {` jest LENIWE dla klucza, a obiekt
  // bierzemy zachłannie do ostatniego `}` (jest ostatnią instrukcją pliku).
  const m = String(tresc).match(
    /__RSC_MANIFEST\[[\s\S]*?\]\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
  );
  if (!m) throw new Error("nie znaleziono przypisania __RSC_MANIFEST[<trasa>]");
  return JSON.parse(m[1]);
}

/**
 * Zbiór chunków pierwszego ładowania dla jednej trasy (bez CSS):
 * wspólny runtime (`build-manifest.json` trasy) + wszystkie chunki modułów
 * klienckich (`clientModules`) z manifestu referencji klienta.
 */
function chunkiTrasy(nextDir, katalogTrasy) {
  const chunki = new Set();
  const bmPath = path.join(nextDir, "server/app", katalogTrasy, "page/build-manifest.json");
  if (existsSync(bmPath)) {
    const bm = JSON.parse(readFileSync(bmPath, "utf8"));
    for (const f of bm.rootMainFiles ?? []) chunki.add(f);
    for (const f of bm.polyfillFiles ?? []) chunki.add(f);
  }
  const crmPath = path.join(nextDir, "server/app", `${katalogTrasy}/page_client-reference-manifest.js`);
  if (existsSync(crmPath)) {
    const manifest = parsujRscManifest(readFileSync(crmPath, "utf8"));
    for (const mod of Object.values(manifest.clientModules ?? {}))
      for (const c of mod.chunks ?? []) chunki.add(c);
  }
  return chunki;
}

/** Bezwzględna ścieżka katalogu apki. */
export function katalogApki(apka) {
  return path.join(KORZEN, "apps", apka);
}

/** Czy apka ma świeży artefakt `next build` (z manifestem tras)? */
export function maBuild(apka) {
  const nextDir = path.join(katalogApki(apka), ".next");
  return existsSync(path.join(nextDir, "app-path-routes-manifest.json"));
}

/**
 * Zmierz pierwszy-load JS (gzip, w bajtach) dla wszystkich TRAS (wpisy
 * kończące się na "/page") danej apki + wspólny baseline.
 *
 * @returns {{ shared:number, routes:Record<string,number> }}
 */
export function zmierzApke(apka) {
  const nextDir = path.join(katalogApki(apka), ".next");
  const routesManifest = JSON.parse(
    readFileSync(path.join(nextDir, "app-path-routes-manifest.json"), "utf8"),
  );
  const cache = new Map();

  const rootBm = JSON.parse(readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"));
  const sharedSet = new Set([...(rootBm.rootMainFiles ?? []), ...(rootBm.polyfillFiles ?? [])]);
  let shared = 0;
  for (const c of sharedSet) shared += rozmiarGzip(nextDir, c, cache);

  const routes = {};
  for (const [internal, route] of Object.entries(routesManifest)) {
    if (!internal.endsWith("/page")) continue; // route-handlery/api nie wysyłają JS pierwszego ładowania
    const katalogTrasy = internal.slice(0, -"/page".length);
    let bytes = 0;
    for (const c of chunkiTrasy(nextDir, katalogTrasy)) bytes += rozmiarGzip(nextDir, c, cache);
    routes[route] = bytes;
  }
  return { shared, routes };
}

/** Ścieżka pliku budżetów danej apki. */
export function sciezkaBudzetow(apka) {
  return path.join(katalogApki(apka), "perf-budgets.json");
}

/** Wczytaj `perf-budgets.json` apki (albo null, gdy jeszcze nie istnieje). */
export function wczytajBudzety(apka) {
  const p = sciezkaBudzetow(apka);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

const zaokraglijDoKiB = (bytes, margines) => Math.ceil((bytes * (1 + margines)) / KiB) * KiB;
const kb = (bytes) => `${(bytes / KiB).toFixed(1)} KB`;

/**
 * Werdykt bramki dla apki: porównuje ZMIERZONE wartości z budżetami.
 * Regresja = pomiar > budżet (dla `shared` albo którejkolwiek trasy z pliku).
 *
 * @returns {{ apka:string, stan:"ok"|"regresja"|"brak-budzetow",
 *             pozycje:Array, problemy:string[], noweTrasy:string[] }}
 */
export function sprawdzApke(apka, pomiar = zmierzApke(apka)) {
  const budzety = wczytajBudzety(apka);
  if (!budzety) {
    return {
      apka,
      stan: "brak-budzetow",
      pozycje: [],
      problemy: [`brak ${path.relative(KORZEN, sciezkaBudzetow(apka))} — uruchom \`--update\``],
      noweTrasy: Object.keys(pomiar.routes),
    };
  }

  const pozycje = [];
  const problemy = [];

  // Wspólny baseline.
  if (budzety.shared?.budgetBytes != null) {
    const nad = pomiar.shared > budzety.shared.budgetBytes;
    pozycje.push({
      trasa: "(shared)",
      krytyczna: false,
      pomiar: pomiar.shared,
      budzet: budzety.shared.budgetBytes,
      nad,
    });
    if (nad)
      problemy.push(
        `(shared): ${kb(pomiar.shared)} > budżet ${kb(budzety.shared.budgetBytes)} ` +
          `(${kb(pomiar.shared - budzety.shared.budgetBytes)} ponad)`,
      );
  }

  // Trasy z pliku budżetów.
  for (const [trasa, cfg] of Object.entries(budzety.routes ?? {})) {
    const zmierzone = pomiar.routes[trasa];
    if (zmierzone == null) {
      // Trasa z budżetu zniknęła z buildu — dryf konfiguracji, ale nie regresja
      // wagi. Sygnalizujemy w raporcie, nie palimy bramki.
      pozycje.push({ trasa, krytyczna: !!cfg.critical, pomiar: null, budzet: cfg.budgetBytes, nad: false });
      continue;
    }
    const nad = zmierzone > cfg.budgetBytes;
    pozycje.push({ trasa, krytyczna: !!cfg.critical, pomiar: zmierzone, budzet: cfg.budgetBytes, nad });
    if (nad)
      problemy.push(
        `${trasa}${cfg.critical ? " [krytyczna]" : ""}: ${kb(zmierzone)} > budżet ${kb(cfg.budgetBytes)} ` +
          `(${kb(zmierzone - cfg.budgetBytes)} ponad)`,
      );
  }

  // Trasy obecne w buildzie, ale bez budżetu — informacyjnie (nowa trasa nie
  // jest regresją istniejącego budżetu; jej budżet dokłada się osobnym PR-em).
  const noweTrasy = Object.keys(pomiar.routes).filter((t) => !(budzety.routes ?? {})[t]);

  return {
    apka,
    stan: problemy.length ? "regresja" : "ok",
    pozycje,
    problemy,
    noweTrasy,
  };
}

/**
 * Przelicz baseline z bieżącego buildu i zapisz `perf-budgets.json`.
 * Zachowuje `critical` i marginesy z istniejącego pliku; nowe trasy dostają
 * `critical` z `TRASY_KRYTYCZNE` i margines wg tieru.
 */
export function aktualizujBudzety(apka) {
  const pomiar = zmierzApke(apka);
  const stary = wczytajBudzety(apka);
  const marginesy = stary?.margins ?? MARGINESY_DOMYSLNE;
  const krytyczne = new Set(
    stary
      ? Object.entries(stary.routes ?? {}).filter(([, c]) => c.critical).map(([t]) => t)
      : TRASY_KRYTYCZNE[apka] ?? [],
  );
  for (const t of TRASY_KRYTYCZNE[apka] ?? []) krytyczne.add(t);

  const routes = {};
  for (const trasa of Object.keys(pomiar.routes).sort()) {
    const critical = krytyczne.has(trasa);
    const margines = critical ? marginesy.critical : marginesy.default;
    routes[trasa] = {
      critical,
      baselineBytes: pomiar.routes[trasa],
      budgetBytes: zaokraglijDoKiB(pomiar.routes[trasa], margines),
    };
  }

  const plik = {
    app: apka,
    unit: "bytes (gzip)",
    metric:
      "JS pierwszego ładowania per trasa (wspólny runtime + wszystkie chunki modułów klienckich drzewa trasy), rozmiar transferu gzip",
    source:
      "next build (Turbopack): .next/build-manifest.json (rootMainFiles+polyfillFiles) + .next/server/app/**/page_client-reference-manifest.js (clientModules)",
    method:
      "budget = baseline × (1 + margines), zaokrąglony w górę do 1 KiB; trasy krytyczne mają ciaśniejszy margines. Regeneracja: node scripts/perf-budget-check.mjs --update",
    followUp:
      "Runtime LCP/CLS/INP odłożone — wymagają Lighthouse/stagingu z przeglądarką (osobna bramka).",
    margins: marginesy,
    shared: {
      baselineBytes: pomiar.shared,
      budgetBytes: zaokraglijDoKiB(pomiar.shared, marginesy.shared),
    },
    routes,
  };
  writeFileSync(sciezkaBudzetow(apka), `${JSON.stringify(plik, null, 2)}\n`, "utf8");
  return plik;
}

// ── CLI ─────────────────────────────────────────────────────────────────
function drukujRaport(wynik) {
  const { apka, stan, pozycje, problemy, noweTrasy } = wynik;
  process.stdout.write(`\n▸ ${apka} — ${stan.toUpperCase()}\n`);
  if (stan === "brak-budzetow") {
    for (const p of problemy) process.stderr.write(`  BŁĄD: ${p}\n`);
    return;
  }
  for (const p of [...pozycje].sort((a, b) => (b.pomiar ?? 0) - (a.pomiar ?? 0))) {
    const stanTrasy = p.pomiar == null ? "BRAK W BUILDZIE" : p.nad ? "PRZEKROCZENIE" : "ok";
    const marker = p.nad ? "✗" : p.pomiar == null ? "·" : "✓";
    const kryt = p.krytyczna ? " [krytyczna]" : "";
    const pomiarTxt = p.pomiar == null ? "     —  " : kb(p.pomiar).padStart(9);
    process.stdout.write(
      `  ${marker} ${pomiarTxt} / ${kb(p.budzet).padStart(9)}  ${p.trasa}${kryt}  ${stanTrasy === "ok" ? "" : `(${stanTrasy})`}\n`,
    );
  }
  if (noweTrasy.length)
    process.stdout.write(
      `  · ${noweTrasy.length} trasa(y) bez budżetu (informacyjnie, nie pali bramki): ${noweTrasy.join(", ")}\n`,
    );
  for (const p of problemy) process.stderr.write(`  REGRESJA: ${p}\n`);
}

function main(argv) {
  const args = argv.slice(2);
  const update = args.includes("--update");
  const apki = args.filter((a) => !a.startsWith("--"));
  const cele = apki.length ? apki : APKI;

  let regresja = false;
  for (const apka of cele) {
    if (!APKI.includes(apka)) {
      process.stderr.write(`Nieznana apka: ${apka} (dozwolone: ${APKI.join(", ")})\n`);
      return 2;
    }
    if (update) {
      if (!maBuild(apka)) {
        process.stderr.write(`\n▸ ${apka}: brak .next — najpierw \`next build\` w apps/${apka}\n`);
        regresja = true;
        continue;
      }
      const plik = aktualizujBudzety(apka);
      process.stdout.write(
        `\n▸ ${apka}: zapisano perf-budgets.json — shared ${kb(plik.shared.baselineBytes)}, ${Object.keys(plik.routes).length} tras\n`,
      );
      continue;
    }
    if (!maBuild(apka)) {
      process.stdout.write(`\n▸ ${apka} — POMINIĘTO (brak .next; uruchom \`next build\`)\n`);
      continue;
    }
    const wynik = sprawdzApke(apka);
    drukujRaport(wynik);
    if (wynik.stan === "regresja" || wynik.stan === "brak-budzetow") regresja = true;
  }

  if (!update)
    process.stdout.write(
      regresja
        ? "\nWERDYKT: budżety wydajności PRZEKROCZONE\n"
        : "\nWERDYKT: budżety wydajności zachowane\n",
    );
  return regresja ? 1 : 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main(process.argv));
  } catch (error) {
    process.stderr.write(`BŁĄD bramki budżetów wydajności: ${error?.stack ?? error}\n`);
    process.exit(1);
  }
}
