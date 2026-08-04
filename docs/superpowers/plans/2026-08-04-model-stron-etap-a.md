# Model stron — ETAP A: projekt (bez kodu produkcyjnego)

**Zadanie:** pinezki właściciela `990e69e0 p2` + `133cc3ad`. Decyzja właściciela uchyla „jedną stronę per tenant" z 2026-07-29.
**Numery przydzielone z góry:** migracja **0048**, **ADR-093**. Więcej nie potrzeba.
**Gałąź:** `feat/model-stron` od `origin/main` (`74c3890`).
**Wynik etapu:** ten dokument + szkic DDL (NIEWYKONANY) + lista zmian UX. Stop, czekam na zatwierdzenie.

---

## 0. Rozstrzygnięcie zakresu — czytam brief inaczej niż „wielostronicowy serwis"

Zanim cokolwiek: „wiele stron" ma tu dwa możliwe znaczenia i różnią się one całą architekturą.

- **(A) WERSJE STRONY.** Sklep pokazuje klientowi jedną stronę; w panelu leży ich kilka, a operator przełącza, która jest żywa. Adres sklepu bez zmian.
- **(B) SERWIS WIELOSTRONICOWY.** Sklep ma `/o-nas`, `/kontakt`; każda strona ma slug i własny adres publiczny.

Brief opisuje **(A)** i tylko (A): pkt 1 mówi o „wersji roboczej", pkt 3 o „przełączeniu sklepu na wskazaną stronę **jednym zdarzeniem**". W (B) nie ma czego przełączać — wszystkie strony są publiczne naraz.

Projekt niżej realizuje **(A)**. Konsekwencja praktyczna jest duża i warto ją zobaczyć od razu: przy (A) **`app.get_published_site` nie zmienia się ani o bajt** — dziś już wybiera stronę warunkiem `published_at is not null`, a jedyne, czego brakuje, to gwarancja, że taka strona jest najwyżej jedna. Przy (B) trzeba by zmienić sygnaturę RPC, kopertę, routing storefrontu i parser w `@avably/core/site`.

**Do potwierdzenia przez PM:** jeśli intencją było (B), ten dokument jest do wyrzucenia, a zadanie jest kilkukrotnie większe.

---

## 1. Stan zastany — zweryfikowany, nie przepisany z briefu

Sprawdzone w repo i **sondami na żywej bazie** (lokalny Supabase, `schema_migrations` = 0047, czyli równo z prodem).

| Premisa briefu | Werdykt |
|---|---|
| `sites` ma `sites_tenant_unique (tenant_id)` | **Prawda.** Obok stoi `sites_tenant_id_key UNIQUE (tenant_id, id)` — cel złożonych FK z `site_sections` i `site_image_uploads`; **ten unikat musi zostać**. |
| bliźniaki `*_published` w tych samych wierszach sekcji | **Prawda.** Plus bliźniaki na `sites`: `template_published`, `style_published`. |
| `get_published_site` czyta wyłącznie `*_published` + `type` | **Prawie.** Czyta też `sites.published_at` (i zwraca ją w kopercie), `style_published`, oraz `tenants.status`. Istotne: **`published_at` JEST DZIŚ ZNACZNIKIEM ŻYWOŚCI** — to jest oś, na której da się zbudować cały model bez nowej kolumny. |
| trigger `guard_published_columns` broni bliźniaków (42501) | **Prawda**, ale wisi jako **`BEFORE INSERT OR UPDATE`** — `DELETE` nie jest pilnowany wcale. |
| nagrobki `deleted_in_draft` z CHECK-iem 0045 | Prawda. |
| unikat stopki per `site_id` | **Prawda i dobrze** — jest per strona, więc każda wersja ma własną stopkę bez zmian. |

### Dwa znaleziska z sond, których brief nie zawiera

**Znalezisko 1 — dwie żywe strony nie dają błędu, dają NIEDETERMINIZM.**
Zdjąłem unikat w transakcji, opublikowałem dwie strony jednego tenanta i wywołałem RPC:

```
zywych_stron | 2
ktora_strona | classic     ← cicho wybrana pierwsza z niesortowanego skanu
```

Funkcja jest `language sql returns jsonb`, więc **zwraca pierwszy wiersz zamiast paść**. Gdyby unikatu nie zastąpić czymś równie twardym, „miks dwóch stron" nie byłby awarią do zauważenia, tylko losowym wyborem przy każdym planie zapytania. To jest argument, dla którego jedyność żywej strony musi być **indeksem**, a nie konwencją w akcji.

**Znalezisko 2 — dziś członek MOŻE skasować żywą stronę, bez publikacji.**
`authenticated` ma `DELETE` na `public.sites`, polityka `tenant_delete USING (tenant_id = app.tenant_id())` przepuszcza, a triggera `BEFORE DELETE` nie ma. Sonda z ustawionym claimem tenanta:

