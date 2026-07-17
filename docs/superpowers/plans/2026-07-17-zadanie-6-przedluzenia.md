# Zadanie 6: Przedłużenia najmu — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przedłużenie najmu z panelu: czysta funkcja `quoteExtension` w silniku (dopłata = wycena całego nowego okresu minus dotychczasowego), akcja panelu wykonująca JEDEN UPDATE (`end_date` + `total_rental_grosze`) bramkowany triggerem 0010, podgląd dopłaty na żywo w szczególe zamówienia.

**Architektura:** Zero nowych migracji — bramka zmiany terminu JUŻ istnieje (sekcja 4 migracji `0010_order_gates.sql`: BEFORE UPDATE na `orders` woła `app.assert_unit_available` per pozycja z wykluczeniem własnej, kolizja = 23P01 z numerem kolidującego zamówienia w treści). Silnik liczy dopłatę jednego produktu; sumowanie pozycji wieloproduktowych robi warstwa panelu (`extension-pricing.ts`). Atomowość: obie kolumny w jednej instrukcji UPDATE — trigger odpala się na tej samej instrukcji, odmowa wycofuje całość.

**Tech Stack:** TypeScript strict, Vitest, Supabase (lokalny stack do testów integracyjnych), Next 16 server actions, next-intl, Zod.

## Ograniczenia globalne (każde zadanie je dziedziczy)

- Repo: `/Users/godekmaciej/rental-platform` (GitHub `avably/rental-platform`). Gałąź per zadanie, PR do main, NIGDY push na main.
- Autor commitów: `Avably <admin@avably.io>` (repo ma to w konfigu — zweryfikuj `git config user.name user.email` w kroku 1). ZERO wzmianek o AI, ZERO Co-Authored-By, ZERO nazw konkurencji. Język polski (kod, komentarze, commity, docs).
- Numery TEGO zadania: **ADR-028 + ADR-029**. Migracja **0012 NIE powstaje** (bramka 0010 wystarcza — jeśli w trakcie odkryjesz realną lukę, najpierw UDOWODNIJ ją testem i opisz w ADR). ADR-030/031 i migracja 0013 należą do równoległego Zadania 7 — nie sięgaj po nie.
- **Protokół antykolizyjny (Z7 biegnie równolegle):** twoje pliki to `packages/core/src/rental/extension*.ts`, nowe pliki `extension-*` w panelu, `packages/db/test/order-extension.test.ts`, `apps/panel/test/extension*.ts`. W `page.tsx` szczegółu zamówienia diff = JEDEN import + JEDNA linia JSX. W `messages/{en,pl}.json` tylko namespace `orders.extension.*`. Nie dotykaj `packages/core/src/courier/**` ani plików `delivery-*`.
- Dni inclusive (2→8 marca = 7 dni), cała arytmetyka dat w silniku (`@avably/core`), nigdy w UI/akcjach.
- Testy muszą UMIEĆ zapłonąć: dowód mutacyjny per mechanizm ochronny + pytanie kontrolne „co musiałoby się zepsuć, żeby test spłonął — i czy nic tego nie przykrywa?". Uwaga na maskowanie locków (ADR-024).
- Bramki weryfikuj z `--force` (cache turbo kłamie). Pełny równoległy turbo-gate bywa lokalnie flaky na jednym Supabase — false-red powtórz przed diagnozowaniem.
- Node 22 + pełne CLI supabase: `export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.local/share/supabase:$PATH"`.

## Decyzje rozstrzygnięte w tym planie (do spisania w ADR-028/029)

1. **Statusy, w których przedłużenie jest dozwolone** (ADR-028): dokładnie te, w których 0010 pilnuje dat — `AVAILABILITY_BLOCKING_ORDER_STATUSES` (`pending/reserved/ready_for_pickup/picked_up`). Egzekwowane w akcji filtrem `.in("order_status", ...)` na UPDATE (chybienie = zero wierszy = czytelny błąd). Baza NIE bramkuje edycji dat zamówień terminalnych — to zaakceptowane residuum: `returned`/`cancelled` nie blokują żadnego egzemplarza (są poza listą statusów blokujących), więc edycja ich dat nie może wytworzyć podwójnego wynajmu; przypinamy to jawnym testem dokumentującym, migracja niepotrzebna.
2. **Atomowość** (ADR-028): pojedynczy UPDATE obu kolumn (`end_date`, `total_rental_grosze`) — trigger `orders_write_gate` odpala się na tej samej instrukcji, odmowa 23P01 wycofuje obie zmiany. RPC niepotrzebne.
3. **Semantyka dopłaty** (ADR-029): dopłata pozycji = `calculatePrice(start, newEnd).rentalGrosze − calculatePrice(start, end).rentalGrosze` po AKTUALNYM cenniku; nowy total = ZAPISANY total + suma dopłat pozycji (nie pełny re-quote — nie przeceniamy uzgodnionego już najmu, dopłata dotyczy wyłącznie zmiany). Różnica może być UJEMNA (monotoniczność progów świadomie niewymuszana — ADR-022): pokazujemy ją uczciwie i tak samo dopisujemy; chroni widoczność, nie walidacja. Guard `newTotal >= 0` w akcji.
4. **Kaucja bez zmian**; `order_items.rental_grosze` zostają historyczne (wycena pierwotnego okresu) — źródłem prawdy sumy jest `orders.total_rental_grosze`; koszt nazwany w ADR-029.
5. **Skrócenie terminu POZA zakresem** Z6 (`newEndDate <= endDate` = jawny błąd silnika) — rejestrowane jako dług w ADR-028, nie implementować.
6. **Bez duplikacji walidacji dostępności w akcji**: bramką jest baza; komunikat o kolizji budujemy z numeru zamówienia zawartego w treści błędu 23P01 (wzorzec PG_* z `zamowienia/actions.ts`).

---

### Task 1: Gałąź i środowisko

**Files:** brak zmian w kodzie.

- [ ] **Step 1: Repo i gałąź**

```bash
cd ~/rental-platform
git config user.name && git config user.email   # oczekiwane: Avably / admin@avably.io — jeśli nie, ustaw lokalnie
git checkout main && git pull origin main
git checkout -b feat/zadanie-6-przedluzenia
export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.local/share/supabase:$PATH"
pnpm install
```

- [ ] **Step 2: Lokalny Supabase + env testów integracyjnych**

```bash
cd ~/rental-platform/packages/db
supabase start
eval "$(supabase status -o env | sed -n 's/^DB_URL=/export SUPABASE_LOCAL_URL=/p; s/^API_URL=/export SUPABASE_LOCAL_API_URL=/p; s/^ANON_KEY=/export SUPABASE_LOCAL_ANON_KEY=/p; s/^SERVICE_ROLE_KEY=/export SUPABASE_LOCAL_SERVICE_ROLE_KEY=/p')"
```

Dokładne nazwy zmiennych wyjścia `supabase status -o env` sprawdź w `docs/konwencje-migracji.md` (tam jest kanoniczny przepis) — powyższy sed dostosuj, jeśli nazwy się różnią. Sanity check:

```bash
cd ~/rental-platform && pnpm --filter @avably/db test   # oczekiwane: zielone, testy integracyjne NIE pominięte
```

### Task 2: Silnik — `quoteExtension` (czysta funkcja)

**Files:**
- Create: `packages/core/src/rental/extension.ts`
- Test: `packages/core/src/rental/extension.test.ts`
- Modify: `packages/core/src/rental/index.ts` (eksport), `packages/core/src/index.ts` (eksport)

**Interfaces:**
- Consumes: `rentalDaysInclusive`, `IsoDate` z `./dates`; `calculatePrice`, `PriceParams` z `./pricing`.
- Produces (Task 3/6 polegają dosłownie):
  ```ts
  export interface ExtensionQuote { newEndDate: IsoDate; additionalDays: number; additionalRentalGrosze: number }
  export function quoteExtension(order: { startDate: IsoDate; endDate: IsoDate }, newEndDate: IsoDate, params: PriceParams): ExtensionQuote;
  ```

- [ ] **Step 1: Failing test — tabela wprost z planu fazy**

`packages/core/src/rental/extension.test.ts`:

```ts
/**
 * Wycena przedłużenia (Zadanie 6). Sedno semantyki: dopłata to różnica
 * wyceny CAŁEGO nowego okresu i całego dotychczasowego — progi liczą się
 * od całości, nie „cena dodatkowych dni osobno". Wektor kanoniczny z planu
 * fazy: 5 dni → przedłużenie do 8 przy progu 7 przelicza całość po progu.
 */
import { describe, expect, it } from "vitest";

import { quoteExtension } from "./extension";
import type { PriceParams } from "./pricing";

/** Cennik jak w testach zamówień: baza 100 zł/doba, próg 7 dni za 6.5×. */
const PARAMS: PriceParams = {
  basePriceDayGrosze: 10_000,
  depositGrosze: 5_000,
  autoIncrementMultiplier: 1.0,
  tiers: [{ tierDays: 7, multiplier: 6.5 }],
};

describe("quoteExtension — dopłata jako różnica wyceny całości", () => {
  it.each([
    // [opis, endDate, newEndDate, additionalDays, additionalRentalGrosze]
    // 5 dni (50 000) → 8 dni: próg 7 (65 000) + 1 doba auto-increment (10 000) = 75 000.
    ["wektor z planu: 5→8 dni przelicza całość po progu 7", "2027-03-05", "2027-03-08", 3, 25_000],
    // 5 dni (50 000) → 7 dni: dokładnie próg (65 000) — 2 doby „kosztują" 15 000, nie 20 000.
    ["lądowanie dokładnie na progu: 5→7 dni", "2027-03-05", "2027-03-07", 2, 15_000],
    // 2 dni (20 000) → 4 dni: poniżej progu, czysta cena bazowa.
    ["poniżej progu: 2→4 dni po cenie bazowej", "2027-03-02", "2027-03-04", 2, 20_000],
    // 8 dni (75 000) → 10 dni: obie wyceny nad progiem, różnica = 2 doby auto-increment.
    ["nad progiem po obu stronach: 8→10 dni", "2027-03-08", "2027-03-10", 2, 20_000],
  ])("%s", (_label, endDate, newEndDate, additionalDays, additionalRentalGrosze) => {
    const quote = quoteExtension({ startDate: "2027-03-01", endDate }, newEndDate, PARAMS);
    expect(quote).toEqual({ newEndDate, additionalDays, additionalRentalGrosze });
  });

  it("różnica może być UJEMNA: próg tańszy niż suma dób (monotoniczność niewymuszana — ADR-022)", () => {
    // 6 dni bez progu = 60 000; 7 dni po progu 5.5 = 55 000. Uczciwa różnica: −5 000.
    const cheapTier: PriceParams = { ...PARAMS, tiers: [{ tierDays: 7, multiplier: 5.5 }] };
    const quote = quoteExtension({ startDate: "2027-03-01", endDate: "2027-03-06" }, "2027-03-07", cheapTier);
    expect(quote).toEqual({ newEndDate: "2027-03-07", additionalDays: 1, additionalRentalGrosze: -5_000 });
  });

  it("kaucja nie wchodzi do dopłaty (dotyczy najmu, nie kaucji)", () => {
    const quote = quoteExtension({ startDate: "2027-03-01", endDate: "2027-03-02" }, "2027-03-03", PARAMS);
    // 2→3 dni po bazie: 10 000, bez śladu depositGrosze (5 000).
    expect(quote.additionalRentalGrosze).toBe(10_000);
  });

  it.each([
    ["newEndDate równa endDate", "2027-03-05"],
    ["newEndDate przed endDate", "2027-03-04"],
  ])("skrócenie terminu to jawny błąd (%s) — poza zakresem Z6", (_label, newEndDate) => {
    expect(() =>
      quoteExtension({ startDate: "2027-03-01", endDate: "2027-03-05" }, newEndDate, PARAMS),
    ).toThrow(RangeError);
  });

  it("nieistniejąca data nowego końca jest odrzucana (2027-02-31 nie rolluje się cicho)", () => {
    expect(() =>
      quoteExtension({ startDate: "2027-02-01", endDate: "2027-02-05" }, "2027-02-31", PARAMS),
    ).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Uruchom — musi polec na braku modułu**

```bash
cd ~/rental-platform && pnpm --filter @avably/core test -- extension
```
Oczekiwane: FAIL (`Cannot find module './extension'` lub równoważny).

- [ ] **Step 3: Implementacja**

`packages/core/src/rental/extension.ts`:

```ts
/**
 * Wycena przedłużenia najmu (Zadanie 6). Czysta funkcja: dopłata to
 * RÓŻNICA wyceny całego nowego okresu (start..newEndDate) i całego
 * dotychczasowego (start..endDate) — nie „cena dodatkowych dni osobno",
 * bo progi liczą się od długości całego najmu (semantyka calculatePrice).
 *
 * Różnica może wyjść ujemna: monotoniczność progów jest świadomie
 * niewymuszana (ADR-022 — cennik chroni widoczność, nie walidacja),
 * więc dłuższy najem bywa tańszy. Zwracamy uczciwą różnicę; co z nią
 * zrobić, decyduje warstwa wywołująca (panel dopisuje ją do sumy — ADR-029).
 *
 * Kaucja NIE zmienia się przy przedłużeniu — dopłata dotyczy wyłącznie
 * najmu, stąd różnica liczona na rentalGrosze, nigdy na totalGrosze.
 *
 * Skrócenie terminu (newEndDate <= endDate) to jawny błąd: jest poza
 * zakresem Zadania 6 (rozliczenie nadpłaty to inna decyzja produktowa).
 */
import { rentalDaysInclusive, type IsoDate } from "./dates";
import { calculatePrice, type PriceParams } from "./pricing";

export interface ExtensionQuote {
  newEndDate: IsoDate;
  additionalDays: number;
  additionalRentalGrosze: number;
}

export function quoteExtension(
  order: { startDate: IsoDate; endDate: IsoDate },
  newEndDate: IsoDate,
  params: PriceParams,
): ExtensionQuote {
  // rentalDaysInclusive waliduje obie daty (kształt + istnienie w kalendarzu).
  const currentDays = rentalDaysInclusive(order.startDate, order.endDate);
  const newDays = rentalDaysInclusive(order.startDate, newEndDate);

  if (newDays <= currentDays) {
    throw new RangeError(
      `Przedłużenie wymaga daty po obecnym końcu najmu: otrzymano ${newEndDate} przy końcu ${order.endDate}`,
    );
  }

  const current = calculatePrice(order.startDate, order.endDate, params);
  const next = calculatePrice(order.startDate, newEndDate, params);

  return {
    newEndDate,
    additionalDays: newDays - currentDays,
    additionalRentalGrosze: next.rentalGrosze - current.rentalGrosze,
  };
}
```

- [ ] **Step 4: Eksporty**

W `packages/core/src/rental/index.ts` dopisz (po bloku eksportów z `./pricing`):

```ts
export { quoteExtension, type ExtensionQuote } from "./extension";
```

W `packages/core/src/index.ts` dopisz `quoteExtension` i `type ExtensionQuote` do istniejącego bloku re-eksportów z `./rental` (ten sam blok co `calculatePrice`).

- [ ] **Step 5: Testy zielone**

```bash
cd ~/rental-platform && pnpm --filter @avably/core test && pnpm --filter @avably/core typecheck
```
Oczekiwane: PASS (całość pakietu, nie tylko nowy plik).

- [ ] **Step 6: Dowód mutacyjny silnika (nie commituj mutacji!)**

Mutacja: w `extension.ts` podmień różnicę całości na „cenę dodatkowych dni osobno":

```ts
additionalRentalGrosze: calculatePrice(addDays(order.endDate, 1), newEndDate, params).rentalGrosze,
```

Uruchom test — oczekiwane: wektor kanoniczny płonie (dostaje 30 000 zamiast 25 000), lądowanie na progu płonie (20 000 zamiast 15 000). Pytanie kontrolne: nic nie maskuje — test jednostkowy bez I/O. Cofnij mutację, testy zielone.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rental/extension.ts packages/core/src/rental/extension.test.ts packages/core/src/rental/index.ts packages/core/src/index.ts
git commit -m "feat(core): quoteExtension — dopłata przedłużenia jako różnica wyceny całości"
```

### Task 3: Panel — sumowanie dopłaty po pozycjach (`extension-pricing.ts`)

