-- 0067_saas_billing_core.sql
-- ADR-136 / J2 faza 2a: rdzeń Stripe Billing — projekcja subskrypcji SaaS,
-- tablica przejść tenants.status i fundament okna domykania (suspended_at).
--
-- KONTEKST. Rdzeń billingu = wariant stripe-native (decyzja PM po spike'u
-- J2, 2026-08-10): Stripe trzyma prawdę handlową o subskrypcji, lokalne
-- public.subscriptions jest PROJEKCJĄ odczytu u dostawcy, a tenants.status
-- — jej egzekucją. Zdarzenie webhooka to budzik: po nim handler czyta
-- subskrypcję GET-em (ADR-049/067) i woła app.apply_saas_subscription_state
-- z ODCZYTU, nigdy z payloadu. Faza 1 (0066) dała lokalny zegar triala;
-- od tej migracji tenant z subskrypcją ma prawdę u dostawcy.
--
-- TABLICA PRZEJŚĆ (zasady okna dunningowego 1-8, decyzja właściciela
-- 2026-08-10; brief J2 fazy 2a):
--   subskrypcja trialing|active → tenants active   (+ suspended_at = NULL)
--   subskrypcja past_due        → tenants past_due (sklep DZIAŁA — ADR-134)
--   subskrypcja unpaid          → tenants suspended (+ suspended_at przy
--                                 PIERWSZYM wejściu — fundament okna 2b)
--   canceled|incomplete|incomplete_expired|paused → projekcja TAK,
--                                 tenants.status BEZ ZMIANY (egzekucji,
--                                 której nikt nie zdecydował, nie ma)
-- PĘTLE WŁASNE SĄ NORMĄ (zasada 6): comiesięczne invoice.paid przy active
-- i powtórki dunningowe przy past_due przechodzą bez wyjątku.
-- superadmin_locked i cancelled są NIENARUSZALNE przez przejścia billingowe:
-- zapłata faktury nie zdejmuje blokady platformowej (zasada 6, druga pułapka).
--
-- Weryfikacja premis U ŹRÓDŁA przed migracją (lekcja PR #52):
--   * public.subscriptions: ZERO wierszy na prod i na lokalnej bazie
--     współdzielonej (sprawdzone 2026-08-11); kolumny stripe_customer_id/
--     stripe_subscription_id istnieją od 0001 BEZ unikatów; status BEZ
--     CHECK-a (W9 ze spike'u — stan zastany, domykany TUTAJ);
--   * plans: wyłącznie placeholder start/pro/max (0004); jedyni czytelnicy
--     to superadmin (listPlans — filtruje active) i ekran /organizacja
--     (JOIN subscriptions→plan_id; przy braku wiersza czyta TYLKO brak
--     wiersza — trial jako stan pierwszej klasy, ADR-135);
--   * webhook_events.provider: CHECK in ('stripe') — 0030 przewidział
--     drugiego dostawcę („to zwykła migracja"), robimy ją teraz;
--   * polityki subscriptions po 0064: owner ma WYŁĄCZNIE SELECT; zapis
--     service_role (webhook) i superadmin — NIETKNIĘTE tą migracją.

-- === BEGIN PROD MIGRATION 0067 ===

-- ---------------------------------------------------------------------
-- 1. webhook_events — drugi dostawca zdarzeń: 'stripe-billing'
-- ---------------------------------------------------------------------

-- Osobna trasa webhooka billingu (osobny sekret, konto PLATFORMY) dostaje
-- osobny provider — strumień zdarzeń Connect (pieniądze klientów najemców)
-- i strumień billingu SaaS (pieniądze najemców do nas) nie mogą dzielić
-- przestrzeni idempotencji ani statystyk. Unikat (provider, event_id)
-- z 0030 obsługuje to bez zmian.
alter table public.webhook_events
  drop constraint if exists webhook_events_provider_check;
alter table public.webhook_events
  add constraint webhook_events_provider_check
  check (provider in ('stripe', 'stripe-billing'));

-- ---------------------------------------------------------------------
-- 2. tenants.suspended_at — fundament okna domykania (zasada 8, faza 2b)
-- ---------------------------------------------------------------------

alter table public.tenants
  add column suspended_at timestamptz;

comment on column public.tenants.suspended_at is
  'Chwila wejścia w status suspended (ADR-136, J2 faza 2a). Ustawiane WYŁĄCZNIE przez '
  'app.apply_saas_subscription_state przy PIERWSZYM przejściu w suspended; czyszczone przy '
  'powrocie do active (zapłata — zasada 5 okna dunningowego). superadmin_lock/unlock tej '
  'kolumny NIE dotyka. Fundament okna domykania fazy 2b (zasada 8): 30-dniowy zegar okna '
  'liczy się od tej daty — w fazie 2a NIC tej kolumny nie czyta w decyzjach dostępu.';

-- ---------------------------------------------------------------------
-- 3. subscriptions — projekcja stripe-native: kolumny, CHECK, unikaty
-- ---------------------------------------------------------------------

alter table public.subscriptions
  add column current_period_start timestamptz,
  add column cancel_at_period_end boolean not null default false;

-- Normalizacja PRZED CHECK-iem. Na prod tabela jest pusta (zweryfikowane),
-- więc ten UPDATE to no-op; na bazach lokalnych/testowych mogły zostać
-- wiersze spoza słownika — CHECK nie może wywrócić migracji o śmieć testowy.
update public.subscriptions
   set status = 'active'
 where status not in
   ('trialing','active','past_due','unpaid','canceled','incomplete','incomplete_expired','paused');

-- CHECK z KOMPLETEM wartości dostawcy, W TYM 'paused' (W9 ze spike'u: lista
-- bez 'paused' zamienia webhook w 23514, wiersz zdarzenia w failed i mrozi
-- tenanta w poprzednim stanie — bez ponowienia, bo odpowiedź była 2xx).
-- 'active' pisze też app.superadmin_set_plan (comp ręczny) — jest w zbiorze.
-- Słownik STRIPE'A, nie nasz: projekcja przechowuje surowy status subskrypcji
-- u dostawcy; tłumaczeniem na status tenanta zajmuje się WYŁĄCZNIE funkcja
-- app.apply_saas_subscription_state (lustro TS: billing-state.ts).
alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;
alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in
    ('trialing','active','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'));

-- Unikaty częściowe na identyfikatorach dostawcy: jeden Customer i jedna
-- subskrypcja nie mogą mapować się na dwóch tenantów — to zamyka wektor
-- „cudze sub_… w mojej projekcji reanimuje moje konto z cudzej płatności"
-- (K2 z krytyki spike'u). Częściowe, bo NULL (projekcja sprzed checkoutu
-- albo comp superadmina bez Stripe'a) jest legalny i nie koliduje.
create unique index if not exists subscriptions_stripe_customer_id_key
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;
create unique index if not exists subscriptions_stripe_subscription_id_key
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on column public.subscriptions.status is
  'SUROWY status subskrypcji u dostawcy (CHECK: pełny słownik Stripe + paused, W9/ADR-136). '
  'Projekcja odczytu — pisze wyłącznie app.apply_saas_subscription_state (service_role, webhook '
  'billingu) i app.superadmin_set_plan (comp ręczny, status active). Tłumaczenie na tenants.status '
  'żyje w apply_saas_subscription_state, nigdzie indziej.';
comment on column public.subscriptions.current_period_start is
  'Początek bieżącego okresu rozliczeniowego — z ODCZYTU subskrypcji u dostawcy (ADR-136).';
comment on column public.subscriptions.current_period_end is
  'Koniec bieżącego okresu rozliczeniowego (0001; wypełniane od 0067 z odczytu u dostawcy).';
comment on column public.subscriptions.cancel_at_period_end is
  'Flaga „anuluj z końcem okresu" z odczytu u dostawcy (ADR-136) — projekcja, nie decyzja.';

-- ---------------------------------------------------------------------
-- 4. plans — reseed: placeholder start/pro/max ustępuje standard/premium
-- ---------------------------------------------------------------------

-- Zapowiedziane w 0004 („zmieni je osobna migracja") — to jest ta migracja.
-- Placeholdery zostają w tabeli (FK z ewentualnych subskrypcji), gasną
-- flagą active: superadmin (listPlans filtruje active) widzi od teraz
-- wyłącznie realny cennik. Kwoty = lustro SAAS_PLAN_PRICING
-- (packages/core/src/billing/pricing.ts, ADR-135): 199/399 netto/mies.
-- price_grosze jest PREZENTACYJNE (ekran superadmina) — prawdą handlową
-- ceny jest stała @avably/core i cennik na koncie Stripe (lookup_key
-- saas_<plan>_<interwał>, bootstrap w scripts/stripe-billing-bootstrap.mjs).
-- limits/features celowo PUSTE: plany nie różnią się mocą (decyzja J1),
-- feature-gating planów to faza 3.
update public.plans
   set active = false
 where id in ('start', 'pro', 'max');

insert into public.plans (id, name, price_grosze, currency, limits, features, active)
values
  ('standard', 'Standard', 19900, 'PLN', '{}'::jsonb, '{}'::jsonb, true),
  ('premium',  'Premium',  39900, 'PLN', '{}'::jsonb, '{}'::jsonb, true)
on conflict (id) do update
   set name = excluded.name,
       price_grosze = excluded.price_grosze,
       currency = excluded.currency,
       active = true;

comment on table public.plans is
  'Katalog planów SaaS. Od 0067 (ADR-136) realne plany to standard/premium (parytet kwot ze stałą '
  'SAAS_PLAN_PRICING w @avably/core — tam żyje decyzja właściciela); start/pro/max to zgaszone '
  'placeholdery z 0004 (zostają dla FK). price_grosze jest prezentacyjne — prawda handlowa ceny '
  'to stała @avably/core i cennik Stripe (lookup_key saas_<plan>_<interwał>).';

-- ---------------------------------------------------------------------
-- 5. app.apply_saas_subscription_state — JEDYNY pisarz projekcji i przejść
-- ---------------------------------------------------------------------

-- SECURITY INVOKER wołany WYŁĄCZNIE rolą service_role (webhook billingu
-- i rekoncyliacja) — EXECUTE tylko dla service_role, patrz ACL niżej.
-- Wszystkie argumenty pochodzą z ODCZYTU subskrypcji u dostawcy (handler
-- nie przekazuje niczego z payloadu zdarzenia — ADR-049/067).
--
-- Mapowanie celowo formą CASE ... WHEN (nie `in ('active','trialing')`):
-- bramka ADR-134 (commercial-active-predicate.test.ts) wykrywa literał pary
-- statusów jako obejście predykatu komercyjnego — a to mapowanie nim nie
-- jest (ustawia status, nie bramkuje ruchu publicznego).
create or replace function app.apply_saas_subscription_state(
  p_tenant_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_subscription_status text,
  p_plan_id text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, app
as $$
declare
  v_tenant_status text;
  v_existing_sub_id text;
  v_existing_sub_status text;
  v_target text;
  v_suspended_at timestamptz;
  v_tenant_touched boolean := false;
begin
  -- Blokada wiersza tenanta serializuje równoległe dostawy zdarzeń tego
  -- samego tenanta: dwie transakcje nie przeplotą odczytu statusu z zapisem.
  select t.status, t.suspended_at
    into v_tenant_status, v_suspended_at
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'Organizacja % nie istnieje — projekcja subskrypcji odrzucona.', p_tenant_id
      using errcode = 'P0011';
  end if;

  -- BRAMKA PODMIANY SUBSKRYPCJI. Projekcja zna inną, wciąż ŻYWĄ subskrypcję
  -- → odmowa (anomalia: dwie żywe subskrypcje na tenancie — checkout tego
  -- broni bramką W6, więc rozjazd tutaj to skrzyżowane strumienie, nie
  -- normalny przebieg). Podmiana po subskrypcji ZAMKNIĘTEJ (canceled/
  -- incomplete_expired) jest legalna — to reaktywacja nowym checkoutem.
  select s.stripe_subscription_id, s.status
    into v_existing_sub_id, v_existing_sub_status
  from public.subscriptions s
  where s.tenant_id = p_tenant_id;

  if v_existing_sub_id is not null
     and v_existing_sub_id <> p_stripe_subscription_id
     and v_existing_sub_status in ('trialing','active','past_due','unpaid','paused')
  then
    raise exception
      'Tenant % ma żywą subskrypcję % (status %) — odmowa projekcji % (druga żywa subskrypcja).',
      p_tenant_id, v_existing_sub_id, v_existing_sub_status, p_stripe_subscription_id
      using errcode = 'P0012';
  end if;

  -- Projekcja (upsert po PK tenant_id). updated_at ZAWSZE — pętla własna
  -- też jest przebiegiem, a rekoncyliacja selektuje po świeżości projekcji.
  insert into public.subscriptions
    (tenant_id, plan_id, stripe_customer_id, stripe_subscription_id, status,
     current_period_start, current_period_end, cancel_at_period_end, updated_at)
  values
    (p_tenant_id, p_plan_id, p_stripe_customer_id, p_stripe_subscription_id,
     p_subscription_status, p_current_period_start, p_current_period_end,
     p_cancel_at_period_end, now())
  on conflict (tenant_id) do update
     set plan_id = excluded.plan_id,
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         status = excluded.status,
         current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         updated_at = now();

  -- Tłumaczenie statusu subskrypcji na cel tenants.status (lustro TS:
  -- mapSaasSubscriptionToTenantStatus). NULL = projekcja tak, tenant nie.
  v_target := case p_subscription_status
    when 'trialing' then 'active'
    when 'active'   then 'active'
    when 'past_due' then 'past_due'
    when 'unpaid'   then 'suspended'
    else null
  end;

  -- NIENARUSZALNOŚĆ superadmin_locked i cancelled (zasada 6): projekcja
  -- została zapisana wyżej, ale egzekucja billingowa nie dotyka blokady
  -- platformowej ani zamkniętej organizacji. Zapłata nie zdejmuje locka.
  if v_tenant_status in ('superadmin_locked', 'cancelled') then
    v_target := null;
  end if;

  if v_target is not null then
    update public.tenants t
       set status = v_target,
           -- suspended_at: ustawiane przy PIERWSZYM wejściu w suspended
           -- (coalesce — pętla własna unpaid→unpaid NIE przesuwa zegara
           -- okna 2b), czyszczone przy powrocie do active (zapłata,
           -- zasada 5), nietykane przy past_due.
           suspended_at = case v_target
             when 'suspended' then coalesce(t.suspended_at, now())
             when 'active'    then null
             else t.suspended_at
           end
     where t.id = p_tenant_id;

    v_tenant_touched := v_target is distinct from v_tenant_status;

    -- Ślad audytowy WYŁĄCZNIE przy realnym przejściu — pętla własna nie
    -- jest zdarzeniem audytowym (byłby to comiesięczny szum invoice.paid).
    if v_tenant_touched then
      insert into public.audit_log (tenant_id, actor_user_id, action, subject, details)
      values (
        p_tenant_id, null, 'billing.tenant.status', p_tenant_id::text,
        jsonb_build_object(
          'status_przed', v_tenant_status,
          'status_po', v_target,
          'subskrypcja', p_stripe_subscription_id,
          'status_subskrypcji', p_subscription_status
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'tenant_status_before', v_tenant_status,
    'tenant_status_after', coalesce(v_target, v_tenant_status),
    'tenant_changed', v_tenant_touched,
    'subscription_status', p_subscription_status
  );
end;
$$;

comment on function app.apply_saas_subscription_state(uuid, text, text, text, text, timestamptz, timestamptz, boolean) is
  'JEDYNY pisarz projekcji subscriptions i przejść billingowych tenants.status (ADR-136, J2 faza 2a). '
  'Wołany wyłącznie service_rolem (webhook stripe-billing + rekoncyliacja) z argumentami Z ODCZYTU '
  'subskrypcji u dostawcy (ADR-049/067 — nigdy z payloadu). Tablica przejść: trialing|active→active '
  '(suspended_at=NULL), past_due→past_due, unpaid→suspended (suspended_at przy pierwszym wejściu), '
  'inne statusy→projekcja bez zmiany tenanta. superadmin_locked i cancelled NIENARUSZALNE. '
  'Pętle własne przechodzą bez wyjątku (zasada 6). Odmowy: P0011 brak tenanta, P0012 druga żywa subskrypcja.';

-- ACL wg konwencji ADR-132 (docs/konwencje-migracji.md): funkcja rodzi się
-- z EXECUTE dla PUBLIC — zdejmujemy i nadajemy WYŁĄCZNIE service_role.
-- anon/authenticated celowo BEZ grantu: stan rozliczeniowy pisze webhook,
-- nie przeglądarka (bramka function-acls.test.ts pilnuje tego introspekcją).
revoke all on function app.apply_saas_subscription_state(uuid, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function app.apply_saas_subscription_state(uuid, text, text, text, text, timestamptz, timestamptz, boolean) to service_role;

-- === END PROD MIGRATION 0067 ===