```
DELETE 1
po_delete | 0
```

Czyli: jednym żądaniem PostgREST operator gasi sklep — a `app.get_published_site` zaczyna zwracać `null` bez żadnego zdarzenia publikacji. To jest **istniejąca dziura w kanonie ADR-091**, niezwiązana z tym zadaniem, którą 0048 przy okazji zamyka. Zgłaszam ją wprost, bo jest na prodzie już teraz.

**Znalezisko 3 — dlaczego pinezka `990e69e0 p2` w ogóle powstała.**
`applyStarterTemplate` (`apps/panel/lib/actions/site.ts:642`) na stronie OPUBLIKOWANEJ oznacza wszystkie opublikowane sekcje `deleted_in_draft = true`. „Zacznij od nowa" na żywej stronie musi więc zostawić nagrobki — inaczej złamałoby ADR-091. Nowa strona jako **osobny wiersz `sites`** rozwiązuje to u źródła: na świeżej stronie nic nigdy nie było opublikowane, więc nie ma czego chronić i nie ma nagrobków. Model stron nie jest tu ozdobą — jest jedynym czystym wyjściem z tej pinezki.

---

## 2. Decyzje

### D1. Zdejmujemy `sites_tenant_unique`, zakładamy unikat CZĘŚCIOWY po żywości

```sql
drop constraint sites_tenant_unique;
create unique index sites_one_live_per_tenant_idx on public.sites (tenant_id) where published_at is not null;
```

Niezmiennik zmienia się z „jedna strona na tenanta" na **„najwyżej jedna ŻYWA strona na tenanta"**. `sites_tenant_id_key (tenant_id, id)` zostaje nietknięty.

**Dlaczego `published_at`, a nie nowa kolumna `is_live`:**
- `published_at` już dziś znaczy „ta strona jest publiczna" — `get_published_site` filtruje dokładnie po niej;
- jest już **na liście strażnika** (`guard_published_columns` broni jej wprost), więc kanon ADR-091 obejmuje ją bez dopisywania czegokolwiek;
- **`get_published_site` zostaje bajtowo identyczna** → strażnik strukturalny i kontrakt „koperta zgodna z odczytem sprzed 0045" nie ruszają się z miejsca;
- nowa kolumna `is_live` byłaby drugą prawdą o tym samym i wymagałaby własnego wpisu w strażniku oraz CHECK-a spinającego ją z `published_at`.

**Koszt, nazwany wprost:** strona zdjęta ze sklepu traci datę ostatniej publikacji (`published_at := null`). Nie dokładam `last_published_at` — to informacja wyłącznie kosmetyczna dla listy, a każda kolumna obok `published_at` zaprasza do rozjazdu. Jeśli właściciel zechce ją widzieć, to osobna, tania decyzja.

**Odrzucone:** `tenants.live_site_id` (wskaźnik) — przenosi niezmiennik do drugiej tabeli, wymaga FK i triggera pilnującego, że wskazana strona należy do tego tenanta, a `get_published_site` musiałby dostać JOIN. Ta sama gwarancja, więcej ruchomych części.

### D2. Bliźniaki `*_published` ZOSTAJĄ w wierszach sekcji i w `sites`

Zgodnie z rekomendacją PM. Model per strona się nie zmienia — zmienia się liczba stron i wybór żywej. Strona zdjęta ze sklepu **zachowuje swoje bliźniaki**: nikt ich nie czyta (bo `published_at is null`), strażnik dalej broni ich przed zapisem spoza `publish_site`, a ponowna publikacja tej strony i tak je nadpisze ze szkicu. Nagrobki na takiej stronie też zostają — to jej sprawa, nie sklepu.

**Odrzucone:** czyszczenie bliźniaków przy zdejmowaniu strony. Wymagałoby kasowania nagrobków (inaczej `site_sections_tombstone_published` pada), czyli **utraty danych przy operacji, która ma być odwracalna**.

### D3. `publish_site` przełącza żywą stronę w JEDNEJ transakcji

Nowa treść funkcji dokłada dokładnie jedno zdanie SQL przed dotychczasowym ciałem: zdjęcie poprzedniej żywej strony tego tenanta.

Kolejność jest wymuszona przez unikat częściowy (najpierw zgaś starą, potem zapal nową). Całość leci pod flagą `app.publishing`, więc oba zapisy przechodzą przez strażnika; wyjątek w środku (np. `site_not_found`) wycofuje transakcję razem ze zgaszeniem — sklep nigdy nie zostaje bez strony.

**Brak okna miksu** wynika z izolacji, nie z ostrożności: `get_published_site` czyta `sites` i `site_sections` w JEDNYM zapytaniu, więc widzi jedną migawkę — albo sprzed transakcji, albo po niej.