**Files:**
- Create: `apps/panel/app/[locale]/zamowienia/[id]/extension-pricing.ts`
- Test: `apps/panel/test/extension-pricing.test.ts`

**Interfaces:**
- Consumes: `quoteExtension`, `PriceParams`, `IsoDate` z `@avably/core`.
- Produces (Task 5 i 6 używają dosłownie):
  ```ts
  export interface ExtensionProductRow { base_price_day_grosze: number; deposit_grosze: number; auto_increment_multiplier: number | string; pricing_tiers: { tier_days: number; multiplier: number | string }[] }
  export function priceParamsFromRow(row: ExtensionProductRow): PriceParams;
  export interface ExtensionItemPricing { itemId: string; params: PriceParams }
  export interface OrderExtensionQuote { newEndDate: IsoDate; additionalDays: number; additionalRentalGrosze: number }
  export function quoteOrderExtension(order: { startDate: IsoDate; endDate: IsoDate }, newEndDate: IsoDate, items: ExtensionItemPricing[]): OrderExtensionQuote;
  ```

- [ ] **Step 1: Failing test**

`apps/panel/test/extension-pricing.test.ts`:

```ts
/**
 * Sumowanie dopłaty przedłużenia po pozycjach — silnik wycenia JEDEN
 * produkt (quoteExtension), zamówienie wieloproduktowe sumuje panel.
 * Tożsamość z silnikiem przypięta wprost: suma == suma wywołań silnika
 * (wzorzec order-pricing.test.ts / tiers-preview.test.ts).
 */
import { quoteExtension, type PriceParams } from "@avably/core";
import { describe, expect, it } from "vitest";

import {
  priceParamsFromRow,
  quoteOrderExtension,
} from "@/app/[locale]/zamowienia/[id]/extension-pricing";

const ORDER = { startDate: "2027-03-01", endDate: "2027-03-05" };

const ZAGESZCZARKA: PriceParams = {
  basePriceDayGrosze: 10_000,
  depositGrosze: 5_000,
  autoIncrementMultiplier: 1.0,
  tiers: [{ tierDays: 7, multiplier: 6.5 }],
};
const AGREGAT: PriceParams = {
  basePriceDayGrosze: 20_000,
  depositGrosze: 0,
  autoIncrementMultiplier: 1.2,
  tiers: [],
};

describe("quoteOrderExtension — suma dopłat pozycji", () => {
  it("dwie pozycje różnych produktów: suma == suma quoteExtension per produkt", () => {
    const items = [
      { itemId: "i1", params: ZAGESZCZARKA },
      { itemId: "i2", params: AGREGAT },
    ];
    const expected =
      quoteExtension(ORDER, "2027-03-08", ZAGESZCZARKA).additionalRentalGrosze +
      quoteExtension(ORDER, "2027-03-08", AGREGAT).additionalRentalGrosze;

    const quote = quoteOrderExtension(ORDER, "2027-03-08", items);
    expect(quote.additionalRentalGrosze).toBe(expected); // 25 000 + 60 000 = 85 000
    expect(quote.additionalDays).toBe(3);
    expect(quote.newEndDate).toBe("2027-03-08");
  });

  it("dopłaty przeciwnych znaków sumują się uczciwie", () => {
    const cheapTier: PriceParams = { ...ZAGESZCZARKA, tiers: [{ tierDays: 7, multiplier: 5.5 }] };
    const items = [
      { itemId: "i1", params: cheapTier }, // 6→7 dni: −5 000
      { itemId: "i2", params: AGREGAT },  // 6→7 dni: +24 000 (auto-increment 1.2 nie gra: brak progów → baza)
    ];
    const sixDays = { startDate: "2027-03-01", endDate: "2027-03-06" };
    const quote = quoteOrderExtension(sixDays, "2027-03-07", items);
    expect(quote.additionalRentalGrosze).toBe(-5_000 + 20_000);
  });

  it("zamówienie bez pozycji: dopłata 0 (bramka 0010 i tak re-waliduje daty)", () => {
    const quote = quoteOrderExtension(ORDER, "2027-03-08", []);
    expect(quote).toEqual({ newEndDate: "2027-03-08", additionalDays: 3, additionalRentalGrosze: 0 });
  });
});

describe("priceParamsFromRow — konwersja wiersza PostgREST", () => {
  it("numeric przychodzi jako string i jest konwertowany", () => {
    const params = priceParamsFromRow({
      base_price_day_grosze: 10_000,
      deposit_grosze: 5_000,
      auto_increment_multiplier: "1.5",
      pricing_tiers: [{ tier_days: 7, multiplier: "6.5" }],
    });
    expect(params).toEqual({
      basePriceDayGrosze: 10_000,
      depositGrosze: 5_000,
      autoIncrementMultiplier: 1.5,
      tiers: [{ tierDays: 7, multiplier: 6.5 }],
    });
  });
});
```

- [ ] **Step 2: Uruchom — FAIL na braku modułu**

```bash
cd ~/rental-platform && pnpm --filter @avably/panel test -- extension-pricing
```

- [ ] **Step 3: Implementacja**

`apps/panel/app/[locale]/zamowienia/[id]/extension-pricing.ts`:

```ts
/**
 * Dopłata przedłużenia dla CAŁEGO zamówienia. Silnik (quoteExtension)
 * wycenia jeden produkt — sumowanie pozycji to praca panelu, w jednym,
 * testowanym miejscu (wzorzec zamowienia/pricing.ts: jedynym legalnym
 * działaniem na wynikach silnika jest dodawanie pozycji do siebie).
 *
 * Moduł jest czysty (zero I/O) — używa go i akcja serwerowa (autorytatywny
 * re-odczyt cennika), i formularz kliencki (podgląd na żywo z tych samych
 * parametrów), więc podgląd i zapis nie mają jak się rozjechać.
 */
import { quoteExtension, type IsoDate, type PriceParams } from "@avably/core";

/** Wiersz produktu z odczytu PostgREST — numeric przychodzi jako string. */
export interface ExtensionProductRow {
  base_price_day_grosze: number;
  deposit_grosze: number;
  auto_increment_multiplier: number | string;
  pricing_tiers: { tier_days: number; multiplier: number | string }[];
}

export function priceParamsFromRow(row: ExtensionProductRow): PriceParams {
  return {
    basePriceDayGrosze: row.base_price_day_grosze,
    depositGrosze: row.deposit_grosze,
    autoIncrementMultiplier: Number(row.auto_increment_multiplier),
    tiers: row.pricing_tiers.map((tier) => ({
      tierDays: tier.tier_days,
      multiplier: Number(tier.multiplier),
    })),
  };
}

export interface ExtensionItemPricing {
  itemId: string;
  params: PriceParams;
}

export interface OrderExtensionQuote {
  newEndDate: IsoDate;
  additionalDays: number;
  additionalRentalGrosze: number;
}

export function quoteOrderExtension(
  order: { startDate: IsoDate; endDate: IsoDate },
  newEndDate: IsoDate,
  items: ExtensionItemPricing[],
): OrderExtensionQuote {
  let additionalRentalGrosze = 0;
  // additionalDays nie zależy od cennika — liczymy raz, na pustym cenniku,
  // żeby zamówienie bez pozycji też dostało poprawną liczbę dni.
  const { additionalDays } = quoteExtension(order, newEndDate, {
    basePriceDayGrosze: 0,
    depositGrosze: 0,
    autoIncrementMultiplier: 1,
    tiers: [],
  });

  for (const item of items) {
    additionalRentalGrosze += quoteExtension(order, newEndDate, item.params).additionalRentalGrosze;
  }

  return { newEndDate, additionalDays, additionalRentalGrosze };
}
```

- [ ] **Step 4: Testy zielone**

```bash
cd ~/rental-platform && pnpm --filter @avably/panel test -- extension-pricing
```
Oczekiwane: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/app/\[locale\]/zamowienia/\[id\]/extension-pricing.ts apps/panel/test/extension-pricing.test.ts
git commit -m "feat(panel): sumowanie dopłaty przedłużenia po pozycjach zamówienia"
```

### Task 4: Walidacja Zod formularza przedłużenia

**Files:**
- Create: `apps/panel/lib/extension-validation.ts`
- Modify: `apps/panel/lib/order-validation.ts` (JEDNO słowo: `export` przed `const isoDateSchema`)
- Test: `apps/panel/test/extension-validation.test.ts`

**Interfaces:**
- Produces (Task 5 używa):
  ```ts
  export const orderExtensionSchema: z.ZodType<{ orderId: string; newEndDate: IsoDate; expectedEndDate: IsoDate }>;
  ```

- [ ] **Step 1: Failing test**

`apps/panel/test/extension-validation.test.ts`:

```ts
/**
 * Schemat akcji przedłużenia — lustro reguł, które autorytatywnie
 * egzekwuje silnik (data po obecnym końcu) i baza (bramka 0010).
 */
