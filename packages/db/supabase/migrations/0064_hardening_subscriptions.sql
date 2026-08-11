-- 0064_hardening_subscriptions.sql
-- R17 / ADR-132: domknięcie zapisu planu (public.subscriptions).
--
-- STAN PRZED (zweryfikowany na żywej bazie, nie z pamięci): polityki
-- tenant_insert / tenant_update / tenant_delete (0001, kształt po 0060)
-- dopuszczały OWNERA WŁASNEGO tenanta do zapisu subskrypcji. Surowy
-- `insert into public.subscriptions (tenant_id, plan_id, status)
-- values (własny_tenant, 'max', 'active')` przez PostgREST kończył się
-- sukcesem — plan Max i status „zapłacone" bez superadmina i bez płatności.
-- Dziś plan jest martwą kolumną (nic nie czyta limits/features), ale od
-- wejścia billingu (J2) to darmowe Premium jednym żądaniem. Ścieżka przez
-- RPC app.superadmin_set_plan odbijała się dla nie-superadmina wyłącznie
-- o RLS audit_log NA KOŃCU funkcji, już PO zapisie subskrypcji (wyjątek
-- cofał transakcję) — ochrona PRZYPADKOWA: poluzowanie RLS audytu albo
-- przeniesienie wpisu otwierało ścieżkę.
--
-- STAN PO:
--   1. Zapis subscriptions ma dokładnie DWIE ścieżki: service_role
--      (przyszły webhook billingu; bypassrls + jawne GRANT-y z 0001)
--      oraz superadmin przez istniejące polityki superadmin_insert/
--      superadmin_update (0004, predykat LIVE po 0060). Polityki ownera
--      DROPNIĘTE — także tenant_delete: kasowanie subskrypcji przez
--      ownera to ten sam zapis stanu rozliczeniowego, a jedyne poprawne
--      zniknięcie wiersza to kaskada FK przy usunięciu tenanta (kaskada
--      nie przechodzi przez RLS). SELECT ownera ZOSTAJE (tenant_select
--      bez zmian — panel czyta stan subskrypcji na /organizacja).
--   2. app.superadmin_set_plan dostaje ZAPROJEKTOWANĄ, jawną bramkę
--      wczesną: nie-superadmin odpada PIERWSZĄ instrukcją funkcji
--      (42501, komunikat własny), zanim funkcja czegokolwiek dotknie.
--      Grant dla authenticated zostaje ŚWIADOMIE — panel superadmina
--      działa zwykłym klientem z sesją (zasada „zero service-role
--      w ścieżce panelu", 0004), więc bramką jest predykat LIVE
--      app.is_current_superadmin() (ADR-126), nie uprawnienie EXECUTE.
--   3. Konwencja funkcji billingowych (fakt W3 ze spike'u J2): każda
--      funkcja w schemacie app rodzi się z EXECUTE dla PUBLIC (domyślne
--      ACL Postgresa). Ta migracja zdejmuje PUBLIC ze WSZYSTKICH
--      istniejących funkcji app.* i od teraz każda nowa funkcja MUSI
--      robić `revoke all ... from public` + jawne granty (konwencja
--      w docs/konwencje-migracji.md). Pilnuje tego introspekcyjna
--      bramka packages/db/test/function-acls.test.ts — nowa funkcja
--      z EXECUTE dla PUBLIC/anon poza jawną allowlistą pali build.
--
-- Weryfikacja premis U ŹRÓDŁA przed tą migracją (lekcja z PR #52):
--   * kształt polityk potwierdzony pg_policy na żywej bazie (nie z 0060);
--   * ŻADEN kod aplikacji nie pisze do subscriptions (grep apps/ +
--     packages/core: panel wyłącznie SELECT + RPC superadmin_set_plan;
--     app.create_tenant nie zakłada wiersza subskrypcji);
--   * fabryki testowe piszą service_rolem — nic nie polega na politykach
--     ownera.

-- === BEGIN PROD MIGRATION 0064 ===

-- ---------------------------------------------------------------------
-- 1. subscriptions — owner traci zapis, zostaje mu odczyt
-- ---------------------------------------------------------------------

-- Świadomy DROP zamiast zawężenia: nie istnieje żaden legalny zapis
-- ownera do subscriptions (webhook = service_role, korekta = superadmin),
-- więc „zawężona" polityka ownera byłaby polityką pustą — martwym kodem
-- udającym furtkę. Fail-closed przez brak polityki jest tu docelowym
-- kształtem, nie skutkiem ubocznym.
drop policy tenant_insert on public.subscriptions;
drop policy tenant_update on public.subscriptions;
drop policy tenant_delete on public.subscriptions;

-- DELETE traci też GRANT tabelaryczny: po dropie tenant_delete żadna
-- polityka DELETE dla authenticated nie istnieje (superadmin też jej nie
-- ma — korekta planu to UPDATE, nie kasowanie rejestru), więc uprawnienie
-- wisiałoby bez zastosowania. Odebranie go zamienia cichą odmowę
-- „0 wierszy" na głośną 42501 i zdejmuje powierzchnię na przyszłość.
-- INSERT/UPDATE dla authenticated ZOSTAJĄ: ścieżka superadmińska jest
-- SECURITY INVOKER i idzie rolą authenticated — bramką jest RLS.
revoke delete on public.subscriptions from authenticated;

comment on table public.subscriptions is
  'Subskrypcja planu per tenant (PK = tenant_id). Od 0064 (R17/ADR-132) zapis WYŁĄCZNIE service_role '
  '(przyszły webhook billingu) i superadmin (polityki superadmin_insert/superadmin_update, predykat live). '
  'Owner ma tylko SELECT — samoobsługowa zmiana planu wchodzi dopiero z billingiem (J2) jako projekcja '
  'stanu u dostawcy płatności, nigdy jako bezpośredni zapis klienta.';

-- ---------------------------------------------------------------------
-- 2. app.superadmin_set_plan — bramka zaprojektowana, nie przypadkowa
-- ---------------------------------------------------------------------

-- Różnica wobec 0004: pierwsza instrukcja to jawna bramka superadmina.
-- Dotąd nie-superadmin przechodził przez SELECT tenants (własny tenant
-- jest widoczny w own_select), ZAPISYWAŁ subskrypcję (polityki ownera
-- sprzed 0064) i wywracał się dopiero o RLS audit_log — transakcja
-- cofała zapis, więc wyglądało to na bramkę, którą nie było. Teraz
-- odmowa pada ZANIM funkcja przeczyta lub zapisze cokolwiek, z kodem
-- 42501 i komunikatem, po którym test odróżnia bramkę od odmowy RLS.
-- Predykat LIVE (app.is_current_superadmin, ADR-126), nie claim z JWT:
-- odebrany superadmin z żywym tokenem odpada natychmiast.
-- Pozostałe RPC superadmin_* świadomie BEZ zmian: lock/unlock odmawiają
-- ZAPROJEKTOWANĄ gałęzią `if not found` (P0007/P0008) PRZED jakąkolwiek
-- mutacją widoczną poza transakcją, a superadmin_log nie zmienia stanu.
create or replace function app.superadmin_set_plan(p_tenant_id uuid, p_plan_id text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_previous_plan text;
  v_tenant_exists boolean;
begin
  if not app.is_current_superadmin() then
    raise exception 'Brak uprawnień superadmina.' using errcode = '42501';
  end if;

  -- SELECT też przechodzi przez RLS (own_select: własny tenant lub
  -- superadmin), więc dla nie-superadmina tenant „nie istnieje".
  select true into v_tenant_exists from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'Organizacja nie istnieje lub brak uprawnień.' using errcode = 'P0009';
  end if;

  select s.plan_id into v_previous_plan
  from public.subscriptions s where s.tenant_id = p_tenant_id;

  if v_previous_plan is null then
    -- Brak subskrypcji (świeży tenant): zakładamy wiersz. Status 'active' —
    -- plan nadany ręcznie przez superadmina nie czeka na płatność.
    insert into public.subscriptions (tenant_id, plan_id, status)
    values (p_tenant_id, p_plan_id, 'active');
  else
    update public.subscriptions s
       set plan_id = p_plan_id, updated_at = now()
     where s.tenant_id = p_tenant_id;

    if not found then
      raise exception 'Brak uprawnień do zmiany planu.' using errcode = 'P0010';
    end if;
  end if;

  insert into public.audit_log (tenant_id, actor_user_id, action, subject, details)
  values (
    p_tenant_id, auth.uid(), 'superadmin.tenant.plan', p_tenant_id::text,
    jsonb_build_object('plan_przed', v_previous_plan, 'plan_po', p_plan_id)
  );
end;
$$;

comment on function app.superadmin_set_plan(uuid, text) is
  'Ręczna zmiana planu przez superadmina (panel /admin). Od 0064 (R17/ADR-132) odmowa nie-superadmina '
  'jest ZAPROJEKTOWANA: jawna bramka app.is_current_superadmin() jako pierwsza instrukcja (42501), '
  'nie skutek uboczny RLS audit_log. SECURITY INVOKER — mutacje i tak przechodzą przez polityki RLS; '
  'grant dla authenticated zostaje, bo panel superadmina działa zwykłą sesją (zero service-role).';

-- ---------------------------------------------------------------------
-- 3. Konwencja: żadna funkcja app.* bez EXECUTE dla PUBLIC
-- ---------------------------------------------------------------------

-- Fakt W3 (spike J2, potwierdzony na żywej bazie): CREATE FUNCTION daje
-- PUBLIC EXECUTE domyślnie, więc każda funkcja app.* bez jawnego revoke
-- jest wołalna kluczem anon z przeglądarki. Zdejmujemy PUBLIC ze
-- WSZYSTKICH istniejących funkcji schematu app — jawne granty per rola
-- (anon/authenticated/service_role) zostają nietknięte, bo revoke PUBLIC
-- nie rusza wpisów per-rola. Funkcje wyzwalaczy też wchodzą w pętlę:
-- uprawnienie EXECUTE wyzwalacza jest sprawdzane przy CREATE TRIGGER
-- względem właściciela tabeli, nie przy DML (dowód w repo: trigger
-- app.custom_fields_validate ma ACL postgres-only od 0057 i strzela
-- poprawnie dla authenticated).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
  loop
    execute format('revoke all on function %s from public', r.fn);
  end loop;
end;
$$;

-- Jedyny regrant, którego wymaga zdjęcie PUBLIC: app.delivery_pricing_valid
-- to funkcja CHECK-a na tenant_settings (0013), a funkcję w CHECK-u
-- wykonuje ROLA PISZĄCA wiersz — bez EXECUTE każdy INSERT/UPDATE
-- tenant_settings przez PostgREST padłby na 42501 zamiast dojść do
-- polityki. anon celowo BEZ grantu: nie ma zapisu tenant_settings rolą
-- anon (publiczny checkout idzie funkcjami SECURITY DEFINER, w których
-- EXECUTE liczy się względem definera).
grant execute on function app.delivery_pricing_valid(jsonb) to authenticated, service_role;

-- === END PROD MIGRATION 0064 ===
