# Zadanie 9 — przegląd adwersaryjny fazy 1 + bramka payment_status + domknięcie docs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development lub superpowers:executing-plans, zadanie po zadaniu. Kroki mają checkboxy (`- [ ]`).

**Goal:** Domknąć fazę 1: (1) bramka maszyny stanów `payment_status` u źródła (migracja 0015, ADR-035), (2) rzetelny przegląd adwersaryjny wszystkich mechanizmów fazy per mechanizm, (3) konsolidacja dokumentacji do stanu końcowego fazy + jedna lista długów fazy 2. Werdykt MERGE/NIE dla fazy.

**Architecture:** Bramka `payment_status` = dwie ortogonalne reguły w istniejącym triggerze `app.orders_write_gate()` (BEFORE INSERT/UPDATE na `orders`): (A) mapa przejść `app.payment_transition_allowed(from,to)` — lustro nowej stałej `PAYMENT_TRANSITIONS`/`canPaymentTransition` z `@avably/core`, chroni granicę rozliczenia/terminala; (B) bramka spójności z rejestrem — wejście w `deposit_refunded` wymaga `collected>0 ∧ saldo=0` czytane punktowo z `deposit_events`. Świadomie BEZ advisory locka (uzasadnienie w ADR-035). Przegląd adwersaryjny: ataki na żywej lokalnej bazie per mechanizm, wynik ZATRZYMANE/LUKA. Docs: aktualizacja `index.html` (karty modułów do stanu końcowego, ADR-035, dziennik) + `hub.html`.

**Tech Stack:** PostgreSQL 17 (Supabase local), PL/pgSQL, TypeScript strict, Vitest, `postgres.js` (bezpośrednie sesje SQL), `@supabase/supabase-js` (sesje ról).

## Global Constraints

- Gałąź: `feat/zadanie-9-przeglad-fazy` (już utworzona z `origin/main`, worktree `.claude/worktrees/przeglad-fazy`). PR do `main`, **nigdy push na main**.
- Autor commitów: `Avably <admin@avably.io>`. ZERO `Co-Authored-By`, ZERO wzmianek o AI/Claude, ZERO nazw konkurencji. Język: polski.
- Migracje tworzy WYŁĄCZNIE Claude. Numer: **0015** (0012 świadomie wolne). ADR: **035+** (034 zajęty).
- Wyłącznie standardowe SQLSTATE mapowane przez PostgREST: `23514` (check_violation), `23P01`, `23001`, `22023`. Kody `P0xxx` PostgREST zjada do gołego 500.
- Bramka obowiązuje KAŻDĄ rolę, także `service_role`.
- Ataki na ŻYWEJ lokalnej bazie. **NIE `supabase db reset` bez potrzeby** (wspólny stack). Sprawdź `schema_migrations` (0001–0011,0013,0014) zanim czemukolwiek zaufasz.
- Dokumentacja to warunek zamknięcia (DOKUMENTACJA.md §1): sekcja modułu + dziennik + model danych + dziennik decyzji w TYM SAMYM PR.
- Oba joby CI (`ci`, `rls`) zielone przed merge.