**Odrzucone: osobny czasownik „przełącz bez publikowania"** (przestaw wskaźnik, nie kopiuj szkicu). Kuszące, bo nie dotyka treści — ale daje DRUGI sposób, w jaki zmienia się to, co widzi klient. Kanon mówi „publikacja jedyną bramką", więc zostaje jeden czasownik: **przełączenie sklepu na stronę B TO opublikowanie strony B**. Skutek uboczny do nazwania w UX: jeśli operator zdążył ruszyć szkic strony B, przełączenie wypuści też te zmiany — dialog potwierdzenia musi to powiedzieć.

### D4. Twardy DELETE strony nieżywej — dozwolony. Żywej — zabroniony triggerem

Nowa funkcja `app.guard_live_site_delete()` + trigger `BEFORE DELETE ON public.sites`: odmowa **42501**, gdy `old.published_at is not null`; przepustka dla `service_role` (kaskada z `tenants` przy offboardingu i sprzątaniu testów).

**Dlaczego osobna funkcja, a nie rozszerzenie `guard_published_columns`:** tamta jest `BEFORE INSERT OR UPDATE` i w każdej gałęzi sięga po `new`, którego przy DELETE nie ma. Dokładanie tam gałęzi `tg_op = 'DELETE'` znaczyłoby przepisanie funkcji chronionej 19 testami po to, żeby dołożyć rozłączną odpowiedzialność. Jedna funkcja = jedno zdanie.

**Dowód, że twardy DELETE strony nieżywej jest bezpieczny na kanonie ADR-091** (brief żąda dowodu, nie zapewnienia):

1. Jedyna publiczna ścieżka odczytu to `app.get_published_site` — anon nie ma grantów na `sites` ani `site_sections` (sprawdzone: brak `anon` w `role_table_grants`).
2. Ta funkcja bierze wiersze `sites` **wyłącznie** przez `where s.tenant_id = p_tenant_id and s.published_at is not null`, a sekcje przez `sec.site_id = s.id`.
3. Strona z `published_at is null` nie spełnia warunku (2), więc **nie wnosi do koperty ani jednego bajtu** — niezależnie od stanu swoich sekcji, bliźniaków i nagrobków.
4. Kasowanie takiej strony usuwa ją i (kaskadą FK złożonego) jej sekcje — czyli wyłącznie wiersze, które w (3) nie miały wpływu na kopertę.
5. Zatem koperta przed i po jest identyczna. ∎
6. Nagrobki istnieją po to, by chronić treść **stojącą na żywej stronie**; na stronie nigdy niewskazanej jako żywa nie ma czego chronić. Nagrobek na takiej stronie jest artefaktem jej własnej historii, nie zobowiązaniem wobec klienta.
7. Jedyny przypadek, w którym DELETE zmieniłby kopertę — kasowanie strony ŻYWEJ — jest odmawiany w bazie (trigger wyżej), a nie w akcji.

Punkty 5 i 7 mają dostać **pomiar empiryczny** w pakiecie bramki publikacji (§6), a nie zostać przy rozumowaniu.

### D5. Strona dostaje nazwę

`sites.name text not null default 'Strona sklepu'` + CHECK długości 1–80. Lista bez etykiet jest nieużywalna. Kolumna jest **wyłącznie szkicowa**: `get_published_site` jej nie czyta, więc nie ma bliźniaka i nie wchodzi do strażnika. Default obsługuje wiersze istniejące — migracja nie wymaga backfillu.

### D6. Limit liczby stron — `MAX_SITES = 10`, po stronie aplikacji

Symetrycznie do `MAX_SECTIONS = 100` (też aplikacyjny). Limit jest decyzją produktową, nie niezmiennikiem danych; docelowo prawdopodobnie różnicowany planem — wtedy przeniesie się do `subscriptions`, a nie do CHECK-a.

### D7. Trasy panelu dostają segment strony

`/strona` → lista. `/strona/[siteId]/kreator`, `/strona/[siteId]/podglad`. Bez segmentu kreator nie ma czym wybrać strony, a `getSiteWithSections()` (dziś `maybeSingle()` po `tenant_id`) **wywala się na drugiej stronie** — to jest twardy punkt pęknięcia, nie kosmetyka.

`ensureSite()` (zakładanie strony jako skutek uboczny wejścia w zakładkę) przestaje mieć sens i znika na rzecz jawnej akcji `createSite(name)`. Pusta lista dostaje stan pusty z przyciskiem, nie automat.

### D8. Cache, cron sierot i macierz RLS

