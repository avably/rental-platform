# Harness obciążeniowy k6 — publiczne hot-ścieżki sklepu

Skrypt `catalog-hotpaths.js` obciąża publiczne ścieżki odczytu storefrontu:
strona główna sklepu (`/` → `/store`), katalog stronicowany (`/katalog`),
strona kategorii z sortem i paginacją (`/kategoria/{slug}`), strona produktu
(`/produkt/{slug}`) oraz — opcjonalnie — API dostępności
(`GET /api/v1/availability`).

Powstał w ramach audytu skalowalności PRZED-LAUNCH — pełny kontekst i wyniki
statycznego audytu (EXPLAIN) w
[`../2026-08-24-audyt-skalowalnosci.md`](../2026-08-24-audyt-skalowalnosci.md).

## ⛔ Gdzie WOLNO, a gdzie NIE WOLNO uruchamiać

**Uruchamiaj WYŁĄCZNIE przeciw środowisku IZOLOWANEMU:**
- dedykowany lokalny stack storefrontu na **osobnym porcie**, wpięty do
  **osobnej instancji Supabase** (osobny projekt/port), albo
- **staging** z własną bazą.

**NIGDY:**
- **przeciw produkcji** — to realni najemcy i realny ruch;
- **przeciw współdzielonej lokalnej bazie `supabase_db_db` (port 54322)**,
  na której równolegle pracują inne sesje wykonawcze.

### Dlaczego nie współdzielona lokalna baza (kontencja i izolacja)

Lokalny Supabase pod portem 54322 jest **współdzielony** między równoległymi
sesjami (patrz pamięć projektu `shared-supabase-parallel-sessions`,
`self-hosted-ci-vs-parallel-executors`). Ciężki run k6 to setki–tysiące żądań
na sekundę idących przez PostgREST/Kong do **tej samej** puli połączeń
Postgresa. Skutki dla innych sesji:

- **wyczerpanie puli połączeń** → GoTrue zaczyna zwracać 500 (pamięć
  `gotrue-500-pod-presja-i-pusty-blad`), cudze suity integracyjne czerwienią
  się losowo;
- **kontencja CPU/IO** → testy w `packages/db` / panelu / storefroncie łapią
  timeouty (pamięć `pm-parallel-executor-contention`);
- pomiar i tak jest **bezwartościowy**, bo dzielisz zasoby z cudzą pracą —
  mierzysz szum, nie skalowalność.

Izolowany stack odcina te sprzężenia: własna baza, własna pula, własny CPU.

## Przygotowanie izolowanego stacku (lokalnie)

1. **Osobna instancja Supabase** (nie ta na 54322). Najprościej — osobny
   klon repo / worktree z własnym `supabase/config.toml` i przesuniętymi
   portami, wtedy `supabase start` postawi komplet kontenerów na innych
   portach. Zastosuj migracje z `packages/db/supabase/migrations/`.
2. **Zasiej testowego najemcę z realistycznym wolumenem** (~500–1000 produktów,
   ~30 kategorii, przypisania M:N, egzemplarze, kilka zamówień). Gotowy,
   idempotentny seed w transakcji jest w
   [`../explain-audit.sql`](../explain-audit.sql) — dla runu k6 zamień końcowe
   `ROLLBACK;` na `COMMIT;` (na **izolowanej** bazie!), albo wyprowadź z niego
   osobny skrypt zasiewu. Zapisz `slug` kilku kategorii i produktów.
3. **Storefront** wskaż na tę izolowaną bazę (env `NEXT_PUBLIC_SUPABASE_URL`,
   klucze, `SUPABASE_LOCAL_*`) i podnieś na osobnym porcie. Host najemcy
   rozwiązuje proxy po nagłówku (ADR-039) — użyj hosta demo, który testowy
   tenant ma przypisany (np. `demo.localhost:PORT`).

## Uruchomienie

```bash
brew install k6   # jeśli nie masz (albo https://k6.io/docs/get-started)

BASE_URL=https://demo.localhost:3000 \
CATEGORY_SLUGS=namioty,plecaki,rowery \
PRODUCT_SLUGS=namiot-4-osobowy,plecak-60l \
VUS=20 DURATION=1m RAMP=10s \
k6 run docs/operacje/loadtest/k6/catalog-hotpaths.js
```

### Parametry (env)

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `BASE_URL` | — (wymagane) | Origin izolowanego sklepu testowego najemcy. |
| `VUS` | `10` | Wirtualni użytkownicy na plateau. |
| `DURATION` | `30s` | Czas plateau (po ramp-up). |
| `RAMP` | `10s` | Czas narastania i wygaszania. |
| `CATALOG_PAGES` | `5` | Ile stron `/katalog?strona=N` jest osiągalnych. |
| `CATEGORY_SLUGS` | — | Lista slugów kategorii po przecinku (bez nich pomijamy ścieżkę kategorii). |
| `PRODUCT_SLUGS` | — | Lista slugów produktów po przecinku. |
| `API_KEY` + `AVAIL_PRODUCT_ID` | — | Włączają scenariusz `GET /api/v1/availability` (klucz API wg ADR-108). |

### Odczyt wyników

k6 wypisuje na koniec `http_req_duration` (avg/min/med/max/**p90/p95**) oraz
`http_req_failed`. Rozdzielne trendy per ścieżka: `path_home`, `path_katalog`,
`path_kategoria`, `path_produkt`, `path_availability`. Po p99 dorzuć
`--summary-trend-stats="avg,min,med,p(90),p(95),p(99),max"`. Progi (`thresholds`
w skrypcie) są orientacyjne — dostrój do SLO stagingu.

> Uwaga: `CATEGORY_SLUGS`/`PRODUCT_SLUGS` MUSZĄ istnieć u testowego najemcy —
> inaczej strony zwrócą 404 i pomiar będzie fałszywie „szybki" (404 nie wykonuje
> gorącego odczytu). Skrypt sprawdza `status 200`.