import { describe, expect, it } from "vitest";

import { orderExtensionSchema } from "@/lib/extension-validation";

const VALID = {
  orderId: "00000000-0000-4000-8000-000000000001",
  newEndDate: "2027-03-08",
  expectedEndDate: "2027-03-05",
};

describe("orderExtensionSchema", () => {
  it("poprawne wejście przechodzi", () => {
    expect(orderExtensionSchema.parse(VALID)).toEqual(VALID);
  });

  it.each([
    ["newEndDate równa expectedEndDate", { ...VALID, newEndDate: "2027-03-05" }],
    ["newEndDate przed expectedEndDate", { ...VALID, newEndDate: "2027-03-04" }],
    ["nieistniejąca data", { ...VALID, newEndDate: "2027-02-31" }],
    ["śmieciowa data", { ...VALID, newEndDate: "jutro" }],
    ["zepsuty uuid", { ...VALID, orderId: "nie-uuid" }],
  ])("odrzuca: %s", (_label, input) => {
    expect(orderExtensionSchema.safeParse(input).success).toBe(false);
  });
});
```

- [ ] **Step 2: FAIL na braku modułu**

```bash
cd ~/rental-platform && pnpm --filter @avably/panel test -- extension-validation
```

- [ ] **Step 3: Implementacja**

W `apps/panel/lib/order-validation.ts` zmień `const isoDateSchema =` na `export const isoDateSchema =` (nic więcej).

`apps/panel/lib/extension-validation.ts`:

```ts
/**
 * Schemat akcji przedłużenia najmu (Zadanie 6) — wzorzec
 * order-validation.ts: walidacja FormData PRZED Supabase, czytelny
 * komunikat zamiast surowego PostgREST. Bramką pozostaje baza (0010).
 *
 * expectedEndDate to optymistyczna współbieżność (wzorzec expectedFrom
 * ze zmiany statusu): UPDATE trafi wyłącznie wiersz, którego end_date
 * wciąż jest tym, co widział operator.
 */
import { z } from "zod";

import { isoDateSchema, uuidSchema } from "./order-validation";

export const orderExtensionSchema = z
  .object({
    orderId: uuidSchema,
    newEndDate: isoDateSchema,
    expectedEndDate: isoDateSchema,
  })
  // Lustro guardu silnika (quoteExtension): przedłużenie = data PO obecnym końcu.
  .refine((form) => form.newEndDate > form.expectedEndDate, {
    message: "Nowa data końca musi być późniejsza niż obecna.",
    path: ["newEndDate"],
  });

export type OrderExtensionInput = z.infer<typeof orderExtensionSchema>;
```

- [ ] **Step 4: Testy zielone + typecheck**

```bash
cd ~/rental-platform && pnpm --filter @avably/panel test -- extension-validation && pnpm --filter @avably/panel typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/panel/lib/extension-validation.ts apps/panel/lib/order-validation.ts apps/panel/test/extension-validation.test.ts
git commit -m "feat(panel): walidacja formularza przedłużenia najmu"
```

### Task 5: Dowód na poziomie bazy — bramka 0010 obsługuje przedłużenie (bez migracji)

**Files:**
- Test: `packages/db/test/order-extension.test.ts`

**Interfaces:**
- Consumes: schemat 0007–0011 (bez zmian), helpery-wzorce z `packages/db/test/order-gates.test.ts` (funkcje lokalne — skopiuj minimalny zestaw: `createTenant`, `createCustomer`, `createProduct`, `createUnit`, `createOrder`, `insertItem`, `setStatus`/`walkTo`; przeczytaj tamten plik przed pisaniem).

To jest test ISTNIEJĄCEGO zachowania (bramka z 0010) w scenariuszach przedłużenia — przejdzie od razu; jego wartość dowodzi dopiero mutacja (Step 4). Klient service-role: bramka jest zachowaniem SCHEMATU i obowiązuje każdą rolę (wzorzec order-gates.test.ts); ścieżkę sesji członka pokrywa Task 6.

- [ ] **Step 1: Napisz test**

`packages/db/test/order-extension.test.ts` (nagłówek i setup wzorcem `order-gates.test.ts` — `integrationEnv`, `describe.skipIf(!hasEnv)`, `createAdminClient`, sprzątanie tenantów w `afterAll`):

```ts
/**
 * Przedłużenie najmu na poziomie bazy (Zadanie 6, ADR-028): ZERO nowych
 * migracji — zmiana end_date przechodzi przez bramkę dat z 0010 (sekcja 4:
 * BEFORE UPDATE na orders woła app.assert_unit_available per pozycja,
 * z wykluczeniem własnej). Ten plik dowodzi scenariuszy PRZEDŁUŻENIA:
 *
 *   1. pojedynczy UPDATE end_date + total_rental_grosze: sukces zapisuje
 *      OBIE kolumny; własna pozycja nie koliduje sama ze sobą (wykluczenie),
 *   2. przedłużenie w termin następnego najmu tego samego egzemplarza:
 *      23P01, treść błędu niesie numer kolidującego zamówienia, a odmowa
 *      wycofuje OBIE kolumny (atomowość jednej instrukcji),
 *   3. zamówienie wieloproduktowe: bramka re-waliduje każdą pozycję
 *      z wykluczeniem jej samej — przedłużenie bez kolizji przechodzi,
 *   4. dokumentacja residuum ADR-028: edycja dat zamówienia terminalnego
 *      NIE przechodzi przez bramkę (returned nie blokuje egzemplarza,
 *      więc nie może wytworzyć podwójnego wynajmu) — pin świadomej decyzji.
 *
 * Mechanikę bramki (macierz buforów, okna serwisowe, wyścig) dowodzi
 * order-gates.test.ts — tu jej nie powtarzamy.
 */
```

Scenariusze (produkt z buforami 1/1, `base_price_day_grosze: 10_000`):

```ts
it("przedłużenie bez kolizji: jeden UPDATE zapisuje end_date I total, własna pozycja wykluczona", async () => {
  // A: 2027-03-01..05 na egzemplarzu U (pozycja przypisana), B: 2027-03-10..12 na U.
  // Rozszerzony zakres A po przedłużeniu do 03-08 = [02-28..03-09] — nie dotyka B.
  const { data, error } = await admin
    .from("orders")
    .update({ end_date: "2027-03-08", total_rental_grosze: 75_000 })
    .eq("id", orderAId)
    .select("end_date, total_rental_grosze");
  expect(error).toBeNull();
  expect(data![0]).toEqual({ end_date: "2027-03-08", total_rental_grosze: 75_000 });
});

it("przedłużenie w kolizję z NASTĘPNYM najmem: 23P01 z numerem zamówienia, obie kolumny wycofane", async () => {
  // A z powrotem na 03-01..05 (świeże zamówienie A2 w tym teście — testy niezależne).
  // Przedłużenie do 03-09: rozszerzony koniec 03-10 dotyka startu B → kolizja.
  const { error } = await admin
    .from("orders")
    .update({ end_date: "2027-03-09", total_rental_grosze: 85_000 })
    .eq("id", orderA2Id);
  expect(error?.code).toBe("23P01");
  expect(error?.message).toContain(orderBNumber); // numer kolidującego zamówienia w treści

  const { data: after } = await admin
    .from("orders")
    .select("end_date, total_rental_grosze")
    .eq("id", orderA2Id)
    .single();
  expect(after).toEqual({ end_date: "2027-03-05", total_rental_grosze: 50_000 }); // NIC się nie zmieniło
});

it("zamówienie wieloproduktowe: każda pozycja wykluczona z własnej listy kolizji", async () => {
  // C: 2027-04-01..05, dwie pozycje na dwóch egzemplarzach → przedłużenie do 04-08 przechodzi.
});