- **Cache:** `revalidateTag(tenantCacheTag(tenantId))` jest per TENANT i emitowany wyłącznie przez publikację — przełączenie strony to publikacja, więc tag idzie jak dotąd. **Zero zmian.** Utworzenie i skasowanie strony nieżywej **nie emitują tagu** (nic publicznego się nie zmieniło) — zgodnie z komentarzem, który już stoi przy `deleteSection`.
- **Cron sierot zdjęć:** `app.site_image_paths_in_use` skanuje `site_sections` globalnie, bez `site_id` — jest obojętny na liczbę stron. **Zero zmian.** Dochodzi jeden test negatywny: zdjęcie użyte na INNEJ stronie tego samego tenanta nie może zostać uznane za sierotę. Skutek uboczny do zapisania w ADR: skasowanie strony czyni jej zdjęcia sierotami i cron je posprząta — to jest zachowanie pożądane.
- **Macierz RLS:** polityki `sites` (`tenant_select/insert/update/delete`) działają bez zmian dla wielu wierszy. Do poprawienia jest **fabryka w `seed-tenants.ts:470`**, która dziś obchodzi `UNIQUE(tenant_id)` jednorazowym kasowaniem strony tenanta; po 0048 obejście staje się zbędne, a jego komentarz nieprawdziwy. Nowej tabeli per-tenant nie dokładamy, więc rejestr fabryk i `MUTATION_PATCHES` (`sites: { template: "bold" }`) zostają.

---

## 3. Szkic migracji 0048 (DDL — NIEWYKONANY)

Celowo **nie zakładam pliku w `packages/db/supabase/migrations/`**: ten katalog jest skanowany przez narzędzia, a plik w nim znaczy „zastosuj mnie". Poniżej pełna treść do przeniesienia 1:1 w etapie B, razem z markerami.