## Środowisko (uruchom raz na sesję powłoki)

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.local/share/supabase:$PATH"
cd ~/rental-platform/.claude/worktrees/przeglad-fazy
# fresh worktree — instalacja zależności (node_modules nie ma):
pnpm install
# env testów integracyjnych z żywego stacka:
cd packages/db
eval "$(supabase status -o env | sed -n 's/^\([A-Z_]*\)="\(.*\)"/export SB_\1="\2"/p')"
export SUPABASE_LOCAL_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
export SUPABASE_LOCAL_API_URL="$SB_API_URL"
export SUPABASE_LOCAL_ANON_KEY="$SB_ANON_KEY"
export SUPABASE_LOCAL_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY"
```

Weryfikacja stanu bazy PRZED czymkolwiek (musi zwrócić `0001,...,0011,0013,0014`):

```bash
cd ~/rental-platform/packages/db && node -e '
const p=require("postgres");const s=p(process.env.SUPABASE_LOCAL_URL||"postgresql://postgres:postgres@127.0.0.1:54322/postgres",{max:1});
s`select version from supabase_migrations.schema_migrations order by version`.then(r=>{console.log(r.map(x=>x.version).join(","));return s.end();});
'
```

> Uwaga o wspólnej bazie: cudzy `db reset` mógł zdjąć migracje. Jeśli `0014` nieobecne — odtwórz stack (`supabase migration up` z `packages/db`) zanim ruszysz, i odtwórz userów demo wzorcem `test/helpers/seed-tenants.ts`. Znana interferencja: równoległe przebiegi na wspólnej bazie potrafią dać jednorazową czerwień testów integracyjnych — **powtórz przebieg** zanim uznasz regresję.

---

## Część 1 — bramka maszyny stanów `payment_status` (ADR-035, migracja 0015)

### Kontekst decyzji (przeczytaj przed kodem)

Dziś oś `payment_status` jest w całości MIĘKKA (ADR-027): jedyny writer to akcja kaucji, która przy saldzie 0 i pobraniach > 0 ustawia `deposit_refunded` zwykłym UPDATE-em (`apps/panel/app/[locale]/zamowienia/[id]/deposit-actions.ts`). Dowolny UPDATE (też `service_role`, też przyszły refaktor) może:
- cofnąć `deposit_refunded → paid` (utrata faktu rozliczenia),
- ustawić `deposit_refunded` bez pokrycia w rejestrze (stan sprzeczny z `deposit_events`).

Wartości (0007): `unpaid, pending, paid, manual, completed, deposit_refunded, refunded, cancelled`. `BLOCKING_PAYMENT_STATUSES = pending, paid, manual, completed, deposit_refunded` (blokują anulowanie zamówienia — ADR-025, egzekwuje 23001 w `orders_write_gate`, BEZ zmian).

**Zakres mapy przejść (rozstrzygnięcie do ADR-035):** oś jest w fazie 1 sterowana RĘCZNIE przez operatora (decyzja nr 7), a realne płatności Stripe to faza 3. Więc NIE projektujemy drobnoziarnistej maszyny Stripe (ADR-027 ostrzega przed tym). Bramka chroni dwie rzeczy, które faza 1 realnie potrafi zagwarantować:

Zbiór OTWARTY `O = {unpaid, pending, paid, manual, completed}` (płatność w toku / offline). Zbiór ROZLICZENIOWY `{deposit_refunded, refunded, cancelled}`.

- **INSERT:** zamówienie rodzi się w stanie z `O` (stany rozliczeniowe nieosiągalne przy narodzinach — nie ma czego rozliczać). `create_order`/default = `unpaid`, więc ścieżka panelu przechodzi. Odmowa 23514. (Lustro filozofii „INSERT tylko pending" z ADR-025.)
- **Mapa przejść** `app.payment_transition_allowed`:
  - z `o ∈ O` → dowolny `O ∪ {deposit_refunded, refunded, cancelled}` (operator koryguje w obrębie otwartych + wejście w rozliczenie),
  - z `deposit_refunded` → `{refunded, cancelled}` (dalszy zwrot środków / unieważnienie; **NIE** wraca do `O` — to zabija regres `deposit_refunded → paid`),
  - `refunded` i `cancelled` — TERMINALNE (zero wyjść; rozliczona płatność się nie „od-rozlicza"),
  - przejście tożsamościowe (`from == to`) NIE jest przejściem (no-op, nie pytamy mapy) — lustro `canTransition`.
- **Bramka spójności z rejestrem** (wejście w `deposit_refunded`): wymaga `collected > 0 ∧ saldo = 0` (lustro `isDepositSettled`/ADR-027), czytane PUNKTOWO z `deposit_events` w tej transakcji. Odmowa 23514.

**Dlaczego BEZ advisory locka (kluczowe, do ADR-035):** jedyne, co może podnieść saldo z 0, to zdarzenie `collected` — a `deposit_events_gate` (0011) świadomie NIE bierze locka dla `collected` („saldo tylko rośnie"). Zatem lock w tej bramce nie zserializowałby jedynego realnego interferenta. Zwroty/potrącenia po osiągnięciu salda 0 są i tak odrzucane przez 0011 (przekroczyłyby pobrania). Nietrwałość `deposit_refunded` po PÓŹNIEJSZYM pobraniu to jawnie zarejestrowane, POZA-zakresowe zachowanie ADR-027 (nie „saldo w chwili ustawienia"). Bramka jest więc PUNKTOWA (re-odczyt w triggerze), a advisory lock byłby cargo-cultem wzorca 0011 bez wyścigu, który zamyka. To jest wniosek z obowiązkowej lektury ADR-024 (lock, który nic nie serializuje, maskuje zamiast chronić).

**Ostrzeżenie o maskowaniu (ADR-024) — do dowodów mutacyjnych:** ścieżka flipu to `UPDATE orders SET payment_status` — NIE dotyka locka numeracji z 0007 (ten jest BEFORE INSERT) ani bramki egzemplarza. Więc test odmowy nie jest maskowany przez inne locki. Dla każdej mutacji zadaj pytanie kontrolne: „co jeszcze mogłoby zatrzymać ten UPDATE?" — odpowiedź musi brzmieć „nic" (CHECK dopuszcza wartość, RLS na payment nie patrzy, order_status nietknięty).

### File Structure — Część 1

- Modify: `packages/core/src/rental/order-status.ts` — dodać `PAYMENT_TRANSITIONS`, `canPaymentTransition`.
- Modify: `packages/core/src/rental/index.ts` — re-eksport (jeśli barrel wylicza symbole jawnie).
- Create: `packages/db/supabase/migrations/0015_payment_status_gate.sql` — `app.payment_transition_allowed` + `create or replace app.orders_write_gate()` z regułami A/B.
- Create: `packages/core/src/rental/payment-status.test.ts` — testy jednostkowe mapy TS (albo dołóż do istniejącego `order-status.test.ts`).
- Modify: `packages/db/test/order-gates.test.ts` — sekcja „maszyna stanów payment_status": zgodność 64 par SQL↔TS + testy zachowania bramki (regres, terminal, INSERT, spójność z rejestrem).

---

### Task 1: Mapa przejść `payment_status` w `@avably/core`

**Files:**
- Modify: `packages/core/src/rental/order-status.ts`
- Modify (jeśli barrel jawny): `packages/core/src/rental/index.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/rental/payment-status.test.ts`

**Interfaces:**
- Consumes: istniejące `PAYMENT_STATUSES`, `PaymentStatus` z tego samego pliku.
- Produces: `PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]>`, `canPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean`.

- [ ] **Step 1: Napisz padający test** — `packages/core/src/rental/payment-status.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { canPaymentTransition, PAYMENT_STATUSES, PAYMENT_TRANSITIONS } from "./order-status";

const OPEN = ["unpaid", "pending", "paid", "manual", "completed"] as const;

describe("maszyna stanów payment_status (ADR-035)", () => {
  it("każdy stan otwarty przechodzi w każdy otwarty + rozliczeniowy", () => {
    for (const from of OPEN) {
      for (const to of [...OPEN, "deposit_refunded", "refunded", "cancelled"] as const) {
        if (from === to) continue;
        expect(canPaymentTransition(from, to), `${from}->${to}`).toBe(true);
      }
    }
  });

  it("deposit_refunded wychodzi WYŁĄCZNIE w refunded/cancelled (zero regresu do otwartych)", () => {
    expect(canPaymentTransition("deposit_refunded", "refunded")).toBe(true);
    expect(canPaymentTransition("deposit_refunded", "cancelled")).toBe(true);
    for (const to of OPEN) {
      expect(canPaymentTransition("deposit_refunded", to), `deposit_refunded->${to}`).toBe(false);
    }
  });

  it("refunded i cancelled są terminalne", () => {
    for (const to of PAYMENT_STATUSES) {
      expect(canPaymentTransition("refunded", to), `refunded->${to}`).toBe(false);
      expect(canPaymentTransition("cancelled", to), `cancelled->${to}`).toBe(false);
    }
  });

  it("przejście tożsamościowe nie jest przejściem", () => {
    for (const s of PAYMENT_STATUSES) expect(canPaymentTransition(s, s), `${s}->${s}`).toBe(false);
  });

  it("PAYMENT_TRANSITIONS pokrywa każdy status kluczem", () => {
    for (const s of PAYMENT_STATUSES) expect(PAYMENT_TRANSITIONS[s], `brak klucza ${s}`).toBeDefined();
  });
});
```

- [ ] **Step 2: Uruchom — ma paść na braku eksportu**

Run: `pnpm --filter @avably/core test payment-status`
Expected: FAIL (`canPaymentTransition is not exported` / `undefined`).

- [ ] **Step 3: Implementacja** — dodaj do `order-status.ts` PO bloku `BLOCKING_PAYMENT_STATUSES`:

```ts
/**
 * Mapa dozwolonych przejść payment_status (ADR-035). Oś jest w fazie 1
 * sterowana ręcznie przez operatora (ADR-027 decyzja nr 7), a realne
 * płatności to faza 3 — mapa NIE modeluje drobnoziarnistego cyklu Stripe,
 * tylko chroni granicę rozliczenia:
 *   - zbiór OTWARTY {unpaid,pending,paid,manual,completed} przechodzi
 *     swobodnie w obrębie siebie ORAZ w rozliczenie (korekta operatorska),
 *   - deposit_refunded wychodzi WYŁĄCZNIE w refunded/cancelled — nie wraca
 *     do otwartych (regres „rozliczona → opłacona" gubiłby fakt rozliczenia),
 *   - refunded i cancelled są terminalne.
 * Lustro w triggerze app.payment_transition_allowed (0015); tożsamość obu
 * przypina test zgodności 64 par w order-gates.test.ts. Wejście w
 * deposit_refunded ma DODATKOWĄ bramkę spójności z rejestrem kaucji (0015).
 */
