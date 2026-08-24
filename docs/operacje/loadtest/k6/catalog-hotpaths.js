// =====================================================================
// Avably — harness obciążeniowy k6 dla PUBLICZNYCH hot-ścieżek odczytu sklepu.
// Audyt skalowalności PRZED-LAUNCH (ADR-250).
//
// URUCHAMIAJ WYŁĄCZNIE PRZECIW IZOLOWANEMU ŚRODOWISKU (dedykowany lokalny
// stack na osobnym porcie ALBO staging). NIGDY przeciw produkcji. NIGDY
// przeciw współdzielonej lokalnej bazie, na której pracują inne sesje —
// szczegóły i uzasadnienie w README.md obok.
//
// Instalacja k6:   brew install k6         (albo https://k6.io/docs)
// Przykład:
//   BASE_URL=https://demo.localhost:3000 \
//   CATEGORY_SLUGS=namioty,plecaki,rowery \
//   PRODUCT_SLUGS=namiot-4-osobowy,plecak-60l \
//   VUS=20 DURATION=1m \
//   k6 run docs/operacje/loadtest/k6/catalog-hotpaths.js
// =====================================================================

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend } from "k6/metrics";
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

// --- Parametry (środowiskowe, z sensownymi domyślnymi) ---
const BASE_URL = (__ENV.BASE_URL || "").replace(/\/$/, "");
if (!BASE_URL) {
  throw new Error("Ustaw BASE_URL (origin izolowanego sklepu, np. https://demo.localhost:3000).");
}
const VUS = parseInt(__ENV.VUS || "10", 10);
const DURATION = __ENV.DURATION || "30s";
const RAMP = __ENV.RAMP || "10s";

// Slugi kategorii/produktów istniejące u testowego najemcy. Bez nich strony
// kategorii/produktu zwrócą 404 i pomiar będzie fałszywie „szybki".
const CATEGORY_SLUGS = (__ENV.CATEGORY_SLUGS || "").split(",").map((s) => s.trim()).filter(Boolean);
const PRODUCT_SLUGS = (__ENV.PRODUCT_SLUGS || "").split(",").map((s) => s.trim()).filter(Boolean);

// Głębokość paginacji do testu (ile stron katalogu jest realnie osiągalnych).
const CATALOG_PAGES = parseInt(__ENV.CATALOG_PAGES || "5", 10);
// Warianty sortu strony kategorii (lustro ADR-244).
const SORTS = ["", "cena-rosnaco", "cena-malejaco", "najnowsze"];

// Opcjonalna ścieżka API dostępności (GET /api/v1/availability) wymaga klucza
// API (ADR-108). Uruchamiana TYLKO gdy podasz API_KEY i AVAIL_PRODUCT_ID.
const API_KEY = __ENV.API_KEY || "";
const AVAIL_PRODUCT_ID = __ENV.AVAIL_PRODUCT_ID || "";

// --- Metryki per ścieżka (p50/p95/p99 rozdzielnie) ---
const tHome = new Trend("path_home", true);
const tKatalog = new Trend("path_katalog", true);
const tKategoria = new Trend("path_kategoria", true);
const tProdukt = new Trend("path_produkt", true);
const tAvailability = new Trend("path_availability", true);

export const options = {
  scenarios: {
    hotpaths: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS },
        { duration: DURATION, target: VUS },
        { duration: RAMP, target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    // Bramki orientacyjne — dostrój do SLO stagingu. Odczyt publiczny sklepu
    // powinien mieścić się grubo poniżej sekundy w p95.
    http_req_failed: ["rate<0.01"],
    "http_req_duration{group:::home}": ["p(95)<800"],
    "http_req_duration{group:::katalog}": ["p(95)<800"],
    "http_req_duration{group:::kategoria}": ["p(95)<800"],
    "http_req_duration{group:::produkt}": ["p(95)<800"],
  },
  // Staging bywa za self-signed cert (localhost) — nie wywracaj testu na TLS.
  insecureSkipTLSVerify: true,
};

function pick(arr) {
  return arr[randomIntBetween(0, arr.length - 1)];
}

function get(path, trend) {
  const res = http.get(`${BASE_URL}${path}`, { tags: { path } });
  trend.add(res.timings.duration);
  check(res, {
    "status 200": (r) => r.status === 200,
  });
  return res;
}

export default function () {
  // HOME /store (pełny katalog, cache międzyżądaniowy ADR-185) — waga wysoka.
  group("home", () => {
    get("/", tHome);
  });

  // KATALOG stronicowany /katalog?strona=N (odczyt get_public_catalog_page).
  group("katalog", () => {
    const page = randomIntBetween(1, CATALOG_PAGES);
    get(page === 1 ? "/katalog" : `/katalog?strona=${page}`, tKatalog);
  });

  // STRONA KATEGORII /kategoria/{slug}?sort=&strona= (get_public_category_page,
  // join M:N + sort + paginacja) — najgorętsza NOWA ścieżka.
  if (CATEGORY_SLUGS.length) {
    group("kategoria", () => {
      const slug = pick(CATEGORY_SLUGS);
      const sort = pick(SORTS);
      const page = randomIntBetween(1, 3);
      const qs = [];
      if (sort) qs.push(`sort=${sort}`);
      if (page > 1) qs.push(`strona=${page}`);
      const suffix = qs.length ? `?${qs.join("&")}` : "";
      get(`/kategoria/${slug}${suffix}`, tKategoria);
    });
  }

  // STRONA PRODUKTU /produkt/{slug} (get_public_product).
  if (PRODUCT_SLUGS.length) {
    group("produkt", () => {
      get(`/produkt/${pick(PRODUCT_SLUGS)}`, tProdukt);
    });
  }

  // DOSTĘPNOŚĆ (opcjonalnie) — GET /api/v1/availability wymaga klucza API.
  if (API_KEY && AVAIL_PRODUCT_ID) {
    group("availability", () => {
      const start = "2026-09-01";
      const end = "2026-09-08";
      const res = http.get(
        `${BASE_URL}/api/v1/availability?product_id=${AVAIL_PRODUCT_ID}&start_date=${start}&end_date=${end}`,
        { headers: { Authorization: `Bearer ${API_KEY}` }, tags: { path: "/api/v1/availability" } },
      );
      tAvailability.add(res.timings.duration);
      check(res, { "availability 200": (r) => r.status === 200 });
    });
  }

  // Odstęp między iteracjami — modeluje myślenie użytkownika, nie DDoS.
  sleep(randomIntBetween(1, 3));
}
