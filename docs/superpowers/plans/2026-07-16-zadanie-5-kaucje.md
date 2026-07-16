# Zadanie 5 — Kaucje: rejestr i rozliczenie z panelu — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** rozliczanie kaucji z panelu na rejestrze `deposit_events` z niezmiennikiem
salda egzekwowanym w bazie dla każdej roli i strukturalnym powodem potrącenia.

**Architektura:** migracja `0011` dokłada do `deposit_events` kolumnę `reason_code`
(CHECK: wymagany dla `deducted`, zabroniony dla reszty, `other` wymaga doprecyzowania
w `reason`) oraz trigger BEFORE INSERT `app.deposit_events_gate()` z advisory lockiem
per (tenant, order) i re-checkiem sumy — wzorzec 0010/ADR-024. Panel dostaje sekcję
„Kaucja" na szczególe zamówienia: rejestr chronologiczny z saldami + akcje pobranie /
zwrot pełny / zwrot częściowy / potrącenie (server actions wzorcem `zamowienia/actions.ts`).
Pełne rozliczenie (saldo 0 przy pobraniach > 0) ustawia `payment_status='deposit_refunded'`
z akcji (ADR-027). Przy okazji 0011 spłaca dług: `join_waitlist` zamienia kody
P0012/P0013 na standardowe 22023.

**Stack:** Postgres (Supabase, PostgREST), plpgsql, Next.js server actions,
next-intl, Vitest na żywym lokalnym Supabase.

## Ograniczenia globalne (z briefu i DOKUMENTACJA.md)

- Pas Claude: `packages/db`, `packages/core`, `apps/panel`. NIE dotykać
  `apps/storefront`, `packages/ui`, `packages/emails`, `packages/pdf`.
- Silnik `@avably/core` — bez zmian (kaucje rozliczeniowe go nie wymagają).
- Migracja to `0011` (0010 zajęte). Kody błędów WYŁĄCZNIE standardowe SQLSTATE
  (P0xxx giną w PostgREST jako gołe 500 — nagłówek 0010).
- Interfejsy zastane bez zmian: `kind in ('collected','refunded','deducted')`,
  `amount_grosze int > 0` (kierunek niesie `kind`), FK złożony `(tenant_id, order_id)`,
  append-only (brak grantu UPDATE/DELETE — także dla service_role).
- Gałąź `feat/zadanie-5-kaucje`, PR do main, nigdy push na main. Autor commitów:
  `Avably <admin@avably.io>` (już w git config repo). Zero wzmianek AI, zero nazw
  konkurencji, język polski w kodzie/komentarzach/docs.
- i18n: zero stringów na sztywno w JSX — klucze EN+PL w `apps/panel/messages/{en,pl}.json`.
  Komunikaty błędów w server actions: polskie stałe w kodzie akcji (istniejący
  wzorzec `zamowienia/actions.ts` z Zadania 4).
- Testy muszą umieć zapłonąć: dowód mutacyjny na niezmiennik i na lock; pytanie
  kontrolne o maskowanie (lekcja ADR-024: lock numeracji z 0007 maskuje dowody
  na ścieżce `create_order` — dlatego wyścig kaucji idzie BEZPOŚREDNIM INSERT-em
  do `deposit_events`, który nie dotyka `orders`).
- Weryfikacja bramek z `--force` (cache turbo kłamie). Dokumentacja HTML w tym
  samym PR (ADR-026, ADR-027, karta modułu, model danych, dziennik budowy).

## Decyzje projektowe (uzasadnienie → ADR-026/027)

1. **Kształt strukturalnego powodu:** nowa kolumna `reason_code text` obok
   istniejącego `reason text` (doprecyzowanie). CHECK: `deducted` ⇒ kod z listy
   `damage|late_return|missing_part|cleaning|other`; inne kind ⇒ `reason_code is null`
   (nadmiar ODRZUCANY, nie zerowany — wzorzec 0006); `other` ⇒ niepusty `reason`.
   Wolny tekst `reason` pozostaje dozwolony przy każdym kind (notatka operatora,
   0007 już to dopuszczał). Stary CHECK `deposit_events_deduction_requires_reason`
   znika — kod zastępuje wymóg tekstu. Defensywny backfill `deducted→other`
   (stary CHECK gwarantował niepusty reason, więc para jest legalna).