const OPEN_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "unpaid",
  "pending",
  "paid",
  "manual",
  "completed",
];

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  unpaid: [...OPEN_PAYMENT_STATUSES, "deposit_refunded", "refunded", "cancelled"].filter((s) => s !== "unpaid") as PaymentStatus[],
  pending: [...OPEN_PAYMENT_STATUSES, "deposit_refunded", "refunded", "cancelled"].filter((s) => s !== "pending") as PaymentStatus[],
  paid: [...OPEN_PAYMENT_STATUSES, "deposit_refunded", "refunded", "cancelled"].filter((s) => s !== "paid") as PaymentStatus[],
  manual: [...OPEN_PAYMENT_STATUSES, "deposit_refunded", "refunded", "cancelled"].filter((s) => s !== "manual") as PaymentStatus[],
  completed: [...OPEN_PAYMENT_STATUSES, "deposit_refunded", "refunded", "cancelled"].filter((s) => s !== "completed") as PaymentStatus[],
  deposit_refunded: ["refunded", "cancelled"],
  refunded: [],
  cancelled: [],
};

/**
 * Czy przejście payment_status `from` → `to` jest dozwolone. Przejście
 * tożsamościowe (from === to) NIE jest przejściem — zwraca false; UPDATE
 * niezmieniający statusu w ogóle nie pyta maszyny (tak samo trigger 0015).
 */
export function canPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}
```

Jeśli `packages/core/src/rental/index.ts` i `src/index.ts` wyliczają eksporty jawnie — dopisz `PAYMENT_TRANSITIONS`, `canPaymentTransition`. (Sprawdź: `grep -n "canTransition\|BLOCKING_PAYMENT" packages/core/src/rental/index.ts packages/core/src/index.ts`. Jeśli to `export *` — nic nie trzeba.)

- [ ] **Step 4: Uruchom — ma przejść**

Run: `pnpm --filter @avably/core test payment-status`
Expected: PASS (5 testów).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rental/order-status.ts packages/core/src/rental/payment-status.test.ts packages/core/src/rental/index.ts packages/core/src/index.ts
git commit -m "feat(core): mapa przejść payment_status (canPaymentTransition) — ADR-035"
```

---

### Task 2: Migracja 0015 — bramka `payment_status` w bazie

**Files:**
- Create: `packages/db/supabase/migrations/0015_payment_status_gate.sql`
- Test: `packages/db/test/order-gates.test.ts` (nowa sekcja)

**Interfaces:**
- Consumes: `app.orders_write_gate()` (0010, `create or replace` w tej migracji), `public.deposit_events` (0011), stałe `PAYMENT_TRANSITIONS`/`canPaymentTransition` (Task 1) jako lustro.
- Produces: `app.payment_transition_allowed(text, text) → boolean`; rozszerzony `app.orders_write_gate()` egzekwujący reguły A (mapa + INSERT) i B (spójność z rejestrem).

- [ ] **Step 1: Napisz padające testy** — dołóż na końcu `describe` w `packages/db/test/order-gates.test.ts` (użyj istniejących helperów `admin`, `sql`, `createTenant`, `createCustomer`, `createOrder` z tego pliku; jeśli `createOrder` nie zwraca id z ustawialnym payment_status — patrz niżej helper `setPayment`).

Import na górze pliku dołóż `canPaymentTransition`:
```ts
import { /* ...istniejące... */ canPaymentTransition } from "@avably/core";
```

Helpery lokalne (dodaj w bloku describe, obok istniejących):
```ts
// Ustaw payment_status service-rolem, walcząc po LEGALNYCH przejściach nie musimy —
// bramka INSERT wymaga stanu otwartego, więc order rodzi się 'unpaid'.
async function setPayment(orderId: string, tenantId: string, to: string) {
  return admin.from("orders").update({ payment_status: to }).eq("tenant_id", tenantId).eq("id", orderId).select("id");
}
async function collect(orderId: string, tenantId: string, amount: number) {
  const { error } = await admin.from("deposit_events").insert({ tenant_id: tenantId, order_id: orderId, kind: "collected", amount_grosze: amount });
  if (error) throw new Error(`collect: ${error.message}`);
}
async function refund(orderId: string, tenantId: string, amount: number) {
  const { error } = await admin.from("deposit_events").insert({ tenant_id: tenantId, order_id: orderId, kind: "refunded", amount_grosze: amount });
  if (error) throw new Error(`refund: ${error.message}`);
}
```