it("dokumentacja ADR-028: daty zamówienia terminalnego nie przechodzą przez bramkę", async () => {
  // Świeże zamówienie D bez sąsiadów, walkTo(orderDId, "returned"), UPDATE end_date → sukces.
  // returned jest POZA listą statusów blokujących — nie może wytworzyć kolizji.
});
```

Wypełnij setup konkretami: tenant + klient + produkt + egzemplarze przez helpery, zamówienia przez `createOrder` + `insertItem` (`rental_grosze: 50_000` przy tworzeniu A, żeby asercja atomowości miała punkt odniesienia — ustaw też `total_rental_grosze: 50_000` UPDATE-em bez zmiany dat zaraz po utworzeniu, to nie przechodzi przez bramkę dat).

- [ ] **Step 2: Testy zielone od razu (bramka istnieje)**

```bash
cd ~/rental-platform && pnpm --filter @avably/db test -- order-extension
```
Oczekiwane: PASS. Jeśli cokolwiek czerwone — STOP: albo test źle odwzorowuje semantykę bramki, albo znalazłeś realną lukę. Lukę najpierw potwierdź na czystej głowie (przeczytaj sekcję 4 migracji 0010), opisz w ADR-028 i dopiero wtedy rozważ zarezerwowany numer 0012.

- [ ] **Step 3: Dowód mutacyjny bramki (psql, poza repo — NIC nie commitujesz)**

Mutacja A — usuń re-walidację dat: w psql (`supabase status` → DB URL) wykonaj `create or replace function app.orders_write_gate() ...` z definicją z 0010, ale BEZ bloku `if (new.start_date is distinct from old.start_date ...) then ... end if;`.

```bash
pnpm --filter @avably/db test -- order-extension
```
Oczekiwane: płonie DOKŁADNIE test kolizji (UPDATE przechodzi zamiast 23P01). Pytanie kontrolne: co mogłoby maskować? Nic — żaden CHECK nie porównuje dat między zamówieniami, RLS nie patrzy na daty, trigger order_items nie odpala się na UPDATE orders. Potwierdź, że test wieloproduktowy i szczęśliwa ścieżka zostają zielone (mutacja nie wyłącza niczego innego).

Mutacja B — usuń wykluczenie własnej pozycji: przywróć funkcję, potem `create or replace function app.assert_unit_available(...)` z definicją z 0010, ale z warunkiem `oi.id is distinct from p_exclude_item_id` usuniętym z zapytania.

Oczekiwane: płonie szczęśliwa ścieżka i test wieloproduktowy (własna pozycja „koliduje" sama ze sobą → 23P01 na legalnym przedłużeniu).

Przywróć oryginały:

```bash
cd ~/rental-platform/packages/db && supabase db reset
# db reset WYMAZUJE usera demo (demo-katalog@test.local) — odtworzysz go w Task 8.
pnpm --filter @avably/db test   # całość pakietu zielona po restore
```

Zanotuj wyniki obu mutacji (które testy, jaki błąd) — wchodzą do raportu i ADR-028.

- [ ] **Step 4: Commit**

```bash
git add packages/db/test/order-extension.test.ts
git commit -m "test(db): przedłużenie najmu przechodzi przez bramkę dat z 0010 — kolizja, wykluczenie, atomowość"
```

### Task 6: Akcja panelu `extendOrderAction` + test integracyjny ścieżki panelu

**Files:**
- Create: `apps/panel/app/[locale]/zamowienia/[id]/extension-actions.ts`
- Test: `apps/panel/test/extensions.test.ts`

**Interfaces:**
- Consumes: `orderExtensionSchema` (Task 4), `quoteOrderExtension`/`priceParamsFromRow` (Task 3), `requireMember`, `FormState`/`zodErrorToState`, `AVAILABILITY_BLOCKING_ORDER_STATUSES` z `@avably/core`.
- Produces: `extendOrderAction(prevState: FormState, formData: FormData): Promise<FormState>` — Task 7 podpina ją do formularza.

- [ ] **Step 1: Implementacja akcji** (integracyjny test w Step 2 odwzorowuje jej mutację — piszemy akcję najpierw, bo unit-testy schematu i wyceny już ją poprzedziły w Taskach 3–4)

`apps/panel/app/[locale]/zamowienia/[id]/extension-actions.ts`:

```ts
"use server";

/**
 * Akcja przedłużenia najmu (Zadanie 6, ADR-028/ADR-029). Wzorzec
 * zamowienia/actions.ts: walidacja Zod PRZED Supabase, guard requireMember,
 * autorytatywny re-odczyt cennika z bazy (dane z przeglądarki niczego nie
 * wyceniają), mutacja klientem z sesją. Bramką jest trigger 0010 — zmiana
 * end_date re-waliduje dostępność KAŻDEJ pozycji z wykluczeniem własnej;
 * odmowa 23P01 niesie w treści numer kolidującego zamówienia.
 *
 * Atomowość (ADR-028): end_date i total_rental_grosze idą JEDNĄ instrukcją
 * UPDATE — trigger odpala się na tej samej instrukcji, odmowa wycofuje obie
 * kolumny. Statusy dozwolone = AVAILABILITY_BLOCKING_ORDER_STATUSES (te,
 * w których 0010 pilnuje dat); filtr .in() + expectedEndDate to
 * optymistyczna współbieżność — chybienie dosięga zero wierszy.
 */
import { AVAILABILITY_BLOCKING_ORDER_STATUSES, type OrderStatus } from "@avably/core";
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { orderExtensionSchema } from "@/lib/extension-validation";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import {
  priceParamsFromRow,
  quoteOrderExtension,
  type ExtensionProductRow,
} from "./extension-pricing";

/** Kod bramki 0010 — mapowany na komunikat dla operatora. */
const PG_UNIT_CONFLICT = "23P01";
/** Bramka podaje numer kolidującego zamówienia w treści błędu (0010). */
const CONFLICT_ORDER_PATTERN = /kolizja z zamówieniem (.+)\)\./u;

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

interface ExtensionOrderRow {
  id: string;
  start_date: string;
  end_date: string;
  order_status: OrderStatus;
  total_rental_grosze: number;
  order_items: { id: string; products: ExtensionProductRow | null }[];
}