```sql
-- =====================================================================
-- 0048 — MODEL STRON: wiele wersji strony, jedna ŻYWA (K7, ADR-093)
-- =====================================================================
--
-- Do 0047 tenant miał DOKŁADNIE JEDNĄ stronę (unikat sites_tenant_unique).
-- Konsekwencja, którą zgłosił właściciel: „zacznij od nowa" na stronie
-- opublikowanej MUSI zostawić nagrobki (ADR-091 nie pozwala skasować treści,
-- którą widzi klient), więc operator nie ma jak zbudować nowej strony na
-- czysto, nie gasząc przy tym sklepu.
--
-- Ta migracja zamienia niezmiennik „jedna strona na tenanta" na „najwyżej
-- JEDNA ŻYWA strona na tenanta". Wersje robocze są zwykłymi wierszami `sites`
-- bez `published_at`; publikacja przełącza, która z nich jest żywa.
--
-- CZEGO TA MIGRACJA NIE RUSZA: app.get_published_site zostaje BAJTOWO
-- IDENTYCZNA. Już dziś wybiera stronę warunkiem `published_at is not null` —
-- brakowało jej wyłącznie gwarancji, że taka strona jest jedna. Gwarancję daje
-- unikat częściowy z sekcji 2. Bliźniaki *_published zostają tam, gdzie były.

-- === BEGIN PROD MIGRATION 0048 ===

-- ---------------------------------------------------------------------
-- 1. Nazwa strony (dana WYŁĄCZNIE szkicowa)
-- ---------------------------------------------------------------------
--
-- Lista stron bez etykiet jest nieużywalna. Kolumna nie jest czytana przez
-- app.get_published_site, więc nie dostaje bliźniaka ani wpisu u strażnika —
-- kanon ADR-091 dotyczy kolumn WIDOCZNYCH PUBLICZNIE, a ta nią nie jest.
-- Default obsługuje wiersze istniejące; backfill nie jest potrzebny.

alter table public.sites
  add column if not exists name text not null default 'Strona sklepu';

alter table public.sites
  drop constraint if exists sites_name_length_check;

alter table public.sites
  add constraint sites_name_length_check
  check (char_length(btrim(name)) between 1 and 80);

comment on column public.sites.name is
  'Nazwa wersji strony widoczna WYŁĄCZNIE w panelu (lista stron). Nie wchodzi do koperty publicznej, więc nie ma bliźniaka *_published (ADR-093).';

-- ---------------------------------------------------------------------
-- 2. Jedna ŻYWA strona na tenanta zamiast jednej strony na tenanta
-- ---------------------------------------------------------------------
--
-- Unikat CZĘŚCIOWY, nie zwykły: wersji roboczych może być wiele, żywa jest
-- najwyżej jedna. Predykat jest tą samą prawdą, którą czyta odczyt publiczny,
-- więc nie da się ich rozjechać.
--
-- DLACZEGO INDEKS, A NIE REGUŁA W AKCJI: przy dwóch żywych stronach
-- app.get_published_site NIE PADA — jest funkcją `language sql returns jsonb`,
-- więc cicho oddaje PIERWSZY wiersz niesortowanego skanu. Zmierzone sondą
-- przed napisaniem tej migracji. Bez indeksu „miks dwóch stron" nie byłby
-- awarią do zauważenia, tylko losowym wyborem przy każdym planie zapytania.
--
-- sites_tenant_id_key UNIQUE (tenant_id, id) ZOSTAJE — to cel złożonych FK
-- z site_sections i site_image_uploads, a nie ograniczenie liczby stron.

alter table public.sites
  drop constraint if exists sites_tenant_unique;

create unique index if not exists sites_one_live_per_tenant_idx
  on public.sites (tenant_id)
  where published_at is not null;

comment on index public.sites_one_live_per_tenant_idx is
  'Najwyżej JEDNA żywa strona na tenanta (ADR-093). Predykat jest lustrem warunku, którym app.get_published_site wybiera stronę — dwie żywe strony dałyby cichy, niedeterministyczny wybór, nie błąd.';

-- ---------------------------------------------------------------------
-- 3. STRONY ŻYWEJ NIE DA SIĘ SKASOWAĆ
-- ---------------------------------------------------------------------
--
-- Stan sprzed tej migracji (zmierzony sondą): `authenticated` ma DELETE na
-- public.sites, polityka tenant_delete przepuszcza własny wiersz, a triggera
-- BEFORE DELETE nie ma — więc członek gasił sklep jednym żądaniem PostgREST,
-- bez żadnego zdarzenia publikacji. Kanon ADR-091 mówi, że stan widoczny
-- publicznie zmienia WYŁĄCZNIE publikacja; kasowanie żywej strony jest taką
-- zmianą, więc musi być odmawiane w BAZIE.
--
-- Osobna funkcja, a nie gałąź w app.guard_published_columns: tamta jest
-- BEFORE INSERT OR UPDATE i w każdej gałęzi sięga po `new`, którego przy
-- DELETE nie ma. Rozszerzanie funkcji chronionej dziewiętnastoma testami
-- o rozłączną odpowiedzialność kosztowałoby więcej, niż daje.
--
-- service_role PRZEPUSZCZANY — kaskada z public.tenants (offboarding, sprzątanie
-- testów) idzie tą rolą, a strona kasowana razem z tenantem nie ma już komu
-- niczego pokazać. Ta sama przepustka i to samo uzasadnienie, co w 0045.
-- SQLSTATE 42501 — jak u strażnika bliźniaków: odmowa uprawnienia,
-- nieodróżnialna od odmowy RLS.

create or replace function app.guard_live_site_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text :=
    'Strony widocznej w sklepie nie można usunąć — najpierw opublikuj inną.';
begin
  if pg_has_role(current_user, 'service_role', 'USAGE') then
    return old;
  end if;

  if old.published_at is not null then
    raise exception '%', c_denied using errcode = '42501';
  end if;

  return old;
end;
$$;

comment on function app.guard_live_site_delete() is
  'Strażnik ŻYWEJ strony (ADR-093): wiersz z published_at nie null kasuje wyłącznie rola serwisowa (kaskada z tenants). Odmowa: 42501 — ten sam SQLSTATE co odmowa RLS i co strażnik bliźniaków.';

drop trigger if exists sites_guard_live_delete on public.sites;
create trigger sites_guard_live_delete
  before delete on public.sites
  for each row execute function app.guard_live_site_delete();

-- ---------------------------------------------------------------------
-- 4. PUBLIKACJA PRZEŁĄCZA ŻYWĄ STRONĘ — jednym zdarzeniem
-- ---------------------------------------------------------------------
--
-- Jedyna zmiana względem 0046: przed podniesieniem nowej strony gasimy
-- poprzednią. Kolejność wymusza unikat częściowy z sekcji 2 (dwie żywe strony
-- nie mogą współistnieć nawet przez jedno zdanie SQL).
--
-- BRAK OKNA MIKSU wynika z izolacji transakcji, nie z ostrożności:
-- app.get_published_site czyta sites i site_sections JEDNYM zapytaniem, więc
-- widzi jedną migawkę — albo sprzed tej transakcji, albo po niej. Wyjątek
-- w środku (site_not_found) wycofuje także zgaszenie starej strony, więc
-- nieudana publikacja nie zostawia sklepu bez strony.
--
-- Bliźniaki strony gaszonej ZOSTAJĄ nietknięte: nikt ich nie czyta (bo
-- published_at jest już null), strażnik dalej broni ich przed zapisem spoza
-- tej funkcji, a ponowna publikacja tej strony nadpisze je ze szkicu.
-- Czyszczenie ich wymagałoby skasowania nagrobków (inaczej pada CHECK
-- site_sections_tombstone_published), czyli utraty danych przy operacji,
-- która ma być odwracalna.

create or replace function app.publish_site(p_site_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_published_at timestamptz := now();
begin
  perform set_config('app.publishing', '1', true);

  -- Zgaszenie poprzedniej żywej strony TEGO SAMEGO tenanta. RLS zawęża zasięg
  -- do stron wołającego, więc zdanie nie ma jak dosięgnąć cudzego sklepu.
  update public.sites
     set published_at = null
   where tenant_id = app.tenant_id()
     and id <> p_site_id
     and published_at is not null;

  update public.sites
     set published_at = v_published_at,
         template_published = template,
         style_published = style_draft
   where id = p_site_id;

  if not found then
    -- Strona nie istnieje ALBO należy do innego tenanta (RLS tnie wiersz) —
    -- celowo ta sama odmowa, żeby nie zdradzać istnienia cudzej strony.
    -- Wyjątek wycofuje transakcję razem ze zgaszeniem wyżej.
    raise exception 'site_not_found' using errcode = '22023';
  end if;

  -- Sekcje usunięte w szkicu znikają z żywej strony DOPIERO teraz.
  delete from public.site_sections
   where site_id = p_site_id
     and deleted_in_draft;

  update public.site_sections
     set content_published = content_draft,
         position_published = "position",
         enabled_published = enabled,
         updated_at = v_published_at
   where site_id = p_site_id;

  perform set_config('app.publishing', '0', true);
  return v_published_at;
end;
$$;

comment on function app.publish_site(uuid) is
  'Publikacja strony storefrontu: PRZEŁĄCZENIE żywej strony tenanta (gaszenie poprzedniej + podniesienie wskazanej) oraz atomowe przeniesienie kompletu stanu widocznego tej strony — treść, kolejność, włączenie, szablon i styl — plus skasowanie sekcji usuniętych w szkicu (ADR-041/090/091/093). SECURITY INVOKER — bramką jest RLS wołającego. JEDYNA droga zapisu kolumn *_published i published_at. Odmowa (brak strony / cudza strona): 22023.';

-- === END PROD MIGRATION 0048 ===
```