Testy:
```ts
describe("maszyna stanów payment_status (0015, ADR-035)", () => {
  it("zgodność 64 par SQL app.payment_transition_allowed == canPaymentTransition", async () => {
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        const [{ allowed }] = await sql<{ allowed: boolean }[]>`
          select app.payment_transition_allowed(${from}, ${to}) as allowed`;
        expect(allowed, `SQL ${from}->${to}`).toBe(canPaymentTransition(from, to));
      }
    }
  });

  it("regres deposit_refunded -> paid odrzucony 23514 (nic innego tego nie blokuje)", async () => {
    const tenantId = await createTenant("pay-regres");
    const orderId = await createOrder(tenantId); // rodzi się unpaid
    await collect(orderId, tenantId, 100_00);
    await refund(orderId, tenantId, 100_00); // saldo 0
    const ok = await setPayment(orderId, tenantId, "deposit_refunded");
    expect(ok.error?.message, `flip do deposit_refunded padł: ${ok.error?.message}`).toBeUndefined();
    const regres = await setPayment(orderId, tenantId, "paid");
    expect(regres.error?.code, `regres przeszedł: ${regres.error?.message}`).toBe(PG_BAD_TRANSITION);
  });

  it("refunded jest terminalny (refunded -> paid odrzucony 23514)", async () => {
    const tenantId = await createTenant("pay-term");
    const orderId = await createOrder(tenantId);
    expect((await setPayment(orderId, tenantId, "refunded")).error?.message).toBeUndefined();
    const back = await setPayment(orderId, tenantId, "paid");
    expect(back.error?.code, `wyjście z refunded przeszło: ${back.error?.message}`).toBe(PG_BAD_TRANSITION);
  });

  it("INSERT w stanie rozliczeniowym odrzucony 23514", async () => {
    const tenantId = await createTenant("pay-insert");
    const customerId = await createCustomer(tenantId);
    const { error } = await admin.from("orders").insert({
      tenant_id: tenantId, customer_id: customerId,
      start_date: "2026-09-01", end_date: "2026-09-02",
      delivery_method: "courier", payment_status: "deposit_refunded",
    });
    expect(error?.code, `INSERT deposit_refunded przeszedł: ${error?.message}`).toBe(PG_BAD_TRANSITION);
  });

  it("deposit_refunded bez pokrycia w rejestrze odrzucony 23514 (collected=0)", async () => {
    const tenantId = await createTenant("pay-ledger-0");
    const orderId = await createOrder(tenantId);
    const r = await setPayment(orderId, tenantId, "deposit_refunded");
    expect(r.error?.code, `deposit_refunded bez pobrań przeszedł: ${r.error?.message}`).toBe(PG_BAD_TRANSITION);
  });

  it("deposit_refunded przy saldzie != 0 odrzucony 23514", async () => {
    const tenantId = await createTenant("pay-ledger-bal");
    const orderId = await createOrder(tenantId);
    await collect(orderId, tenantId, 100_00); // saldo 100, nie 0
    const r = await setPayment(orderId, tenantId, "deposit_refunded");
    expect(r.error?.code, `deposit_refunded przy saldzie 100 przeszedł: ${r.error?.message}`).toBe(PG_BAD_TRANSITION);
  });

  it("legalne przejścia otwarte przechodzą (unpaid->paid->manual)", async () => {
    const tenantId = await createTenant("pay-open");
    const orderId = await createOrder(tenantId);
    expect((await setPayment(orderId, tenantId, "paid")).error?.message).toBeUndefined();
    expect((await setPayment(orderId, tenantId, "manual")).error?.message).toBeUndefined();
  });
});
```

- [ ] **Step 2: Uruchom — ma paść (funkcja `payment_transition_allowed` nie istnieje / bramka nie działa)**

Run: `pnpm --filter @avably/db test order-gates`
Expected: FAIL (funkcja nie istnieje → 42883; testy zachowania przechodzą UPDATE-y bez odmowy).

- [ ] **Step 3: Napisz migrację** — `packages/db/supabase/migrations/0015_payment_status_gate.sql`

