# Audyt env — rate-limit i cache host→tenant (Upstash)

**Data:** 10 sierpnia 2026 r.
**Zakres:** zmienne środowiskowe czytane przez `@avably/security/rate-limit`
(ADR-106) oraz przez `apps/storefront/lib/tenant/cache.ts` (ADR-039) — jedyne
dwa miejsca w repo, gdzie backend z pamięcią współdzieloną (Postgres/Upstash)
ma fallback in-memory per-instancja. Nie jest to pełny inwentarz env repo —
tylko powierzchnia bezpośrednio powiązana z tym długiem.
**Powód powstania:** aneks ADR-039/ADR-106 (`docs/dokumentacja/index.html`,
sekcje „Dziennik decyzji" i „Dziennik budowy") — zmiana `rate-limit.ts` na
niecichy fallback przy braku konfiguracji na Vercelu. Bez wartości sekretów.

## 1. Tabela zmiennych

| Zmienna | Gdzie używana | Skutek braku | Wymagana na prod? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `packages/security/src/rate-limit.ts` (`getDbConfig`) — WSPÓLNA ze wszystkimi klientami Supabase w obu apkach, nie dedykowana rate-limitowi | `checkRateLimit` pomija Postgres i liczy in-memory (per instancja). Od 2026-08-10: na Vercelu (`VERCEL=1`) bez tej zmiennej leci **jednorazowe `console.warn`** przy pierwszym wywołaniu `checkRateLimit`. Poza rate-limitem: cała reszta apki i tak przestaje działać bez tej zmiennej (klient Supabase), więc w praktyce na prawdziwym prodzie zawsze jest ustawiona. | **Tak** — pośrednio wymagana przez resztę apki niezależnie od rate-limitu. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | jw., para z URL | jw. (obie muszą być NIEPUSTE — `firstNonEmptyEnv` odrzuca `""`) | **Tak**, jw. |
| `SUPABASE_LOCAL_API_URL` | jw. — alias dla lokalnego CI (job `rls`, harness `packages/db/test`) | Brak wpływu na prod: to WYŁĄCZNIE nazwa lokalna, czytana dopiero gdy `NEXT_PUBLIC_SUPABASE_URL` jest puste | Nie — celowo lokalna/CI |
| `SUPABASE_LOCAL_ANON_KEY` | jw., para z `SUPABASE_LOCAL_API_URL` | jw. | Nie |
| `VERCEL` | `packages/security/src/rate-limit.ts` (`isVercelRuntime`) — zmienna PLATFORMOWA, nigdy nie konfigurowana ręcznie | Poza Vercelem (dev, `next start` lokalnie, CI GitHub Actions) ta zmienna jest nieustawiona **z definicji** — dlatego brak konfiguracji bazy tam zostaje CICHY, tak jak dotąd. To jest zamierzone, nie luka: patrz §3 | Nie dotyczy — ustawia ją Vercel automatycznie (build i runtime) |
| `UPSTASH_REDIS_REST_URL` | `apps/storefront/lib/tenant/cache.ts` (`getRedis`) — cache host→tenant, **NIE dotyczy rate-limitu** | Fallback in-memory per-instancja: POPRAWNOŚCIOWO BEZPIECZNY (resolve przechodzi przez `app.resolve_tenant_by_slug`/`resolve_tenant_by_domain` i tak, RLS nietknięte), tylko mniej skuteczny — więcej zapytań do bazy przy wielu instancjach. Świadomie BEZ niecichego sygnału (patrz §3) | Nie — optymalizacja, nie kontrola bezpieczeństwa |
| `UPSTASH_REDIS_REST_TOKEN` | jw., para z URL | jw. | Nie |

## 2. Co NIE jest w tabeli i dlaczego

`Redis` z `@upstash/redis` bywa mylona z martwym kodem, bo starsza wersja
`rate-limit.ts` faktycznie z niej korzystała, a ADR-106 przeniósł limiter na
Postgres. **Zależność `@upstash/redis` (`apps/storefront/package.json`) jest
ŻYWA** — jedyny konsument to `cache.ts` z tabeli wyżej. Usunięcie jej wywali
build storefrontu. To jest treść aneksu w §3 dokumentacji architektury; ten
dokument tylko wylicza zmienne, aneks tłumaczy decyzję.

## 3. Asymetria dwóch fallbacków — dlaczego jeden jest niecichy, a drugi nie

Oba mechanizmy (rate-limit i cache host→tenant) mają identyczny KSZTAŁT
degradacji — backend współdzielony → fallback `Map` per instancja — ale różną
WAGĘ awarii cichej:

- **Rate-limit bez bazy na Vercelu** = kontrola bezpieczeństwa (anti-abuse
  login/register/reset, throttling checkoutu) przestaje realnie chronić
  globalnie, a nic tego nie sygnalizuje. Stąd niecichy `console.warn` (aneks
  ADR-106, 2026-08-10).
- **Cache host→tenant bez Upstasha** = wyłącznie optymalizacja odczytu.
  Poprawność routingu tenanta stoi na `app.resolve_tenant_by_slug` /
  `resolve_tenant_by_domain` (SECURITY DEFINER) niezależnie od tego, czy
  wynik jest cache'owany w Redis, w `Map`, czy wcale — brak cache'u kosztuje
  dodatkowe zapytania do Postgresa, nie otwiera dziury. Dodanie tu tego
  samego niecichego sygnału byłoby szumem bez odpowiadającego ryzyka, więc
  świadomie ZOSTAJE ciche.

Rozróżnienie „gdzie limit ma znaczenie" (produkcja/serverless) od „dev/test,
gdzie in-memory jest OK" nie opiera się na `NODE_ENV` — `next start` ustawia
`NODE_ENV=production` również przy uruchomieniu lokalnym (ten sam problem
opisany wcześniej w `apps/panel/.../payments-config.ts`). Sygnałem jest
`process.env.VERCEL === "1"`, zmienna wystawiana przez platformę (build i
runtime), której nie da się ustawić przez pomyłkę lokalnym buildem.

## 4. Ryzyko rezydualne

- Jeśli rate-limit kiedyś dostanie WŁASNĄ, dedykowaną parę env (inny URL/klucz
  niż reszta apki), asymetria z §1 („w praktyce zawsze ustawione, bo reszta
  apki i tak wymaga") znika — ten dokument trzeba wtedy zrewidować, bo cichy
  brak przestanie być tylko teoretyczny.
- Repo nie ma pliku `.env.example` — lista zmiennych żyje wyłącznie w kodzie,
  w tym dokumencie i w `docs/dokumentacja/index.html`. Poza zakresem tego
  zadania; odnotowane jako obserwacja, nie naprawiane tutaj.
- Sygnał `console.warn` trafia do logów runtime Vercela — wymaga, żeby ktoś
  je czytał albo miał alert na wzorzec `[rate-limit]`. Rutyny alertującej
  dziś nie ma (poza zakresem tego zadania).

## 5. Powiązane dokumenty

- `docs/dokumentacja/index.html` — aneks ADR-039/ADR-106 (sekcja „Dziennik
  decyzji") i wpis w „Dzienniku budowy".
- `packages/security/src/rate-limit.ts` — implementacja.
- `packages/security/test/rate-limit.test.ts` — dowód mutacyjny sygnału.
- `apps/storefront/lib/tenant/cache.ts` — **wyłącznie do odczytu w tym
  zadaniu**, nietknięty.