**Czego w tej migracji celowo NIE MA:** zmiany `app.get_published_site` (jest niepotrzebna — patrz D1), nowych kolumn publicznych (więc `guard_published_columns` zostaje nietknięty i jego md5 się nie rusza), backfillu (default kolumny `name` załatwia wiersze istniejące), zmian w `site_sections` (model per strona bez zmian).

---

## 4. Wpływ — lista zmian etapu B

### `packages/db`
| Zmiana | Rodzaj |
|---|---|
| migracja 0048 (wyżej) | nowe |
| `test/site-model.test.ts:130` — „druga strona tego samego tenanta → 23505" **asertuje niezmiennik, który znosimy**; do przepisania na „druga strona przechodzi, druga ŻYWA → 23505" | decyzja już podjęta, praca mechaniczna |
| `test/site-publication-gate.test.ts` — nowe operacje w macierzy koperty (§6) | nowe |
| `test/helpers/seed-tenants.ts:470-479` — obejście `UNIQUE(tenant_id)` w fabryce `sites` staje się zbędne; komentarz nieprawdziwy | mechaniczne |
| `src/types.ts` — `Site` dostaje `name` | mechaniczne |

### `apps/panel`
| Zmiana | Rodzaj |
|---|---|
| `lib/site-queries.ts` — `getSiteWithSections(siteId)` (dziś `maybeSingle()` po `tenant_id` — **pęka na drugiej stronie**) + nowe `listSites()` | wymuszone |
| `lib/actions/site.ts` — `ensureSite()` → `createSite(name)`; nowe `renameSite`, `deleteSite`; `publishSite(siteId)` **bez zmian** (już bierze id) | częściowo nowe |
| `lib/site-validation.ts` — `MAX_SITES`, schematy nowych akcji, `siteId` w `toggleSectionInputSchema` (dla symetrii) | mechaniczne |
| trasy: `/strona` (lista), `/strona/[siteId]/kreator`, `/strona/[siteId]/podglad` | wymuszone |
| `app/[locale]/(panel)/strona/site-launcher.tsx` → lista stron (przepisanie) | nowe |
| linki: `lib/shell/nav.ts:67`, `site-builder.tsx:439` (powrót), `site-builder.tsx:497` (podgląd) | mechaniczne |
| `test/site-draft-preview.test.ts:49` i `test/builder-route-dynamic-pin.test.ts` — piny ścieżek tras | mechaniczne, **bez osłabiania asercji** |
| `messages/{pl,en}.json` — nowe klucze `site.pages.*` (parytet EN+PL) | nowe |

### `apps/storefront`
**Zero zmian.** Nie ma ani jednego `from("sites")`; jedyne wejście to RPC `get_published_site`, która się nie zmienia. Do dopisania wyłącznie test potwierdzający, że tak jest.