```sql
-- 0015_payment_status_gate.sql
-- Bramka maszyny stanów payment_status (Faza 1, Zadanie 9). Decyzja: ADR-035.
--
-- DLACZEGO W BAZIE (spójnie z ADR-025 dla order_status): członek tenanta ma
-- przez RLS (0007) pełny UPDATE na orders — dowolne żądanie PostgREST może
-- przestawić payment_status. Dotąd oś była MIĘKKA (ADR-027 zostawił ją do
-- Zadania 9): UPDATE mógł cofnąć deposit_refunded na paid albo ustawić
-- deposit_refunded bez pokrycia w rejestrze kaucji. Bramka domyka to U ŹRÓDŁA.
--
-- ZERO NOWYCH TABEL: jedna funkcja mapy + create or replace triggera 0010.
-- Bramka obowiązuje KAŻDĄ rolę, także service_role — import nie ma prawa
-- tworzyć stanów sprzecznych z rejestrem ani cofać rozliczenia.
--
-- DWIE ORTOGONALNE REGUŁY:
--   A. Mapa przejść (app.payment_transition_allowed) — lustro
--      PAYMENT_TRANSITIONS z @avably/core (order-status.ts). Chroni granicę
--      rozliczenia: zbiór otwarty {unpaid,pending,paid,manual,completed}
--      przechodzi swobodnie w obrębie siebie i w rozliczenie; deposit_refunded
--      wychodzi tylko w refunded/cancelled (zero regresu do otwartych);
--      refunded/cancelled terminalne. INSERT wyłącznie w stanie otwartym.
--   B. Spójność z rejestrem: wejście w deposit_refunded wymaga saldo=0 przy
--      pobraniach>0 (lustro isDepositSettled / ADR-027), czytane PUNKTOWO.
--
-- ŚWIADOMIE BEZ ADVISORY LOCKA (w kontrze do 0011/ADR-026 — i to jest
-- decyzja, nie przeoczenie): jedyne, co podnosi saldo z 0, to zdarzenie
-- 'collected', a deposit_events_gate (0011) dla 'collected' locka NIE bierze
-- ("saldo tylko rośnie"). Lock w tej bramce nie zserializowałby więc jedynego
-- realnego interferenta. Zwrot/potrącenie po saldzie 0 i tak odrzuca 0011
-- (przekroczyłoby pobrania). Nietrwałość deposit_refunded po PÓŹNIEJSZYM
-- pobraniu to jawnie poza-zakresowe zachowanie ADR-027 (bramka mówi o saldzie
-- W CHWILI ustawienia, nie o wiecznej niezmienności). Lock, który nic nie
-- serializuje, maskowałby zamiast chronić — lekcja z ADR-024.
--
-- KODY BŁĘDÓW: 23514 (check_violation) dla obu reguł — ograniczenie na
-- WARTOŚCIACH, ta sama klasa co maszyna order_status (ADR-025). Klasy
-- mapowane przez PostgREST (23xxx -> 409); P0xxx ginęłoby w gołym 500.

-- ---------------------------------------------------------------------
-- 1. Mapa przejść payment_status
-- ---------------------------------------------------------------------
--
-- Lustro PAYMENT_TRANSITIONS z packages/core/src/rental/order-status.ts.
-- Zgodność 64 par przypina order-gates.test.ts.
create or replace function app.payment_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable as $$
  select case p_from
    when 'unpaid'    then p_to in ('pending','paid','manual','completed','deposit_refunded','refunded','cancelled')
    when 'pending'   then p_to in ('unpaid','paid','manual','completed','deposit_refunded','refunded','cancelled')
    when 'paid'      then p_to in ('unpaid','pending','manual','completed','deposit_refunded','refunded','cancelled')
    when 'manual'    then p_to in ('unpaid','pending','paid','completed','deposit_refunded','refunded','cancelled')
    when 'completed' then p_to in ('unpaid','pending','paid','manual','deposit_refunded','refunded','cancelled')
    when 'deposit_refunded' then p_to in ('refunded','cancelled')
    else false  -- refunded, cancelled: terminalne
  end
$$;

alter function app.payment_transition_allowed(text, text) set search_path = pg_catalog;

comment on function app.payment_transition_allowed(text, text) is
  'Mapa dozwolonych przejść payment_status — lustro canPaymentTransition z @avably/core (ADR-035). Zbiór otwarty przechodzi swobodnie + w rozliczenie; deposit_refunded tylko w refunded/cancelled; refunded/cancelled terminalne. Zgodność przypina order-gates.test.ts.';

revoke all on function app.payment_transition_allowed(text, text) from public, anon;
grant execute on function app.payment_transition_allowed(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Rozszerzenie app.orders_write_gate() o oś płatności
-- ---------------------------------------------------------------------
--
-- create or replace W CAŁOŚCI (kopia 0010 + dwa bloki płatności) — bo
-- create or replace nadpisuje też atrybuty; okrojona kopia zdjęłaby cicho
-- istniejącą logikę. Zmiany względem 0010 oznaczone komentarzem [0015].
create or replace function app.orders_write_gate() returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  r record;
  v_collected bigint;  -- [0015]
  v_settled bigint;    -- [0015]
begin
  if tg_op = 'INSERT' then
    if new.order_status <> 'pending' then
      raise exception
        'Zamówienie może powstać wyłącznie w statusie pending (otrzymano %).',
        new.order_status
        using errcode = '23514';
    end if;
    -- [0015] Zamówienie rodzi się w stanie płatności OTWARTYM — stan
    -- rozliczeniowy (deposit_refunded/refunded/cancelled) przy narodzinach
    -- zakłada historię, której nie ma (deposit_refunded dodatkowo: brak
    -- pokrycia w rejestrze). Default kolumny to 'unpaid', więc create_order
    -- przechodzi.
    if new.payment_status not in ('unpaid','pending','paid','manual','completed') then
      raise exception
        'Zamówienie może powstać wyłącznie w otwartym statusie płatności (otrzymano %).',
        new.payment_status
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.order_status is distinct from old.order_status then
    if not app.order_transition_allowed(old.order_status, new.order_status) then
      raise exception
        'Niedozwolone przejście statusu zamówienia: % → %.',
        old.order_status, new.order_status
        using errcode = '23514';
    end if;

    if new.order_status = 'cancelled'
       and new.payment_status in ('pending', 'paid', 'manual', 'completed', 'deposit_refunded')
    then
      raise exception
        'Nie można anulować zamówienia z nierozliczoną płatnością (payment_status=%).',
        new.payment_status
        using errcode = '23001';
    end if;
  end if;

  -- [0015] Bramka osi płatności — reguła A (mapa przejść).
  if new.payment_status is distinct from old.payment_status then
    if not app.payment_transition_allowed(old.payment_status, new.payment_status) then
      raise exception
        'Niedozwolone przejście statusu płatności: % → %.',
        old.payment_status, new.payment_status
        using errcode = '23514';
    end if;

    -- [0015] Reguła B — spójność z rejestrem kaucji przy wejściu w
    -- deposit_refunded: saldo 0 przy pobraniach > 0 (lustro isDepositSettled
    -- / ADR-027). Odczyt PUNKTOWY, bez advisory locka — uzasadnienie w
    -- nagłówku migracji (jedyny interferent 'collected' i tak locka nie bierze
    -- w 0011). SECURITY INVOKER triggera: odczyt przez RLS wołającego widzi
    -- komplet zdarzeń własnego tenanta (FK złożony nie dopuszcza obcych).
    if new.payment_status = 'deposit_refunded' then
      select
        coalesce(sum(amount_grosze) filter (where kind = 'collected'), 0),
        coalesce(sum(amount_grosze) filter (where kind in ('refunded','deducted')), 0)
        into v_collected, v_settled
      from public.deposit_events
      where tenant_id = new.tenant_id and order_id = new.id;

      if not (v_collected > 0 and v_settled = v_collected) then
        raise exception
          'Nie można oznaczyć kaucji jako rozliczonej: rejestr nie pokrywa (pobrano % gr, rozliczono % gr).',
          v_collected, v_settled
          using errcode = '23514';
      end if;
    end if;
  end if;

  if (new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date)
     and new.order_status in ('pending', 'reserved', 'ready_for_pickup', 'picked_up')
  then
    for r in
      select oi.id, oi.unit_id
      from public.order_items oi
      where oi.tenant_id = new.tenant_id
        and oi.order_id = new.id
        and oi.unit_id is not null
      order by oi.unit_id
    loop
      perform app.assert_unit_available(new.tenant_id, r.unit_id, r.id, new.start_date, new.end_date);
    end loop;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function app.orders_write_gate() is
  'Bramka zapisu orders (0010 + 0015): INSERT tylko pending i w otwartym payment_status; mapa przejść order_status (ADR-025) i payment_status (ADR-035); anulowanie blokowane przy pobranej płatności (23001); wejście w deposit_refunded wymaga pokrycia w rejestrze kaucji; re-walidacja terminu; updated_at.';
```

> **Uwaga:** przekopiuj blok dat/`updated_at`/order_status DOKŁADNIE z 0010 (sekcja 4) — powyżej jest wierny, ale zweryfikuj literę wobec `packages/db/supabase/migrations/0010_order_gates.sql` przed zapisem (create or replace nadpisuje całość).

- [ ] **Step 4: Zastosuj migrację na żywej bazie (BEZ resetu)**

Run:
```bash
cd ~/rental-platform/.claude/worktrees/przeglad-fazy/packages/db
supabase migration up
node -e '
const p=require("postgres");const s=p("postgresql://postgres:postgres@127.0.0.1:54322/postgres",{max:1});
s`select version from supabase_migrations.schema_migrations order by version`.then(r=>{console.log(r.map(x=>x.version).join(","));return s.end();});
'
```
Expected: lista kończy się `...,0014,0015`.
> Jeśli `supabase migration up` chce zresetować (bo cudza sesja przestawiła stan) — NIE resetuj wspólnej bazy bez potrzeby; zastosuj sam plik: `psql`/node bezpośrednim połączeniem wykonuje treść 0015, a wpis do `schema_migrations` dokłada `supabase migration up`. W ostateczności odtwórz stack i userów demo (seed-tenants.ts).

