-- =====================================================================
-- 0078 — ZDJĘCIE STRONY ZE SKLEPU: CZASOWNIK, KTÓREGO NIE BYŁO (ADR-170)
-- =====================================================================
--
-- Wada z audytu kreatora (K4, 2026-08-13). Stan przed tą migracją:
--
--   * `published_at` zeruje WYŁĄCZNIE `app.publish_site` — i to tylko jako
--     zdanie gaszące poprzednią stronę, które migracja 0074 USUNĘŁA. Od 0074
--     w całym repo nie ma ani jednej drogi, która zdejmuje stronę ze sklepu.
--   * Żywej strony nie da się usunąć (trigger `sites_guard_live_delete`, 0048)
--     — i to jest poprawne: kasowanie treści, którą widzi klient, jest zmianą
--     stanu publicznego, a ta idzie wyłącznie publikacją (kanon ADR-091).
--   * Odmowa triggera radzi „najpierw opublikuj inną". Rada była prawdziwa
--     do 0073, gdy publikacja PRZEŁĄCZAŁA żywą stronę. Od 0074 strony
--     współistnieją, więc opublikowanie innej nie zmienia w statusie tej
--     ANI JEDNEGO BITU — operator wykonuje polecenie i wraca w to samo miejsce.
--
-- Skutek: strona opublikowana przez pomyłkę (zły adres, nieskończona treść,
-- kampania po terminie) zostaje w sklepie na zawsze i zajmuje jedno z dziesięciu
-- miejsc, a jedyne obejście — wyczyścić sekcje i opublikować pustą ramkę —
-- zostawia adres żywy w rejestrze proxy.
--
-- ==================== CZTERY ROZSTRZYGNIĘCIA ====================
--
-- 1. OSOBNY CZASOWNIK, NIE FURTKA W ISTNIEJĄCYCH. `app.publish_site` zostaje
--    NIETKNIĘTA, trigger żywego usunięcia zostaje w mocy (zmienia się w nim
--    wyłącznie ZDANIE odmowy), strażnik kolumn opublikowanych zostaje
--    nietknięty. Zdjęcie ze sklepu jest zmianą stanu publicznego, więc idzie
--    RPC pod flagą transakcyjną `app.publishing` — tą samą, którą podnosi
--    publikacja. Kanon „stan publiczny zmienia się wyłącznie jawnym
--    zdarzeniem" nie jest osłabiony; dochodzi mu DRUGIE zdarzenie, nazwane.
--
-- 2. ZERUJEMY WYŁĄCZNIE `published_at`. Bliźniaki (`slug_published`,
--    `content_published`, `position_published`, `enabled_published`,
--    `template_published`, `style_published`) ZOSTAJĄ — to jest wprost decyzja
--    2 z ADR-093 („strona zdjęta ze sklepu zachowuje swoje *_published"):
--    nikt ich nie czyta, bo każdy odczyt publiczny filtruje po
--    `published_at is not null`, a ponowna publikacja nadpisze je ze szkicu.
--
--    Zerowanie `slug_published` — kuszące, bo „strona nie ma już adresu" —
--    byłoby BŁĘDEM i to sprawdzalnym: `sites_record_slug_history` jest
--    wyzwalany zmianą tej kolumny, więc zdjęcie ze sklepu wpisałoby dawny adres
--    do historii przekierowań. Adres zostałby wtedy ZABLOKOWANY dla każdej
--    innej strony najemcy (`app.site_slug_guard`, 0075) mimo że sam oddaje 404,
--    a operator nie miałby jak go odzyskać. Drugi powód jest twardszy: CHECK
--    `sites_published_slug_complete` opisuje stronę OPUBLIKOWANĄ, więc pusty
--    bliźniak adresu nie jest przez niego wymuszony ani zakazany — czyli byłby
--    utratą danych bez żadnej gwarancji w zamian.
--
-- 3. IZOLACJA STOI W CIELE, WIĘC FUNKCJA JEST SECURITY DEFINER. To jest
--    jedyna różnica architektoniczna względem publikacji i jest zamierzona.
--    `app.publish_site` jest SECURITY INVOKER, więc jej bramką własności jest
--    RLS; zawężenie `tenant_id = app.tenant_id()` DOPISANE do ciała funkcji
--    INVOKER byłoby dekoracją — każda jego mutacja zostaje przykryta przez
--    politykę `tenant_update` i suita zostaje zielona, czyli warunku nie da się
--    udowodnić. Tu bramką JEST ciało (wzorzec `app.publish_tenant_appearance`
--    z ADR-161): żywe członkostwo sprawdzane wprost, wiersz zawężony jawnym
--    `tenant_id`, i dokładnie dlatego zdjęcie tego zawężenia jest widoczne
--    jako czerwony test o nazwie mówiącej o izolacji.
--
-- 4. ODMOWA JEST NIEODRÓŻNIALNA. 22023 z tym samym tekstem dla „strona nie
--    istnieje", „strona cudza" i „brak żywego członkostwa" — jak w publikacji.
--    Panel tłumaczy ten kod na jedno zdanie i nie zdradza istnienia cudzej
--    strony.
--
-- CZEGO 0078 NIE RUSZA I DLACZEGO NIE MUSI. `app.get_tenant_pages` (0075) ma
-- warunek `s.published_at is not null` PRZY OBU kluczach koperty — także przy
-- `redirects`, przez złączenie z `sites`. Strona zdjęta ze sklepu znika więc
-- z `pages` i zabiera ze sobą wszystkie 308 na siebie prowadzące, bez jednej
-- linijki tutaj. To była decyzja ADR-159 („308 pod adres oddający 404 jest
-- gorsze niż jego brak") podjęta zanim czasownik zdjęcia w ogóle istniał;
-- ta migracja go dokłada, a test `site-unpublish` przejeżdża tę ścieżkę
-- CZASOWNIKIEM, a nie surowym UPDATE-em udającym stan.

-- === BEGIN PROD MIGRATION 0078 ===

-- ---------------------------------------------------------------------
-- 1. app.unpublish_site — jedyna droga zdjęcia strony ze sklepu
-- ---------------------------------------------------------------------
--
-- `returns void` ŚWIADOMIE. Symetria z `publish_site` podpowiadałaby
-- `returns timestamptz`, ale data zdjęcia nie ma gdzie żyć: `published_at`
-- właśnie zgasło, a nowej kolumny ta operacja nie potrzebuje (świadomy koszt
-- decyzji 1 z ADR-093 — strona zdjęta ze sklepu traci datę publikacji).
-- Zwracanie znacznika czasu, którego nikt nie zapisuje, udawałoby zapis.

create or replace function app.unpublish_site(p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  -- Jedno zdanie dla wszystkich odmów: „nie istnieje", „cudza" i „nie jesteś
  -- już członkiem" mają być nieodróżnialne (wzorzec app.publish_site).
  c_denied constant text := 'site_not_found';
  v_tenant_id uuid;
begin
  v_tenant_id := app.tenant_id();

  if auth.uid() is null or v_tenant_id is null then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- ŻYWE CZŁONKOSTWO — to samo uprawnienie, którego wymaga publikacja
  -- (u niej egzekwuje je predykat polityki `tenant_update`, bo jest INVOKER-em;
  -- tutaj RLS nie uczestniczy, więc warunek musi stać wprost).
  if not (select app.is_current_tenant_member()) then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  -- Flaga transakcyjna jak w publikacji: `published_at` jest na liście
  -- strażnika `app.guard_published_columns` (0045/0073), więc bez niej ten
  -- UPDATE odbiłby się o 42501. `is_local = true` — okno trwa tyle, co jedno
  -- zdanie, a nie do końca transakcji wołającego.
  perform set_config('app.publishing', '1', true);

  -- ZAWĘŻENIE DO NAJEMCY WOŁAJĄCEGO JEST TU JEDYNĄ BRAMKĄ IZOLACJI (D3).
  -- Bez członu `tenant_id = v_tenant_id` członek najemcy B zdjąłby ze sklepu
  -- stronę najemcy A, bo funkcja jest DEFINER-em i polityki jej nie dotyczą.
  update public.sites
     set published_at = null
   where id = p_site_id
     and tenant_id = v_tenant_id;

  -- Strona nie istnieje ALBO należy do innego najemcy — celowo ta sama odmowa.
  if not found then
    raise exception '%', c_denied using errcode = '22023';
  end if;

  perform set_config('app.publishing', '0', true);
end;
$$;

comment on function app.unpublish_site(uuid) is
  'ZDJĘCIE STRONY ZE SKLEPU (0078, ADR-170): zerowanie public.sites.published_at pod flagą transakcyjną app.publishing — druga, po app.publish_site, jawna droga zmiany stanu publicznego strony. Bliźniaki *_published ZOSTAJĄ nietknięte (ADR-093 D2): nikt ich nie czyta przy published_at IS NULL, a ponowna publikacja nadpisze je ze szkicu. Operacja jest idempotentna. SECURITY DEFINER — bramką izolacji jest jawne zawężenie tenant_id = app.tenant_id() plus wymóg żywego członkostwa, a nie RLS (patrz ADR-170 D3). Odmowa (brak strony / cudza strona / brak członkostwa): 22023.';

revoke all on function app.unpublish_site(uuid) from public, anon, authenticated;
grant execute on function app.unpublish_site(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. ODMOWA USUNIĘCIA ŻYWEJ STRONY WSKAZUJE DROGĘ, KTÓRA ISTNIEJE
-- ---------------------------------------------------------------------
--
-- Ciało przepisane z 0048 (jedyna i zarazem ostatnia definicja tej funkcji)
-- ze zmianą WYŁĄCZNIE w treści `c_denied`. Reguła, przepustka serwisowa
-- i SQLSTATE zostają co do znaku — to nie jest osłabienie strażnika, tylko
-- poprawka zdania, które przestało być prawdziwe przy migracji 0074.

create or replace function app.guard_live_site_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  c_denied constant text :=
    'Strony widocznej w sklepie nie można usunąć — najpierw zdejmij ją ze sklepu.';
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
  'Strażnik ŻYWEJ strony (ADR-093): wiersz z published_at nie null kasuje wyłącznie rola serwisowa (kaskada z tenants). Odmowa: 42501 — ten sam SQLSTATE co odmowa RLS i co strażnik bliźniaków. Od 0078 (ADR-170) zdanie odmowy wskazuje app.unpublish_site: rada „najpierw opublikuj inną" była prawdziwa do 0073, a od 0074 publikacja innej strony nie gasi tej.';

-- === END PROD MIGRATION 0078 ===