### Poza zakresem zmian
Cron sierot zdjęć, cache/revalidate, polityki RLS, `guard_published_columns`, model sekcji, stopka, motyw.

---

## 5. Szkic UX

### `/strona` — lista stron (zastępuje dzisiejszy launcher)

```
Strony sklepu                                        [ + Nowa strona ]

┌────────────────────────────────────────────────────────────────────┐
│ Strona główna              ● W SKLEPIE   opublikowana 4 sie, 11:32  │
│                            [ Otwórz kreator ] [ Podgląd ]  [ ⋯ ]   │
├────────────────────────────────────────────────────────────────────┤
│ Wersja jesienna            ○ Robocza     zmieniona 4 sie, 13:05     │
│                    [ Otwórz kreator ] [ Podgląd ] [ Opublikuj ] [⋯]│
└────────────────────────────────────────────────────────────────────┘
```

- Chip statusu na osi `site-publish` — istniejąca oś, dochodzi wartość „robocza".
- `⋯` → **Zmień nazwę**, **Usuń**. Przy stronie żywej „Usuń" jest **wyłączone** z podpowiedzią „Najpierw opublikuj inną stronę" — interfejs mówi to samo, co trigger, i tym samym zdaniem.
- **Stan pusty:** „Nie masz jeszcze żadnej strony." + `[ Utwórz pierwszą stronę ]`. Bez zakładania bytów po cichu (dziś robi to `ensureSite`).
- **Nowa strona** → `createSite` → od razu kreator → galeria szablonów startowych (bo strona jest pusta). To jest ścieżka z pinezki `990e69e0 p2`: czyste płótno, zero nagrobków.

### Dialog publikacji (przełączenie)

Tytuł: „Opublikować stronę «Wersja jesienna»?"
Treść: „Sklep zacznie pokazywać tę stronę. Dotychczasowa strona «Strona główna» przestanie być publiczna, ale zostanie w panelu — możesz do niej wrócić."
Gdy szkic publikowanej strony ma niezapisane zmiany względem jej ostatniej publikacji, dochodzi zdanie: „Opublikowane zostaną też zmiany, które w niej zrobiłeś."

### Dialog usunięcia

Tytuł: „Usunąć stronę «Wersja jesienna»?"
Treść: „Strona i jej sekcje znikną bez śladu. Klienci nigdy jej nie widzieli, więc w sklepie nic się nie zmieni."
(To zdanie jest prawdziwe **dlatego**, że żywej strony usunąć się nie da — patrz D4.)

### Kreator

Górny pasek: powrót „← Strony" (dziś „← Panel") + **nazwa strony** obok tytułu, żeby operator wiedział, którą wersję edytuje. Przycisk „Opublikuj stronę" zostaje i znaczy to samo, co na liście.

### Klucze i18n (nowe, parytet PL/EN)

`site.pages.heading`, `.new`, `.empty`, `.emptyCta`, `.statusLive`, `.statusDraft`, `.changedAt`, `.open`, `.preview`, `.publish`, `.rename`, `.renameTitle`, `.nameLabel`, `.delete`, `.deleteBlocked`, `.deleteTitle`, `.deleteBody`, `.deleteConfirm`, `.switchTitle`, `.switchBody`, `.switchDraftNote`, `.cancel`, `.limitReached`.

---

## 6. Plan testów etapu B

**Rozszerzenie `packages/db/test/site-publication-gate.test.ts`** — pakiet mierzy kopertę `app.get_published_site` przed i po każdej operacji (istniejący wzorzec: tablica operacji + `expect(await envelope(...)).toEqual(baseline)`). Dochodzą:

1. utworzenie DRUGIEJ strony tenanta → koperta bez zmian;
2. zasianie kompletu sekcji na stronie nieżywej (dodanie, kolejność, wyłączenie, nagrobek, styl, szablon) → koperta bez zmian **po każdej operacji**;
3. skasowanie strony nieżywej → koperta bez zmian;
4. próba skasowania strony ŻYWEJ przez członka → **42501**, koperta bez zmian, wiersz na miejscu;
5. `publish_site(B)` przy żywej A → koperta zmienia się **raz**, na treść B, bez ani jednej sekcji A (dowód braku miksu) + `published_at` A wyzerowane, a bliźniaki A nietknięte;
6. `publish_site(A)` z powrotem → koperta wraca do treści A (odwracalność);
7. dwie żywe strony są NIEREPREZENTOWALNE — bezpośredni `update sites set published_at = now()` na drugiej stronie rolą serwisową → **23505** z `sites_one_live_per_tenant_idx`;
8. izolacja: `publish_site` cudzej strony → 22023, żywa strona ofiary nietknięta.