- [ ] **Step 5: Uruchom testy — mają przejść**

Run: `pnpm --filter @avably/db test order-gates`
Expected: PASS (istniejące 65 + nowa sekcja płatności). Powtórz raz przy jednorazowej czerwieni (wspólna baza).

- [ ] **Step 6: Regresja — panel deposit test musi zostać zielony**

Run (z env panelu — patrz `apps/panel`): `pnpm --filter @avably/panel test deposits`
Expected: PASS — w szczególności `deposits.test.ts:233` „pełne rozliczenie ... UPDATE payment_status przechodzi" (ścieżka `unpaid → deposit_refunded` przy saldzie 0 jest legalna wg reguł A+B).

- [ ] **Step 7: Commit**

```bash
git add packages/db/supabase/migrations/0015_payment_status_gate.sql packages/db/test/order-gates.test.ts
git commit -m "feat(db): bramka maszyny stanów payment_status u źródła (0015) — ADR-035"
```

---

### Task 3: Dowody mutacyjne bramki payment_status

Cel: udowodnić, że każda reguła bramki jest NIEZBĘDNA i że nic innego nie maskuje odmowy (obowiązkowa lektura: ADR-024 — lock numeracji maskujący wyścig). Dla KAŻDEJ mutacji: zmień → uruchom → zapisz który test spłonął + pytanie kontrolne → cofnij → zielono.

- [ ] **Step 1: Mutacja A (mapa przejść)** — w 0015 zmień w `payment_transition_allowed` linię `when 'deposit_refunded' then p_to in ('refunded','cancelled')` na `... in ('refunded','cancelled','paid')`. Zastosuj (`supabase migration up` nie wystarczy — funkcja `create or replace`; wykonaj plik bezpośrednim połączeniem lub `supabase db reset` TYLKO jeśli musisz — preferuj bezpośredni `create or replace` w node). Uruchom `pnpm --filter @avably/db test order-gates`.
  - Oczekiwane: pali „regres deposit_refunded -> paid" (i test zgodności 64 par). **Pytanie kontrolne:** co jeszcze mogłoby zatrzymać `deposit_refunded → paid`? CHECK 0007 dopuszcza wartość `paid`, RLS na `payment_status` nie patrzy, `order_status` nietknięty, blok 23001 dotyczy tylko `order_status='cancelled'`. Odpowiedź: NIC — odmowa pochodzi wyłącznie z mapy. Cofnij, zielono.

- [ ] **Step 2: Mutacja B (spójność z rejestrem)** — usuń z `orders_write_gate` blok `if new.payment_status = 'deposit_refunded' then ... end if;` (reguła B). Zastosuj `create or replace`. Uruchom.
  - Oczekiwane: palą „deposit_refunded bez pokrycia (collected=0)" i „deposit_refunded przy saldzie != 0". **Pytanie kontrolne:** co jeszcze czyta rejestr przy UPDATE orders? Żaden inny trigger/CHECK/RLS — `deposit_events_gate` odpala się na INSERT do `deposit_events`, nie na UPDATE `orders`. Odpowiedź: NIC. Cofnij, zielono.

- [ ] **Step 3: Mutacja C (INSERT-guard)** — usuń blok INSERT `if new.payment_status not in (...)`. Zastosuj. Uruchom.
  - Oczekiwane: pali „INSERT w stanie rozliczeniowym odrzucony". **Pytanie kontrolne:** czy reguła B złapałaby INSERT `deposit_refunded`? Na INSERট trigger to samo BEFORE, ale blok B jest w gałęzi UPDATE (`new.payment_status is distinct from old` — przy INSERT `old` jest NULL, gałąź nie wchodzi). Więc bez INSERT-guarda `deposit_refunded` przy narodzinach przeszłoby. Odpowiedź: tylko INSERT-guard to łapie. Cofnij, zielono.

- [ ] **Step 4: Kontrola pozytywna maskowania** — potwierdź, że test „legalne przejścia otwarte" i panelowy `deposits.test.ts` NIE reagują na mutacje A–C (zostają zielone) — dowód, że mutacje palą DOKŁADNIE swoje testy, nie „przy okazji".

- [ ] **Step 5: Zapisz wynik dowodów** w raporcie końcowym (Kontrakt raportu §3). Brak commita — mutacje cofnięte.

---

## Część 2 — przegląd adwersaryjny fazy (atak per mechanizm)

Zasada: ataki na ŻYWEJ bazie, jak przy PR #20. Drobne naprawy (≤ kilka linii, bez zmiany architektury) wolno zrobić w TYM PR; większe → dług z severity. Wynik per atak: **ZATRZYMANE (który mechanizm)** / **LUKA (severity + naprawa teraz / dług)**.

**Narzędzie:** skrypt node z `postgres.js` (bezpośrednie sesje SQL, `set local role` do wcielania ról) + `@supabase/supabase-js` (realne sesje anon/member przez PostgREST). Wzorce w `packages/db/test/rls-isolation.test.ts` i `order-gates.test.ts`. Sondy gołych mutacji mierz WEWNĄTRZ transakcji przed ROLLBACK (pułapka pomiaru — sekcja RLS docs, callout).

### Task 4: Izolacja tenantów tabel fazy 1

**Files:** Create (tymczasowy, poza commitem): `~/rental-platform/.claude/worktrees/przeglad-fazy/scratch-attack/` — skrypty ataków. NIE commituj skryptów; wynik idzie do raportu. (Macierz automatyczna `rls-isolation.test.ts` już pokrywa introspekcyjnie — tu robimy UZUPEŁNIAJĄCE, celowane ataki.)

- [ ] **Step 1:** Potwierdź, że `orders, order_items, deposit_events, courier_shipments, tenant_settings` są w macierzy `rls-isolation.test.ts` (introspekcja po `tenant_id`) — uruchom `pnpm --filter @avably/db test rls-isolation`, wynik zielony = izolacja SELECT/INSERT/UPDATE/DELETE + TRUNCATE + FK złożony już dowiedziona. Zapisz jako ZATRZYMANE (macierz automatyczna).
- [ ] **Step 2:** Celowany atak cross-tenant RPC: jako member tenanta A wywołaj `app.create_order` z `p_customer_id` należącym do tenanta B (przez `supabase.schema('app').rpc`). Oczekiwane: odmowa (RLS WITH CHECK / FK złożony 23503). Zapisz wynik.
- [ ] **Step 3:** Enumeracja: jako member A `select` z `orders`/`deposit_events` bez filtra — potwierdź, że widać WYŁĄCZNIE wiersze A. Zapisz.
- [ ] **Step 4:** `service_role` „najmocniejszy atakujący" tam, gdzie polityka ma trzymać: potwierdź, że `deposit_events` UPDATE/DELETE jest odrzucany dla service_role (brak grantu — append-only). Zapisz ZATRZYMANE/LUKA.