2. **Niezmiennik salda:** trigger BEFORE INSERT (nie CHECK — niezmiennik jest
   międzywierszowy) z `pg_advisory_xact_lock` na `(tenant, ':deposit:', order)`
   + re-check sumy w tej samej transakcji (wzorzec 0010). Pobranie (`collected`)
   nie bierze locka — może saldo tylko zwiększyć. Odmowa **23514** (ograniczenie
   na wartościach — jak maszyna stanów w ADR-025). Bulk INSERT nie omija bramki:
   reguły widoczności triggerów Postgresa — wiersze wstawione wcześniej TYM SAMYM
   poleceniem są widoczne w BEFORE-triggerze kolejnych wierszy (przypięte testem).
   UPDATE/DELETE nie wymagają bramki: brak grantów (0007) + brak polityk RLS,
   a trigger na DELETE zabiłby kaskadę z orders/tenants.
3. **payment_status (ADR-027):** akcja rozliczenia (zwrot/potrącenie), która
   sprowadza saldo do zera przy pobraniach > 0, ustawia `payment_status='deposit_refunded'`
   („kaucja rozliczona" — niezależnie od proporcji zwrot/potrącenie). To decyzja
   pochodna od rejestru, wykonywana przez operatora akcją panelu — zgodna z decyzją
   wiążącą 4 („rozliczenie zmienia rejestr i status") i 7 (oś płatności ustawia
   operator, obieg offline). Oś payment_status NIE dostaje bramki w bazie —
   formalna maszyna tej osi to dług zapisany do Zadania 9.
4. **Akcja „zarejestruj pobranie":** brief wymienia zwroty i potrącenie, ale rejestr
   startuje pusty — bez zdarzenia `collected` saldo nigdy nie jest dodatnie i żaden
   zwrot nie przejdzie. Faza 1 to obieg offline: operator przyjmuje kaucję i
   rejestruje pobranie z tej samej sekcji. Mieści się w zakresie „rejestr i
   rozliczenie z panelu".
5. **Saldo w JS** (`deposit.ts` w panelu) to wygoda UI — bramką jest trigger.
   Suma trzech rodzajów zdarzeń nie wymaga silnika (brief: silnik bez zmian).
6. **Dług 0006:** `create or replace app.join_waitlist` w 0011, treść bez zmian,
   wyłącznie kody: P0012/P0013 → **22023** (invalid_parameter_value; PostgREST
   mapuje 22xxx→400). Storefront mapuje wszystkie błędy RPC na `server_error`,
   a walidację robi Zod przed RPC — nic nie konsumuje starych kodów (grep czysty).

## Struktura plików

- Create: `packages/db/supabase/migrations/0011_deposit_settlement.sql`
- Create: `packages/db/test/deposit-gates.test.ts` (kształt + niezmiennik + wyścig + waitlist-kody)
- Modify: `packages/db/test/rental-core.test.ts` (sekcja deposit_events → semantyka reason_code)
- Create: `apps/panel/app/[locale]/zamowienia/[id]/deposit.ts` (czyste salda)
- Create: `apps/panel/app/[locale]/zamowienia/[id]/deposit-actions.ts` (3 akcje)
- Create: `apps/panel/app/[locale]/zamowienia/[id]/deposit-forms.tsx` (formularze client)
- Modify: `apps/panel/app/[locale]/zamowienia/[id]/page.tsx` (sekcja Kaucja)
- Modify: `apps/panel/lib/order-validation.ts` (schematy depozytów)
- Modify: `apps/panel/messages/en.json`, `apps/panel/messages/pl.json` (orders.deposit)
- Create: `apps/panel/test/deposit-validation.test.ts` (schematy + salda, unit)
- Create: `apps/panel/test/deposits.test.ts` (integracja: ścieżka akcji na żywym Supabase)
- Modify: `docs/dokumentacja/index.html` (karta modułu, model danych, funkcje SQL, ADR-026/027, dziennik)

---

### Task 1: Gałąź + migracja 0011 sekcja „strukturalny powód"

- [ ] `cd ~/rental-platform && git pull origin main && git checkout -b feat/zadanie-5-kaucje`
- [ ] Upewnij się, że lokalny Supabase działa: `cd packages/db && supabase start`
      (PATH: `export PATH="$HOME/.local/share/supabase:$PATH"`).
- [ ] Napisz PADAJĄCE testy kształtu w nowym `packages/db/test/deposit-gates.test.ts`
      (wzorzec nagłówka i helperów: `order-gates.test.ts` / `rental-core.test.ts`;
      klient admin wystarcza do testów kształtu — CHECK obowiązuje każdą rolę):
      - `deducted` bez `reason_code` → 23514,
      - `deducted` z `reason_code='other'` bez `reason` (oraz z `reason='   '`) → 23514,
      - `deducted` z `reason_code='damage'` bez `reason` → przechodzi,
      - `deducted` z `reason_code='typo'` → 23514,
      - `collected`/`refunded` z `reason_code` → 23514 (nadmiar odrzucany),
      - `collected` z samym `reason` (notatka) → przechodzi.
- [ ] Uruchom: `pnpm --filter @avably/db test -- deposit-gates` → czerwone
      (kolumna `reason_code` nie istnieje).
- [ ] Dopisz do `0011_deposit_settlement.sql` sekcję 1 (nagłówek pliku wzorcem 0010 —
      DLACZEGO w bazie, kody błędów, decyzje ADR-026/027):

```sql
alter table public.deposit_events add column reason_code text;

comment on column public.deposit_events.reason_code is
  'Strukturalny powód potrącenia: damage | late_return | missing_part | cleaning | other. Wymagany dla kind=deducted, zabroniony dla pozostałych; other wymaga doprecyzowania w reason (ADR-026).';

-- Defensywny backfill: stary CHECK gwarantował niepusty reason przy deducted,
-- więc para (other, dotychczasowy reason) jest zawsze legalna.
update public.deposit_events set reason_code = 'other'
  where kind = 'deducted' and reason_code is null;

alter table public.deposit_events
  drop constraint deposit_events_deduction_requires_reason;

alter table public.deposit_events add constraint deposit_events_structured_reason check (
  case when kind = 'deducted'
    then reason_code in ('damage','late_return','missing_part','cleaning','other')
      and (reason_code <> 'other' or (reason is not null and length(btrim(reason)) > 0))
    else reason_code is null
  end
);
```

- [ ] `supabase db reset` (od zera — dowód, że 0001→0011 przechodzi na czysto).
- [ ] Zaktualizuj sekcję deposit_events w `rental-core.test.ts` (test „potrącenie
      wymaga powodu" opisuje teraz reason_code; asercje kodów bez zmian, komentarze
      i wiersze wejściowe zgodne z nową semantyką).
- [ ] `pnpm --filter @avably/db test -- deposit-gates rental-core` → zielone.
- [ ] Commit: `feat(db): 0011 — strukturalny powód potrącenia kaucji (reason_code + CHECK)`

### Task 2: Migracja 0011 sekcja „niezmiennik salda"

- [ ] PADAJĄCE testy niezmiennika w `deposit-gates.test.ts`:
      - collected 100_00 → refund 60_00 OK → deduct 40_00 (damage) OK → refund 1 → 23514,
      - refund bez żadnego pobrania → 23514,
      - deduct ponad saldo → 23514,
      - service_role też bramkowany (wszystkie powyższe idą adminem),
      - bulk INSERT JEDNYM poleceniem dwóch zwrotów 80_00+80_00 przy collected 100_00
        → całość odrzucona 23514 (widoczność wierszy tego samego polecenia w triggerze).
- [ ] `pnpm --filter @avably/db test -- deposit-gates` → czerwone (nadmiarowy zwrot przechodzi).
- [ ] Sekcja 2 w 0011:

```sql
create or replace function app.deposit_events_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_collected bigint;
  v_settled bigint;
begin
  -- Pobranie może saldo wyłącznie zwiększyć — bez locka i re-checku.
  if new.kind = 'collected' then
    return new;
  end if;

  -- Serializacja rozliczeń per (tenant, zamówienie) — wzorzec 0010 (ADR-024).
  perform pg_advisory_xact_lock(
    hashtextextended(new.tenant_id::text || ':deposit:' || new.order_id::text, 0)
  );

  select
    coalesce(sum(amount_grosze) filter (where kind = 'collected'), 0),
    coalesce(sum(amount_grosze) filter (where kind in ('refunded','deducted')), 0)
    into v_collected, v_settled
  from public.deposit_events
  where tenant_id = new.tenant_id and order_id = new.order_id;

  if v_settled + new.amount_grosze > v_collected then
    raise exception
      'Rozliczenie kaucji przekracza pobraną kwotę (pobrano % gr, rozliczono % gr, żądanie % gr).',
      v_collected, v_settled, new.amount_grosze
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger deposit_events_gate
  before insert on public.deposit_events
  for each row execute function app.deposit_events_gate();
```

      Plus `comment on function`, aktualizacja `comment on table public.deposit_events`
      (obietnica „egzekwuje Zadanie 5" z 0007 → wskazanie na trigger i ADR-026)
      oraz komentarz o widoczności wierszy tego samego polecenia (bulk) i o tym,
      dlaczego INSERT wystarcza (append-only: brak grantów UPDATE/DELETE, kaskada
      DELETE musi przeżyć).
- [ ] `supabase db reset` + testy → zielone.
- [ ] Commit: `feat(db): 0011 — niezmiennik salda kaucji w bazie (advisory lock + re-check, 23514)`

### Task 3: Wyścig + dowody mutacyjne

- [ ] Test wyścigu w `deposit-gates.test.ts` (wzorzec sekcji 4 order-gates: dwie
      realne sesje członków przez `create_tenant` + insert do members): collected
      1000_00, `Promise.all` dwóch zwrotów po 800_00 **bezpośrednim INSERT-em** do
      `deposit_events` (nie dotyka `orders` — żaden inny lock nie maskuje dowodu,
      lekcja ADR-024) → dokładnie jeden sukces, przegrany 23514, suma rozliczeń
      w bazie ≤ pobrań.
- [ ] Dowody mutacyjne (lokalnie, na żywej bazie; wynik do raportu, potem przywróć):
      1. usuń `raise exception` z gate'u (`create or replace` w psql) → testy
         niezmiennika czerwone (nadmiarowy zwrot przechodzi),
      2. usuń `pg_advisory_xact_lock` → test wyścigu czerwony (dwa sukcesy;
         powtórz kilka razy — wyścig bez locka może czasem ułożyć się poprawnie),
      3. przywróć 0011 (`supabase db reset`) → wszystko zielone.
      Pytanie kontrolne: co jeszcze mogłoby serializować dwa INSERT-y do
      deposit_events? Nic — ścieżka nie dotyka orders (numeracja 0007) ani
      order_items (lock 0010); jedyny lock w ścieżce to bramka kaucji.
- [ ] Macierz RLS bez regresji: `pnpm --filter @avably/db test` (cała paczka).
- [ ] Commit: `test(db): wyścig dwóch równoległych rozliczeń kaucji przypina advisory lock z 0011`

### Task 4: Dług 0006 — join_waitlist na standardowych kodach

- [ ] Test w `deposit-gates.test.ts` (describe „join_waitlist — spłata długu P0xxx"):
      anon RPC z `p_consent=false` → `error.code === '22023'`; z błędnym e-mailem
      → `22023`. (Przed migracją byłoby to gołe 500 bez kodu — właśnie dlatego dług.)
- [ ] Sekcja 3 w 0011: `create or replace function app.join_waitlist(...)` —
      pełna definicja skopiowana z 0006 (security definer + set search_path bez
      zmian!), zmienione wyłącznie `using errcode` na `'22023'` (9 miejsc) +
      komentarz dlaczego (nagłówek 0010).
- [ ] `supabase db reset` + `pnpm --filter @avably/db test` → zielone.
- [ ] Storefront bez regresji (bez edycji — tylko uruchomienie):
      `pnpm --filter storefront test -- waitlist` → zielone (mapuje wszystko na
      server_error, kodów nie konsumuje).
- [ ] Commit: `fix(db): join_waitlist — standardowe SQLSTATE 22023 zamiast dekoracyjnych P0012/P0013`

### Task 5: Panel — salda i walidacja (unit, TDD)

- [ ] PADAJĄCE testy `apps/panel/test/deposit-validation.test.ts`:
      - `depositTotals`: pusta lista → 0/0/0; collected 100+50, refunded 60,
        deducted 40 → collected 150, settled 100, balance 50; `runningBalances`
        zwraca salda po każdym zdarzeniu,
      - `isDepositSettled`: false dla pustego rejestru, false przy saldzie > 0,
        true przy collected>0 i saldzie 0,
      - schematy: kwota ≤ 0 odrzucona; `deduct` bez `reasonCode` odrzucony;
        `reasonCode='other'` bez `reason` odrzucony; `damage` bez `reason` przechodzi;
        `reasonCode` spoza listy odrzucony.
- [ ] Implementacja `deposit.ts`:

```ts
export interface DepositEventRow {
  id: string;
  kind: "collected" | "refunded" | "deducted";
  amount_grosze: number;
  reason_code: string | null;
  reason: string | null;
  created_at: string;
}

export interface DepositTotals {
  collectedGrosze: number;
  settledGrosze: number;
  balanceGrosze: number;
}

export function depositTotals(events: readonly Pick<DepositEventRow, "kind" | "amount_grosze">[]): DepositTotals;
export function runningBalances(events: readonly Pick<DepositEventRow, "kind" | "amount_grosze">[]): number[];
export function isDepositSettled(totals: DepositTotals): boolean;
```

      (Wygoda UI — bramką jest trigger 0011; komentarz w pliku.)
- [ ] `order-validation.ts` — dopisz:

```ts
export const DEDUCTION_REASON_CODES = ["damage", "late_return", "missing_part", "cleaning", "other"] as const;
export const depositAmountSchema = /* int > 0 (grosze po parseMajorToGrosze) */;
export const depositCollectSchema = z.object({ orderId: uuidSchema, amountGrosze: depositAmountSchema });
export const depositRefundSchema = depositCollectSchema;
export const depositDeductSchema = z.object({
  orderId: uuidSchema,
  amountGrosze: depositAmountSchema,
  reasonCode: z.enum(DEDUCTION_REASON_CODES),
  reason: z.string().trim().max(500).optional(),
}).superRefine(/* other ⇒ niepusty reason */);
```

- [ ] `pnpm --filter panel test -- deposit-validation` → zielone.
- [ ] Commit: `feat(panel): salda kaucji i walidacja rozliczeń (wygoda UI — bramką trigger 0011)`

### Task 6: Panel — akcje i sekcja Kaucja

- [ ] `deposit-actions.ts` ("use server", wzorzec actions.ts: Zod → requireMember →
      mutacja klientem sesji → mapowanie kodów; stałe `PG_*` na górze):
      - `collectDepositAction`, `refundDepositAction`, `deductDepositAction`;
        kwota z pola `amount` przez `parseMajorToGrosze` (zwrot pełny: hidden
        `amount` pre-wypełniony `groszeToInputValue(balance)` — optymistyczna
        współbieżność jak `expectedFrom`: operator zwraca kwotę, którą WIDZI,
        a nadmiar autorytatywnie odrzuca trigger),
      - insert `{tenant_id, order_id, kind, amount_grosze, reason_code?, reason?, created_by}`
        + `.select("id")` po mutacji (RLS nie zgłasza odmowy),
      - mapowanie: `23514` → „Rozliczenie przekracza dostępne saldo kaucji —
        odśwież stronę."; `23503` → „Zamówienie nie istnieje.",
      - po udanym zwrocie/potrąceniu: re-odczyt zdarzeń, `isDepositSettled` →
        `update orders set payment_status='deposit_refunded'` (ADR-027),
      - `revalidatePath("/", "layout")`.
- [ ] `deposit-forms.tsx` (client, wzorzec status-buttons.tsx: `useActionState`
      per akcja): formularz pobrania (podpowiedź kwoty: `total_deposit_grosze`
      minus pobrane, floor 0), zwrot pełny (przycisk z hidden amount, wyłączony
      przy saldzie 0), zwrot częściowy (pole kwoty), potrącenie (kwota + select
      `reasonCode` + pole `reason`); komunikaty błędów per formularz.
- [ ] `page.tsx`: dodatkowy select `deposit_events (id, kind, amount_grosze,
      reason_code, reason, created_at)` posortowany po `created_at`; sekcja
      „Kaucja": tabela chronologii (data, zdarzenie, kwota ze znakiem, powód
      [etykieta kodu + doprecyzowanie], saldo po zdarzeniu z `runningBalances`),
      wiersz sum (pobrano · rozliczono · saldo), badge „rozliczona", formularze.
- [ ] Klucze `orders.deposit.*` w `messages/en.json` i `messages/pl.json`
      (tytuł, kolumny, kinds, reasonCodes, CTA, etykiety pól, empty, badge).
- [ ] `pnpm --filter panel typecheck && pnpm --filter panel lint` → zielone.
- [ ] Commit: `feat(panel): sekcja kaucji zamówienia — rejestr zdarzeń, zwroty i potrącenia`

### Task 7: Panel — testy integracyjne

- [ ] `apps/panel/test/deposits.test.ts` (wzorzec orders.test.ts: realne sesje,
      ścieżka panelu bez service-role):
      - członek rejestruje pobranie → zwrot częściowy → potrącenie z kodem;
        wiersze w bazie zgodne (kwoty, reason_code, created_by),
      - nadmiarowy zwrot z sesji członka → 23514 (kod, na który mapuje akcja),
      - pełne rozliczenie sekwencją akcji ustawia `payment_status='deposit_refunded'`;
        częściowe NIE zmienia payment_status; rozliczenie samym potrąceniem też ustawia,
      - izolacja: członek tenanta B nie wstawi zdarzenia do zamówienia A
        (WITH CHECK/klucz złożony), nie widzi rejestru A (SELECT pusty).
- [ ] `protected-routes.test.ts`: bez nowych tras (sekcja żyje na `/zamowienia/[id]`)
      — przebiegnij test, potwierdź brak regresji.
- [ ] `pnpm --filter panel test` → zielone.
- [ ] Commit: `test(panel): rozliczenia kaucji — ścieżka akcji, payment_status, izolacja tenantów`

### Task 8: Weryfikacja uruchomieniowa + bramki

- [ ] `supabase db reset` od zera; odtwórz demo usera (`demo-katalog@test.local`,
      tenant „Wypożyczalnia Demo") — wzorzec z pamięci panel-local-dev-setup.
- [ ] `preview_start` `avably-panel`; w przeglądarce (OBA locale): utwórz zamówienie
      z kaucją → zarejestruj pobranie → zwrot częściowy → potrącenie (other bez
      doprecyzowania = błąd walidacji; z doprecyzowaniem OK) → zwrot reszty →
      badge „rozliczona" + payment_status `deposit_refunded`; próba nadmiarowego
      zwrotu → czytelny komunikat. Konsola bez błędów (hydratacja!).
- [ ] Bramki z `--force`: `pnpm turbo typecheck lint test build --force` → zielone.
- [ ] Ewentualny commit poprawek z weryfikacji.

### Task 9: Dokumentacja HTML

- [ ] `docs/dokumentacja/index.html`:
      - lista funkcji SQL (ok. l. 130): `app.deposit_events_gate` (0011) + nota
        o join_waitlist (22023),
      - karta modułu zamówień w panelu: sekcja kaucji (rejestr, akcje, mapowanie
        kodów, payment_status),
      - model danych: `deposit_events.reason_code` + trigger + niezmiennik,
      - **ADR-026**: niezmiennik salda w bazie + strukturalny powód (kontekst,
        odrzucone warianty: CHECK niewystarczający bo międzywierszowy, kolumna
        salda na orders = denormalizacja rejestru; koszt: lustro sumy w JS),
      - **ADR-027**: rozliczenie kaucji a payment_status (auto `deposit_refunded`
        przy saldzie 0, semantyka „rozliczona" niezależnie od proporcji, oś bez
        bramki — dług do Zadania 9),
      - dziennik budowy: wpis na górze (data, Zadanie 5, PR, co odblokowuje).
- [ ] Commit: `docs: rozliczanie kaucji — ADR-026/027, karta modułu, model danych, dziennik Zadania 5`

### Task 10: PR + CI

- [ ] `git fetch origin && git rebase origin/main`
- [ ] `git push -u origin feat/zadanie-5-kaucje`
- [ ] `gh pr create` — opis: co (0011 + sekcja kaucji), dlaczego (bramka w bazie,
      decyzja wiążąca 4), jak zweryfikowane (dowody mutacyjne, wyścig, przeglądarka).
      Bez stopek AI.
- [ ] Poczekaj na OBA joby CI (`ci` + `rls`) → zielone; raport końcowy wg kontraktu.