export async function extendOrderAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = orderExtensionSchema.safeParse({
    orderId: str(formData.get("orderId")),
    newEndDate: str(formData.get("newEndDate")),
    expectedEndDate: str(formData.get("expectedEndDate")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);
  const input = parsed.data;

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // AUTORYTATYWNY odczyt: termin, status, suma i cennik pozycji z bazy —
  // podgląd z przeglądarki jest tylko wygodą, wycena liczy się tutaj.
  const { data: orderRow, error: orderError } = await ctx.supabase
    .from("orders")
    .select(
      "id, start_date, end_date, order_status, total_rental_grosze, order_items(id, products(base_price_day_grosze, deposit_grosze, auto_increment_multiplier, pricing_tiers(tier_days, multiplier)))",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.orderId)
    .maybeSingle();
  if (orderError) return { formError: orderError.message };
  if (!orderRow) return { formError: "Zamówienie nie istnieje albo zostało usunięte." };
  const order = orderRow as unknown as ExtensionOrderRow;

  if (!AVAILABILITY_BLOCKING_ORDER_STATUSES.includes(order.order_status)) {
    return { formError: "Przedłużenie jest możliwe tylko dla aktywnego zamówienia." };
  }
  if (order.end_date !== input.expectedEndDate) {
    return { formError: "Termin zamówienia został w międzyczasie zmieniony — odśwież stronę." };
  }

  // Wycena WYŁĄCZNIE silnikiem, po AKTUALNYM cenniku (ADR-029): dopłata to
  // różnica wyceny całości; nowy total = zapisany total + suma dopłat pozycji.
  let quote;
  try {
    quote = quoteOrderExtension(
      { startDate: order.start_date, endDate: order.end_date },
      input.newEndDate,
      order.order_items.flatMap((item) =>
        item.products ? [{ itemId: item.id, params: priceParamsFromRow(item.products) }] : [],
      ),
    );
  } catch (err) {
    return { formError: err instanceof Error ? err.message : "Nie udało się wycenić przedłużenia." };
  }

  const newTotalRentalGrosze = order.total_rental_grosze + quote.additionalRentalGrosze;
  if (newTotalRentalGrosze < 0) {
    return { formError: "Wycena po przedłużeniu byłaby ujemna — sprawdź progi cennika produktu." };
  }

  // JEDNA instrukcja UPDATE na obie kolumny (ADR-028). Filtry end_date +
  // order_status to optymistyczna współbieżność: chybienie dosięga zero
  // wierszy (RLS też nie zgłasza odmowy) — pusty wynik musi być błędem.
  const { data, error } = await ctx.supabase
    .from("orders")
    .update({ end_date: input.newEndDate, total_rental_grosze: newTotalRentalGrosze })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.orderId)
    .eq("end_date", input.expectedEndDate)
    .in("order_status", [...AVAILABILITY_BLOCKING_ORDER_STATUSES])
    .select("id");
  if (error) {
    if (error.code === PG_UNIT_CONFLICT) {
      const conflictNumber = CONFLICT_ORDER_PATTERN.exec(error.message)?.[1];
      return {
        formError: conflictNumber
          ? `Nowy termin koliduje z zamówieniem ${conflictNumber} — wybierz wcześniejszą datę.`
          : "Egzemplarz z tego zamówienia jest już zajęty w nowym terminie.",
      };
    }
    return { formError: error.message };
  }
  if (!data || data.length === 0) {
    return { formError: "Termin lub status zamówienia zmienił się w międzyczasie — odśwież stronę." };
  }

  revalidatePath("/", "layout");
  return { success: "extended" };
}
```

- [ ] **Step 2: Test integracyjny ścieżki panelu**

`apps/panel/test/extensions.test.ts` — wzorzec `orders.test.ts`/`deposits.test.ts` (realni użytkownicy przez `app.create_tenant`, realne sesje, zero mocków i zero service-role; skopiuj lokalne helpery `createTenantMember`/`signIn` i setup katalogu: produkt `base 10_000`, kaucja `5_000`, bufory 1/1, próg `7×6.5`, DWA egzemplarze; zamówienia twórz przez `app.create_order` z kwotami z silnika). Nagłówek pliku:

```ts
/**
 * Testy integracyjne przedłużenia najmu (Zadanie 6) na żywym, lokalnym
 * Supabase — ścieżka PANELU (klient z sesją):
 *
 *   1. przedłużenie jak w extendOrderAction: jeden UPDATE end_date+total
 *      z filtrami optymistycznej współbieżności — total po mutacji ==
 *      zapisany total + quoteExtension (silnik, co do grosza),
 *   2. kolizja z następnym najmem: 23P01 z sesji członka, treść niesie
 *      numer kolidującego zamówienia (akcja buduje z niego komunikat),
 *   3. chybione expectedEndDate → zero wierszy (błąd, nie cichy sukces),
 *   4. status terminalny (returned) → zero wierszy: filtr .in() jest
 *      jedyną zaporą — baza świadomie nie bramkuje dat zamówień
 *      terminalnych (ADR-028; pin w packages/db/test/order-extension.test.ts),
 *   5. izolacja: członek tenanta B nie przedłuży zamówienia A (zero wierszy).
 *
 * Mechanikę bramki 0010 dowodzi packages/db/test/order-extension.test.ts —
 * tu jej nie powtarzamy.
 */
```

Rdzeń scenariusza 1 (mutacja DOKŁADNIE jak w akcji — łącznie z `.select("id")`):

```ts
const quote = quoteExtension(
  { startDate: "2027-03-01", endDate: "2027-03-05" },
  "2027-03-08",
  PRICING,
);
const { data, error } = await tenantA.client
  .from("orders")
  .update({
    end_date: quote.newEndDate,
    total_rental_grosze: storedTotal + quote.additionalRentalGrosze,
  })
  .eq("tenant_id", tenantA.tenantId)
  .eq("id", orderId)
  .eq("end_date", "2027-03-05")
  .in("order_status", [...AVAILABILITY_BLOCKING_ORDER_STATUSES])
  .select("id");
expect(error).toBeNull();
expect(data).toHaveLength(1);
// Re-odczyt: total co do grosza zgodny z silnikiem (50 000 + 25 000).
```

Scenariusz 4: doprowadź świeże zamówienie do `returned` legalnym spacerem (`reserved → ready_for_pickup → picked_up → returned` — UPDATE-y statusu z sesji członka), potem UPDATE przedłużenia z filtrem `.in(...)` → `data` puste. Pytanie kontrolne: co pali ten test? Usunięcie filtru `.in()` z mutacji — UPDATE na returned przechodzi (DB nie bramkuje — dowiedzione w Task 5), `data` ma 1 wiersz, asercja płonie. Nic nie maskuje: trigger przepuszcza, RLS przepuszcza (własny tenant).

Scenariusz 5: `tenantB.client` wykonuje ten sam UPDATE na zamówieniu A → `data` puste, re-odczyt admina potwierdza brak zmian.

- [ ] **Step 3: Testy zielone**

```bash
cd ~/rental-platform && pnpm --filter @avably/panel test -- extensions && pnpm --filter @avably/panel typecheck && pnpm --filter @avably/panel lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/panel/app/\[locale\]/zamowienia/\[id\]/extension-actions.ts apps/panel/test/extensions.test.ts
git commit -m "feat(panel): akcja przedłużenia najmu — jeden UPDATE przez bramkę 0010, dopłata silnikiem"
```

### Task 7: UI — sekcja przedłużenia w szczególe zamówienia + i18n

**Files:**
- Create: `apps/panel/app/[locale]/zamowienia/[id]/extension-section.tsx` (async RSC, własny odczyt cennika)
- Create: `apps/panel/app/[locale]/zamowienia/[id]/extension-form.tsx` (client, podgląd na żywo)
- Modify: `apps/panel/app/[locale]/zamowienia/[id]/page.tsx` — **JEDEN import + JEDNA linia JSX** (protokół antykolizyjny)
- Modify: `apps/panel/messages/en.json`, `apps/panel/messages/pl.json` — WYŁĄCZNIE nowy namespace `orders.extension`

**Interfaces:**
- Consumes: `extendOrderAction` (Task 6), `quoteOrderExtension`/`priceParamsFromRow`/`ExtensionItemPricing` (Task 3), `addDays`/`formatMoney`/`AVAILABILITY_BLOCKING_ORDER_STATUSES` z `@avably/core`, `requireMember`, `getTenantCurrency`.
- Produces: `<ExtensionSection order={{ id, startDate, endDate, status }} />`.

- [ ] **Step 1: Klucze i18n**

Do `apps/panel/messages/pl.json`, wewnątrz `orders`, po `deposit` dopisz:

```json
"extension": {
  "title": "Przedłużenie najmu",
  "newEndLabel": "Nowa data końca",
  "quoteDays": "Dodatkowe dni: {days}",
  "quoteSurcharge": "Dopłata: {amount}",
  "pickDateHint": "Wybierz datę po obecnym końcu najmu, aby zobaczyć dopłatę.",
  "cta": "Przedłuż najem"
}
```

Do `apps/panel/messages/en.json` lustro:

```json
"extension": {
  "title": "Rental extension",
  "newEndLabel": "New end date",
  "quoteDays": "Additional days: {days}",
  "quoteSurcharge": "Surcharge: {amount}",
  "pickDateHint": "Pick a date after the current rental end to see the surcharge.",
  "cta": "Extend rental"
}
```

- [ ] **Step 2: Komponent kliencki**

`apps/panel/app/[locale]/zamowienia/[id]/extension-form.tsx`:

```tsx
"use client";

import { Button, Input, Label } from "@avably/ui";
import { addDays, formatMoney, type CurrencyCode } from "@avably/core";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";

import type { FormState } from "@/lib/form-state";

import {
  quoteOrderExtension,
  type ExtensionItemPricing,
  type OrderExtensionQuote,
} from "./extension-pricing";

const initialState: FormState = {};

/**
 * Formularz przedłużenia: wybór nowej daty końca + podgląd dopłaty NA ŻYWO.
 * Podgląd liczy quoteOrderExtension — ten sam czysty moduł, którego używa
 * akcja na autorytatywnym odczycie, więc liczby nie mają jak się rozjechać;
 * autorytatywna jest mimo to akcja (re-odczyt cennika) i bramka 0010.
 * Hidden expectedEndDate = optymistyczna współbieżność (wzorzec expectedFrom).
 */