### Task 5: Maszyna stanów zamówień (PostgREST wprost)

- [ ] **Step 1:** Jako member A ustaw `order_status` przejściem SPOZA mapy przez PATCH wprost (np. `pending → picked_up`). Oczekiwane 23514. Zapisz.
- [ ] **Step 2:** Wyścig przypisania egzemplarza: dwie sesje, `Promise.all`, bezpośredni INSERT do `order_items` tego samego `unit_id`/terminu do dwóch ISTNIEJĄCYCH zamówień (ścieżka z ADR-024). Oczekiwane: dokładnie jeden sukces, przegrany 23P01. (To już w `order-gates.test.ts` — potwierdź przebiegiem, nie przepisuj.) Zapisz.
- [ ] **Step 3:** Obejście re-walidacji dat: PATCH `end_date` wprost na kolidujący termin w statusie aktywnym. Oczekiwane 23P01. Zapisz.
- [ ] **Step 4:** Residuum ADR-028: PATCH dat zamówienia TERMINALNEGO (`returned`/`cancelled`) — potwierdź, że przechodzi (świadome residuum, nie luka; udokumentowane testem `order-extension.test.ts`). Zapisz jako ZNANE RESIDUUM.

### Task 6: Ledger kaucji + oś płatności (nowa bramka 0015)

- [ ] **Step 1:** UPDATE/DELETE na `deposit_events` każdą rolą (anon/member A/service_role) — oczekiwane odmowy (append-only granty + polityki 0007). Zapisz.
- [ ] **Step 2:** Saldo ujemne przez równoległe potrącenia: dwie sesje, `Promise.all`, dwa `refunded`, każdy z osobna w saldzie, razem > pobrania. Oczekiwane: jeden 23514 (bramka 0011). (W `deposit-gates.test.ts` — potwierdź.) Zapisz.
- [ ] **Step 3:** **Nowa powierzchnia 0015:** PATCH `payment_status` wprost próbujący (a) regres `deposit_refunded → paid`, (b) `deposit_refunded` bez pokrycia w rejestrze, każdą rolą (member A + service_role). Oczekiwane 23514. Zapisz jako ZATRZYMANE (bramka 0015) — to jest dowód, że dług ADR-027 zamknięty.

### Task 7: Nowe powierzchnie 8a/8b

- [ ] **Step 1:** E-mail przy tranzycji przez PostgREST wprost: potwierdź, że PATCH `order_status` przez PostgREST NIE wywołuje wysyłki e-maila (wysyłka żyje w akcji panelu `changeOrderStatusAction`, nie w bazie). Udokumentuj jako ŚWIADOMĄ GRANICĘ, nie lukę: baza nie zna transportu poczty; e-mail to efekt warstwy panelu po utrwalonej tranzycji (ADR-033). Zapisz.
- [ ] **Step 2:** Kształt `email_sender` (CHECK 0014) na żywej bazie: spróbuj zapisać `tenant_settings.email_sender` bez `name`, ze złym typem `name`, z `reply_to` złej długości. Oczekiwane 23514 (coalesce-guard). Potwierdź asymetrię trójwartościową (brak klucza vs zły typ). Zapisz.

### Task 8: Konsolidacja wyników ataku

- [ ] **Step 1:** Zbuduj tabelę ataków (mechanizm → ZATRZYMANE/LUKA + severity). Dla każdej LUKI: naprawa w Z9 (≤ kilka linii) lub dług.
- [ ] **Step 2:** Drobne naprawy (jeśli są) — osobny commit `fix(...)` z testem regresji. Większe → do listy długów fazy 2 (Część 3).
- [ ] **Step 3:** Zapisz tabelę do raportu (Kontrakt raportu §4).

---

## Część 3 — domknięcie dokumentacji fazy

### File Structure — Część 3

- Modify: `docs/dokumentacja/index.html` — ADR-035 (dziennik decyzji), wpis dziennika budowy, model danych (0015), karta modułu „zamówienia" do stanu KOŃCOWEGO fazy, przegląd kart pod nieaktualne zdania, skonsolidowana lista długów fazy 2.
- Modify: `docs/dokumentacja/hub.html` — aktualny stan usług (Resend skonfigurowany).

### Task 9: ADR-035 + model danych + dziennik budowy

- [ ] **Step 1:** Dodaj `ADR-035` na końcu sekcji `#decyzje` (po ADR-034, wzorzec `<div class="log">`): kontekst (oś miękka, dług ADR-027), decyzja (dwie reguły A/B, zbiór otwarty vs rozliczeniowy, mapa, INSERT-guard, spójność z rejestrem), **świadomie bez advisory locka** (uzasadnienie: jedyny interferent `collected` nie bierze locka w 0011; nietrwałość po późniejszym pobraniu = poza-zakresowe zachowanie ADR-027; lock bez wyścigu maskuje — ADR-024), dowody mutacyjne (A/B/C + pytania kontrolne), co POZA zakresem (drobnoziarnista maszyna Stripe → faza 3).
- [ ] **Step 2:** Dodaj wpis dziennika budowy na GÓRZE sekcji `#dziennik`: `2026-07-17 · Faza 1, Zadanie 9 — przegląd adwersaryjny + bramka payment_status · PR #NN`. Treść: co powstało (0015, ADR-035), werdykt ataku (per mechanizm skrótowo), dowody mutacyjne, co odblokowuje.
- [ ] **Step 3:** Model danych sekcja `#dane`: dopisz akapit „Migracja 0015_payment_status_gate.sql" (wzorzec akapitów 0010/0011) — funkcja mapy, rozszerzenie triggera, reguły A/B. Zaktualizuj nagłówek `<h2>` sekcji o „+ bramka płatności (0015)" jeśli wylicza migracje. Zaktualizuj opis funkcji `app` (linia ~130) o `payment_transition_allowed`.
- [ ] **Step 4:** Commit `docs: ADR-035 + model danych + dziennik — bramka payment_status`.

### Task 10: Karta modułu „zamówienia" do stanu końcowego + przegląd kart