**Dowody mutacyjne (min. 4, w tym jedna na żywej funkcji bazy z restore z pliku i porównaniem md5):**
- M1: zdjęcie `sites_one_live_per_tenant_idx` → czerwony (7);
- M2: usunięcie zdania gaszącego z `publish_site` (mutacja **na żywej funkcji**, restore z pliku migracji + porównanie `md5(pg_get_functiondef(...))` przed/po) → czerwony (5) i (7);
- M3: zdjęcie triggera `sites_guard_live_delete` → czerwony (4);
- M4: `deleteSite` w akcji panelu bez sprawdzenia, czy strona jest żywa → czerwony (4) na poziomie akcji;
- M5 (zapas): `createSite` ustawiający `published_at` przy wstawce → czerwony u strażnika bliźniaków (42501 z `guard_published_columns`).

**Macierz RLS:** cały pakiet `packages/db` lokalnie, z pamięcią o tym, że `BEFORE INSERT` potrafi wyprzedzić unikat — klasyfikacja po TREŚCI błędu, nie po kodzie.

**Weryfikacja przeglądarkowa (pełny cykl):** nowa strona od zera → szablon → edycja → publikacja → sklep pokazuje nową stronę bez miksu → stara strona nadal w panelu → usunięcie starej → sklep bez zmian. Zrzuty na desktopie i 390 px.

---

## 6a. Szkic DDL zmierzony, nie tylko napisany

Cały snippet 0048 został wykonany na lokalnej bazie **w transakcji zakończonej `rollback`** (schemat współdzielony: przed i po `schema_migrations` = 0047, `sites_tenant_unique` na miejscu, zero wierszy po sondach). Na tak zmienionym schemacie zmierzone zostały cztery zdania, na których stoi projekt:

| Sonda | Wynik |
|---|---|
| dwie strony ROBOCZE jednego tenanta | `INSERT` × 2 przechodzi — model wielu wersji działa |
| `publish_site(A)`, potem `publish_site(B)` | po każdej publikacji **`zywych = 1`**; klient widzi kolejno `classic`, potem `bold` — przełączenie bez dwóch żywych stron ani przez chwilę |
| członek kasuje stronę ŻYWĄ | `ERROR: Strony widocznej w sklepie nie można usunąć — najpierw opublikuj inną.` (`guard_live_site_delete`) |
| członek kasuje stronę NIEŻYWĄ | `DELETE 1`, a `get_published_site` dalej zwraca `bold` — **koperta nietknięta**, czyli dowód z §D4 potwierdzony pomiarem |
| druga ŻYWA strona wstawiona wprost rolą serwisową (z pominięciem strażnika) | `ERROR: duplicate key value violates unique constraint "sites_one_live_per_tenant_idx"` |

Ostatni wiersz jest tu najważniejszy: niezmiennik trzyma **nawet wtedy, gdy ktoś obejdzie całą warstwę aplikacji i strażnika**. To jest różnica między regułą a konwencją.

---

## 7. Czego świadomie NIE robię

| Rzecz | Dlaczego nie |
|---|---|
| „Zdejmij stronę ze sklepu" (unpublish) | To zmiana tego, co widzi klient — musiałaby przejść przez bramkę, czyli być nowym RPC. Briefu nie ma w zakresie; do osobnej decyzji. |
| Duplikowanie strony („zrób kopię i eksperymentuj") | Naturalne rozszerzenie, ale brief mówi „od zera". Dołożenie później to jedna akcja i zero zmian w modelu. |
| `last_published_at` na stronie zdjętej ze sklepu | Kosmetyka listy; każda kolumna obok `published_at` zaprasza do rozjazdu. |
| Slug/adres strony, wiele stron publicznych naraz | To wariant (B) z §0 — inna architektura, nie to zadanie. |
| Wspólna stopka dla wszystkich wersji | Stopka jest per strona i tak ma być: wersja robocza ma prawo mieć własną. |
| Limit stron w CHECK-u bazy | Limit jest produktowy (plan taryfowy), nie niezmiennikiem danych. |

---

## 8. Do rozstrzygnięcia przez PM przed etapem B

1. **Zakres (§0):** potwierdzenie, że chodzi o (A) wersje strony, nie (B) serwis wielostronicowy.
2. **Znalezisko 2:** czy zamknięcie dziury „członek kasuje żywą stronę" ma wejść razem z 0048 (rekomendacja: tak — to jedno zdanie w tej samej migracji), czy jako osobna, wcześniejsza poprawka na prod.
3. **`MAX_SITES = 10`** — liczba do akceptacji.
4. **Nazwa domyślna** pierwszej strony przy migracji: `'Strona sklepu'`.
5. **Kształt tras** `/strona/[siteId]/kreator` — akceptacja, bo rusza dwa piny testowe.