export function ExtensionForm({
  orderId,
  startDate,
  endDate,
  items,
  currency,
  locale,
  action,
}: {
  orderId: string;
  startDate: string;
  endDate: string;
  items: ExtensionItemPricing[];
  currency: CurrencyCode;
  locale: string;
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("orders.extension");
  const [state, formAction, pending] = useActionState(action, initialState);
  const [newEndDate, setNewEndDate] = useState("");

  const quote: OrderExtensionQuote | null = useMemo(() => {
    if (!newEndDate) return null;
    try {
      return quoteOrderExtension({ startDate, endDate }, newEndDate, items);
    } catch {
      return null; // data nie-po-końcu albo niekompletna — podgląd milczy, submit zablokowany
    }
  }, [startDate, endDate, newEndDate, items]);

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-2 rounded border p-3 text-sm">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedEndDate" value={endDate} />
      <Label htmlFor="extension-new-end">{t("newEndLabel")}</Label>
      <Input
        id="extension-new-end"
        name="newEndDate"
        type="date"
        min={addDays(endDate, 1)}
        value={newEndDate}
        onChange={(event) => setNewEndDate(event.target.value)}
      />
      {quote ? (
        <p>
          {t("quoteDays", { days: quote.additionalDays })}
          {" · "}
          <span className="font-semibold">
            {t("quoteSurcharge", { amount: formatMoney(quote.additionalRentalGrosze, currency, locale) })}
          </span>
        </p>
      ) : (
        <p className="text-gray-500">{t("pickDateHint")}</p>
      )}
      <Button type="submit" disabled={pending || !quote}>
        {t("cta")}
      </Button>
      {state.formError ? (
        <p role="alert" className="text-red-600">
          {state.formError}
        </p>
      ) : null}
      {state.fieldErrors ? (
        <p role="alert" className="text-red-600">
          {Object.values(state.fieldErrors)[0]}
        </p>
      ) : null}
    </form>
  );
}
```

Uwaga: `formatMoney` z ujemną kwotą — sprawdź w `packages/core/src/money.ts`, że formatuje znak poprawnie (test `money.test.ts`); jeśli nie obsługuje ujemnych, sformatuj `−${formatMoney(Math.abs(...))}` w komponencie.

- [ ] **Step 3: Sekcja serwerowa**

`apps/panel/app/[locale]/zamowienia/[id]/extension-section.tsx`:

```tsx
import { AVAILABILITY_BLOCKING_ORDER_STATUSES, type OrderStatus } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { requireMember } from "@/lib/supabase-server";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { extendOrderAction } from "./extension-actions";
import { ExtensionForm } from "./extension-form";
import { priceParamsFromRow, type ExtensionProductRow } from "./extension-pricing";

/**
 * Sekcja przedłużenia najmu (Zadanie 6). Osobny RSC z WŁASNYM odczytem
 * cennika pozycji — page.tsx dokłada tylko jedną linię (protokół
 * antykolizyjny z równoległym Zadaniem 7). Statusy terminalne nie
 * renderują sekcji: przedłużanie zwróconego/anulowanego najmu nie ma
 * sensu operacyjnego (ADR-028), a akcja i tak by odmówiła.
 */