- [ ] **Step 1:** W karcie „apps/panel — zamówienia" (linia ~279) zaktualizuj zdanie o payment_status: dziś „oś płatności wciąż bez bramki w bazie (dług do Zadania 9)" (linia ~285) → stan KOŃCOWY: „oś płatności ma bramkę maszyny stanów w bazie (0015, ADR-035): mapa przejść + spójność deposit_refunded z rejestrem; regres i stan sprzeczny z rejestrem odrzucane 23514". Zdejmij słowo „dług".
- [ ] **Step 2:** Przejrzyj karty modułów fazy 1 pod kątem zdań nieaktualnych po 9 PR-ach — w szczególności: karta „Wysyłka e-maili cyklu najmu" (linia ~200) mówi „konto Resend NIE ISTNIEJE" / „realna wysyłka NIE JEST włączona" — a Resend jest skonfigurowany (domena `send.avably.io` verified, klucz w Vercelu — pamięć projektu + commit `95f1975`). Zaktualizuj „Stan" i „Włączenie" tej karty do stanu faktycznego (klucz w env; jeśli `WAITLIST_ENABLED`/wysyłka nadal wymaga decyzji właściciela — nazwij dokładnie, co zostało). NIE zmyślaj — sprawdź stan (pamięć `stack-decision-avably`, `resend` w commitach).
- [ ] **Step 3:** Sekcja modułu rdzenia wynajmu ma opisywać STAN KOŃCOWY fazy (nie przyrosty) — usuń sformułowania „Zadanie N dokłada" tam, gdzie mylą; zostaw odniesienia do ADR jako kotwice.
- [ ] **Step 4:** Commit `docs: karty modułów do stanu końcowego fazy 1 (payment_status, Resend)`.

### Task 11: Skonsolidowana lista długów fazy 2 + hub

- [ ] **Step 1:** Dodaj do `index.html` JEDNĄ sekcję/callout „Długi fazy 2" (dziś rozsiane po ADR-ach) z severity. Pozycje (zebrane z ADR-027/030/031/033, dziennika, briefu Z9):
  - realny refund Stripe (faza 3, ADR-027) — [severity do oceny],
  - webhooki/cron syncu przesyłek; paczkomaty (pointId); szyfrowanie credentiali GlobKurier w jsonb + zawężenie zapisu ustawień do ownera; `delivery_grosze` w formularzu tworzenia zamówienia (ADR-030/031),
  - formularz ustawień nadawcy e-maili w panelu (dziś `email_sender` ręcznie w `tenant_settings`); preferencja językowa KLIENTA (`customers` bez `locale`); wiring 4 szablonów e-maili kont (ADR-033),
  - daty zamówień terminalnych bez bramki (residuum ADR-028, udokumentowane testem),
  - ujednolicenie copy/kodu Turnstile w panelu (własna kopia `lib/turnstile.ts`, ADR-032),
  - superadmin bez organizacji widzi puste ekrany tenanckie (guardy przepuszczają, RLS zwraca pusto — zaobserwowane 2026-07-17; nieszkodliwe, mylące) — **potwierdź obserwację** w Części 2 zanim wpiszesz,
  - deploy panelu na prod (env, ręczna konfiguracja auth hooka w dashboardzie Supabase, superadmin na prod; ⚠️ BYPASSRLS roli migracji — ADR karta auth),
  - + wszelkie LUKI z severity znalezione w Części 2.
- [ ] **Step 2:** `hub.html`: zaktualizuj stan usług — Resend skonfigurowany (domena `send.avably.io` verified, klucz w Vercelu). Dopisz plan Z9 do „Materiały/Dokumenty" jeśli konwencja tego wymaga (plan w `docs/superpowers/plans/`).
- [ ] **Step 3:** Commit `docs: skonsolidowana lista długów fazy 2 + hub (Resend skonfigurowany)`.

---

## Część 4 — domknięcie: CI, werdykt, PR

### Task 12: Pełne bramki i PR

- [ ] **Step 1:** Rebase na `origin/main` (DOKUMENTACJA.md §3.4). Rozwiąż ewentualny konflikt `pnpm-lock.yaml` przez `pnpm install`.
- [ ] **Step 2:** Uruchom pełne bramki lokalnie:
  ```bash
  pnpm --filter @avably/core test
  pnpm --filter @avably/db test        # z env SUPABASE_LOCAL_*
  pnpm --filter @avably/panel test
  pnpm -w typecheck && pnpm -w lint
  ```
  Expected: zielono. Powtórz przy jednorazowej czerwieni integracyjnej (wspólna baza).
- [ ] **Step 3:** Push gałęzi, otwórz PR do `main` z opisem (kontekst, 0015/ADR-035, tabela ataków skrótowo, lista długów, dowody mutacyjne). Autor `Avably <admin@avably.io>`, zero AI/Co-Authored-By.
- [ ] **Step 4:** Poczekaj na oba joby CI (`ci`, `rls`) zielone. Jeśli czerwone — diagnoza, poprawka, ponów.
- [ ] **Step 5:** Raport końcowy wg Kontraktu raportu: 1. STATUS 2. PR+commity 3. Dowody mutacyjne (co paliło który test + pytanie kontrolne o maskowanie) 4. Tabela ataków 5. Decyzje (ADR-035) + długi fazy 2 z severity 6. Env/setup. **Werdykt MERGE/NIE dla fazy.**

---

## Self-Review (wykonane przy pisaniu planu)

- **Pokrycie briefu:** Część 1 (bramka payment_status) → Tasks 1–3. Część 2 (atak per mechanizm: izolacja, maszyna stanów, ledger, 8a/8b) → Tasks 4–8. Część 3 (docs: karta modułu stan końcowy, hub Resend, skonsolidowane długi) → Tasks 9–11. Raport MERGE/NIE + kontrakt raportu → Task 12. ✔
- **Zgodność typów:** `canPaymentTransition`/`PAYMENT_TRANSITIONS` (Task 1) używane w Task 2 teście zgodności i lustrze SQL `payment_transition_allowed`. Zbiór otwarty spójny między core, SQL i testami. ✔
- **Brak placeholderów:** SQL migracji i testy podane w całości; ataki mają konkretne oczekiwane kody. Blok dat w `orders_write_gate` oznaczony „zweryfikuj wobec 0010" — to celowa asekuracja wierności `create or replace`, nie placeholder. ✔
- **Decyzja bez locka** udokumentowana spójnie (nagłówek 0015 + ADR-035 + dowody mutacyjne) — nie ma testu wyścigu, bo bramka nie ma niezmiennika opartego o lock; to jawne rozstrzygnięcie, nie luka pokrycia. ✔
```