export async function ExtensionSection({
  order,
}: {
  order: { id: string; startDate: string; endDate: string; status: OrderStatus };
}) {
  if (!AVAILABILITY_BLOCKING_ORDER_STATUSES.includes(order.status)) return null;

  const ctx = await requireMember();
  const { data: rows } = await ctx.supabase
    .from("order_items")
    .select(
      "id, products(base_price_day_grosze, deposit_grosze, auto_increment_multiplier, pricing_tiers(tier_days, multiplier))",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", order.id);

  const items = ((rows ?? []) as unknown as { id: string; products: ExtensionProductRow | null }[])
    .flatMap((row) => (row.products ? [{ itemId: row.id, params: priceParamsFromRow(row.products) }] : []));

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("orders.extension");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("title")}</h2>
      <ExtensionForm
        orderId={order.id}
        startDate={order.startDate}
        endDate={order.endDate}
        items={items}
        currency={currency}
        locale={locale}
        action={extendOrderAction}
      />
    </section>
  );
}
```

- [ ] **Step 4: Wpięcie w page.tsx — dokładnie dwie linie diffa**

W `apps/panel/app/[locale]/zamowienia/[id]/page.tsx`:

1. Do bloku importów lokalnych (obok `import { DepositForms } from "./deposit-forms";`):
```tsx
import { ExtensionSection } from "./extension-section";
```
2. Między sekcją kaucji (`</section>` po `<DepositForms .../>`) a sekcją statusu:
```tsx
<ExtensionSection order={{ id: row.id, startDate: row.start_date, endDate: row.end_date, status: row.order_status }} />
```

Sprawdź `git diff apps/panel/app/\[locale\]/zamowienia/\[id\]/page.tsx` — dokładnie 2 dodane linie, zero innych zmian.

- [ ] **Step 5: Bramki pakietu + brak nowych tras**

```bash
cd ~/rental-platform && pnpm --filter @avably/panel typecheck && pnpm --filter @avably/panel lint && pnpm --filter @avably/panel test
```

Nowa trasa NIE powstaje (sekcja żyje w istniejącym `/zamowienia/[id]`), więc test enumeracyjny `protected-routes.test.ts` zostaje bez zmian — odnotuj to w raporcie (DoD mówi „rozszerz, JEŚLI dochodzą trasy"). Guard trasy pokrywa `requireMemberPage` strony; `ExtensionSection`/`extendOrderAction` mają własny `requireMember` (obrona w głębi).

- [ ] **Step 6: Commit**

```bash
git add apps/panel/app/\[locale\]/zamowienia/\[id\]/extension-section.tsx apps/panel/app/\[locale\]/zamowienia/\[id\]/extension-form.tsx apps/panel/app/\[locale\]/zamowienia/\[id\]/page.tsx apps/panel/messages/en.json apps/panel/messages/pl.json
git commit -m "feat(panel): sekcja przedłużenia najmu w szczególe zamówienia z podglądem dopłaty"
```

### Task 8: Weryfikacja uruchomieniowa w przeglądarce (oba locale)

**Files:** brak zmian w kodzie (ewentualne poprawki wracają do Tasków 6–7).

- [ ] **Step 1: Odtwórz dane demo** (po `supabase db reset` z Task 5 zniknął user demo)

Wg notatki `panel-local-dev-setup` / wzorca z poprzednich zadań: user `demo-katalog@test.local` (tenant „Wypożyczalnia Demo") + produkt z progami + egzemplarz + zamówienie demo `AV-2026-001`. Utwórz przez lokalny panel (rejestracja + kreator) albo skryptem admina — jak w Zadaniu 5.

- [ ] **Step 2: Uruchom panel przez preview** (wpis `avably-panel` w `.claude/launch.json`) i przejdź scenariusz:

1. Szczegół zamówienia demo (status pending/reserved) → sekcja „Przedłużenie najmu" widoczna.
2. Wybór daty → podgląd dopłaty zgodny z silnikiem co do grosza (policz ręcznie z progów produktu demo).
3. Zatwierdzenie → termin i suma najmu na stronie zaktualizowane.
4. Drugie zamówienie na ten sam egzemplarz tuż po pierwszym → przedłużenie w kolizję → czytelny komunikat z numerem kolidującego zamówienia.
5. Zamówienie w statusie `returned` → sekcji NIE ma.
6. Powtórz kroki 1–3 na locale EN (`/en/...`).
7. Konsola przeglądarki czysta (zero błędów hydratacji — pamiętaj lekcję „Badge w `<p>`").

Zrób zrzut ekranu sekcji z podglądem dopłaty (dowód do PR).

### Task 9: Dokumentacja HTML (warunek zamknięcia)

**Files:**
- Modify: `docs/dokumentacja/index.html` — karta modułu silnika, karta zamówień w panelu, ADR-028, ADR-029, wpis dziennika budowy.

- [ ] **Step 1: Karta modułu silnika** (sekcja Moduły, interfejs `@avably/core`): dopisz do listy publicznego interfejsu `quoteExtension(order, newEndDate, params): ExtensionQuote` z jednozdaniowym opisem („dopłata przedłużenia jako różnica wyceny całego nowego i dotychczasowego okresu; ujemna różnica możliwa — ADR-029").

- [ ] **Step 2: Karta zamówień w panelu** (obok akapitu „Kaucja (Zadanie 5...)"): nowy akapit **„Przedłużenie (Zadanie 6, ADR-028/ADR-029)"** — sekcja szczegółu zamówienia z wyborem nowej daty końca i podglądem dopłaty na żywo (`extension-pricing.ts` — ten sam czysty moduł w podglądzie i akcji), zatwierdzenie = JEDEN UPDATE `end_date` + `total_rental_grosze` z filtrami optymistycznej współbieżności (`expectedEndDate`, statusy aktywne); bramką baza (0010, 23P01 tłumaczone na komunikat z numerem kolidującego zamówienia); kaucja bez zmian; statusy terminalne bez sekcji.

- [ ] **Step 3: ADR-028** (nowy `div.log` w sekcji Decyzje, po ADR-027, format sąsiadów — Kontekst/Decyzja/Odrzucone/Dowód):

Treść (rozwiń do stylu sąsiednich ADR-ów):
- **Kontekst:** przedłużenie = zmiana `end_date` + dopłata; anty-wzorzec systemu źródłowego (goły UPDATE dat bez walidacji) jest w Avably zamknięty NA POZIOMIE BAZY już od 0010 (sekcja 4: BEFORE UPDATE re-waliduje dostępność każdej pozycji z wykluczeniem własnej). Pytanie zadania: czy przedłużenie wymaga własnej migracji i gdzie jest bramka.
- **Decyzja:** zero nowych migracji — bramką jest istniejący trigger 0010; atomowość przez JEDNĄ instrukcję UPDATE obu kolumn (trigger odpala się na tej samej instrukcji, odmowa wycofuje całość — RPC zbędne); statusy dozwolone = `AVAILABILITY_BLOCKING_ORDER_STATUSES` (dokładnie te, w których 0010 pilnuje dat), egzekwowane filtrem `.in()` w akcji + `expectedEndDate` (optymistyczna współbieżność).
- **Zaakceptowane residuum:** baza nie bramkuje edycji dat zamówień TERMINALNYCH — `returned`/`cancelled` nie blokują egzemplarzy, więc nie wytworzą podwójnego wynajmu; fałszowanie historii dat zostaje możliwe przez bezpośredni PATCH (przypięte testem dokumentującym w `order-extension.test.ts`). Bramka w bazie wróci, jeśli daty zamówień terminalnych zaczną nieść skutki (np. rozliczenia).
- **Świadomie poza zakresem (dług):** skrócenie terminu (`newEndDate <= endDate` = jawny błąd silnika) — rozliczenie nadpłaty to osobna decyzja produktowa.
- **Dowód:** testy `order-extension.test.ts` + mutacje: bez bloku re-walidacji dat w `orders_write_gate` płonie test kolizji (nic nie maskuje — żaden CHECK nie porównuje dat między zamówieniami); bez `is distinct from p_exclude_item_id` płonie szczęśliwa ścieżka (własna pozycja koliduje sama ze sobą). Wpisz RZECZYWISTE wyniki z Task 5 Step 3.

- [ ] **Step 4: ADR-029** (po ADR-028):
- **Kontekst:** progi liczą się od długości CAŁEGO najmu (ADR-018/022), więc „cena dodatkowych dni osobno" kłamie przy przekroczeniu progu; jednocześnie monotoniczność progów jest świadomie niewymuszana, więc dłuższy najem bywa tańszy.
- **Decyzja:** dopłata pozycji = wycena `start..newEnd` MINUS wycena `start..end` po AKTUALNYM cenniku (silnik, `quoteExtension`); suma dopłat pozycji dolicza się do ZAPISANEGO `total_rental_grosze` (nie pełny re-quote — uzgodnionej ceny istniejącego okresu nie przeceniamy przy okazji przedłużenia); różnica ujemna jest pokazywana i dopisywana uczciwie (chroni widoczność, wzorzec ADR-022); kaucja bez zmian (dopłata dotyczy najmu; `depositGrosze` nie wchodzi do różnicy).
- **Koszt nazwany wprost:** `order_items.rental_grosze` zostają wyceną PIERWOTNEGO okresu — po przedłużeniu suma pozycji ≠ `total_rental_grosze`; źródłem prawdy sumy jest kolumna zamówienia, a rejestrem zmiany — różnica widoczna w podglądzie przed zatwierdzeniem. Rozbicie dopłaty per pozycja w danych = przyszły pas (wróci najpóźniej przy fakturach).
- **Dowód:** tabelaryczny test silnika (wektor planu 5→8 przy progu 7: dopłata 25 000, nie 30 000), test ujemnej różnicy, test integracyjny „total co do grosza == zapisany + silnik".

- [ ] **Step 5: Dziennik budowy** — nowy `div.log` NA GÓRZE sekcji `#dziennik`, wzorem wpisu Zadania 5: data 2026-07-17, „Faza 1, Zadanie 6 — przedłużenia najmu", numer PR (uzupełnij po otwarciu), akapity: co powstało (silnik + panel + zero migracji), dowody (mutacyjne z RZECZYWISTYMI wynikami, weryfikacja w przeglądarce na obu locale), co świadomie poza zakresem (skrócenie terminu, rozbicie dopłaty per pozycja, bramka dat zamówień terminalnych).

- [ ] **Step 6: Commit**

```bash
git add docs/dokumentacja/index.html
git commit -m "docs: przedłużenia najmu — karta modułu, ADR-028/029, dziennik Zadania 6"
```

### Task 10: Pełne bramki, rebase, PR

- [ ] **Step 1: Pełny gate z --force** (env integracyjny wciąż wyeksportowany!)

```bash
cd ~/rental-platform
pnpm turbo run typecheck lint test build --force
```
Oczekiwane: wszystko zielone. Równoległy gate bywa flaky na jednym Supabase — false-red powtórz, zanim zaczniesz diagnozować.

- [ ] **Step 2: Rebase i push**

```bash
git fetch origin && git rebase origin/main
# po rebase powtórz gate, jeśli main się ruszył
git push -u origin feat/zadanie-6-przedluzenia
```

- [ ] **Step 3: PR do main** (`gh pr create`), tytuł: `Faza 1, Zadanie 6 — przedłużenia najmu`. Opis: co (silnik `quoteExtension` + akcja + sekcja panelu, ZERO migracji — bramka 0010 wystarcza), dlaczego (ADR-028/029), jak zweryfikowane (testy + dowody mutacyjne z wynikami + przeglądarka oba locale, zrzut ekranu). ZERO wzmianek o AI. Poczekaj na zielone CI (oba joby: `ci` + `rls`).

- [ ] **Step 4: Uzupełnij numer PR** w dzienniku budowy (`docs/dokumentacja/index.html`) i dopchnij commitem `docs: numer PR w dzienniku Zadania 6`.

---

## Self-review (wykonane przy pisaniu planu)

- Pokrycie briefu: silnik z dokładną sygnaturą planu fazy ✓ (Task 2), sumowanie wieloproduktowe w panelu ✓ (Task 3), akcja z jednym UPDATE + mapowanie 23P01 z numerem zamówienia ✓ (Task 6), i18n własny namespace ✓ (Task 7), test kolizji przez bazę + wykluczenie własnego zamówienia + dowody mutacyjne ✓ (Task 5), tabelaryczny test wyceny z liczbami planu ✓ (Task 2), trasy: nowych nie ma — enumeracja bez zmian, odnotowane ✓ (Task 7), dokumentacja HTML + ADR-028/029 + dziennik ✓ (Task 9), migracja 0012 nieużyta ✓.
- Spójność typów: `ExtensionQuote`/`quoteExtension` (core) ≠ `OrderExtensionQuote`/`quoteOrderExtension` (panel, suma pozycji) — nazwy rozdzielone świadomie; `ExtensionProductRow`/`priceParamsFromRow`/`ExtensionItemPricing` używane spójnie w Taskach 3/6/7.
- Decyzje briefu nieotwierane ponownie: dni inclusive, silnik czysty, dopłata jako różnica całości, kaucja bez zmian, statusy wg rekomendacji PM.
