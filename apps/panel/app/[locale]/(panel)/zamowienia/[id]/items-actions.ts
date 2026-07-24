"use server";

/**
 * Akcje EDYCJI POZYCJI zamówienia (uwagi przeglądu D6/N4): dodanie pozycji
 * (także produktu BEZ wolnego egzemplarza), zmiana przypisania/ceny/kaucji,
 * usunięcie pozycji. Wzorzec katalogu: walidacja Zod PRZED Supabase, guard
 * `requireMember`, autorytatywny re-odczyt z bazy, mutacja klientem z sesją.
 *
 * ================== BRAMKI, KTÓRYCH TEN MODUŁ NIE OMIJA ==================
 *
 * 1. DOSTĘPNOŚĆ EGZEMPLARZA. Przypisanie idzie zwykłym INSERT/UPDATE na
 *    `order_items`, więc przechodzi przez trigger `order_items_assignment_gate`
 *    (0010) → `app.assert_unit_available` (ADR-024). Kolizja wraca jako 23P01
 *    i jest tu tłumaczona na zdanie dla operatora Z POWODEM (numer kolidującego
 *    zamówienia niesie treść wyjątku). Podgląd dostępności, który sekcja
 *    pokazuje przy wyborze egzemplarza, jest WYGODĄ — autorytatywna odmowa
 *    przychodzi z bazy, bo między renderem a kliknięciem stan mógł się zmienić.
 *    Zero obejść: żadnego service-role w ścieżce mutacji, żadnego wyłączania
 *    triggera, żadnego „poprawimy potem".
 *
 * 2. REJESTR KAUCJI. Zmiana `deposit_grosze` pozycji rusza WYŁĄCZNIE kwotę
 *    ZAMIERZONĄ (`order_items.deposit_grosze` → `orders.total_deposit_grosze`).
 *    Ten moduł nie zapisuje ANI JEDNEGO wiersza do `deposit_events` i nie ma
 *    prawa tego robić: rejestr trzyma kwoty REALNIE pobrane/zwrócone/potrącone
 *    i jest jedynym źródłem prawdy o pieniądzach (ADR-069/070/072). Obniżenie
 *    zamiaru po pobraniu NIE jest zwrotem i nie wolno mu go udawać — pieniądze
 *    wracają do klienta wyłącznie przez rozliczenie kaucji (jeden przycisk
 *    w sekcji kaucji). Sekcja mówi to operatorowi wprost, gdy kaucja jest już
 *    pobrana.
 *
 * 3. STATUS ZAMÓWIENIA. Edycja tylko w `ITEM_EDIT_ORDER_STATUSES` — pełne
 *    uzasadnienie (w tym dlaczego lista jest WĘŻSZA niż lista statusów
 *    blokujących) stoi w nagłówku `items-validation.ts`. Zakaz jest
 *    egzekwowany tutaj, na autorytatywnym odczycie statusu, a nie tylko
 *    chowany w widoku.
 *
 * ================== SUMY ZAMÓWIENIA ==================
 *
 * `orders.total_*_grosze` nie utrzymuje żaden trigger — liczy je aplikacja.
 * Każda z trzech ścieżek kończy się `recalcOrderTotals`, które sumuje pozycje
 * OD ZERA z aktualnego stanu tabeli (patrz `sumOrderItemTotals`). PostgREST
 * nie daje transakcji przez dwa żądania, więc krok sum jest osobny — i to jest
 * dokładnie powód, dla którego jest przeliczeniem, a nie inkrementem: pominięty
 * (albo nieudany) krok naprawia się sam przy następnej operacji, a operator
 * dostaje o nim jawny komunikat, zamiast cichego rozjazdu kwot.
 */
import { AVAILABILITY_BLOCKING_ORDER_STATUSES, type OrderStatus } from "@avably/core";
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/auth";

import {
  availabilityForRange,
  priceOrderItems,
  type ProductPricingRow,
} from "../pricing";
import {
  ITEM_EDIT_ORDER_STATUSES,
  addOrderItemSchema,
  removeOrderItemSchema,
  sumOrderItemTotals,
  updateOrderItemSchema,
} from "./items-validation";

/** Kod bramki 0010 (assert_unit_available) — mapowany na zdanie dla operatora. */
const PG_UNIT_CONFLICT = "23P01";
/** Bramka podaje numer kolidującego zamówienia w treści błędu (0010). */
const CONFLICT_ORDER_PATTERN = /kolizja z zamówieniem (.+)\)\./u;

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

/** Ile pozycji może mieć zamówienie — lustro limitu z `orderFormSchema`. */
const MAX_ORDER_ITEMS = 50;

interface EditableOrderRow {
  id: string;
  start_date: string;
  end_date: string;
  order_status: OrderStatus;
}

interface AddProductRow extends ProductPricingRow {
  name: string;
  product_units: { id: string; unavailable_from: string | null; unavailable_to: string | null }[];
}

/**
 * Odmowa bramki dostępności → zdanie z POWODEM. Numer kolidującego zamówienia
 * jest w treści wyjątku i jest jedyną informacją, która pozwala operatorowi
 * zrobić coś dalej (zadzwonić, przesunąć termin) zamiast klikać drugi raz.
 * Okno serwisowe rzuca tym samym kodem bez numeru — stąd dwa warianty.
 */
function unitConflictMessage(message: string): string {
  const conflictNumber = CONFLICT_ORDER_PATTERN.exec(message)?.[1];
  return conflictNumber
    ? `Ten egzemplarz jest już zajęty w terminie zamówienia — kolizja z zamówieniem ${conflictNumber}. Wybierz inny egzemplarz albo zostaw pozycję bez przypisania.`
    : "Ten egzemplarz jest niedostępny w terminie zamówienia (kolizja albo okno serwisowe). Wybierz inny egzemplarz albo zostaw pozycję bez przypisania.";
}

/**
 * Autorytatywny odczyt zamówienia + zapora statusu. Zwraca wiersz albo gotowy
 * `FormState` z odmową — wołający nie interpretuje statusu sam.
 */
async function loadEditableOrder(
  ctx: AuthContext,
  orderId: string,
): Promise<{ order: EditableOrderRow } | { denial: FormState }> {
  const { data, error } = await ctx.supabase
    .from("orders")
    .select("id, start_date, end_date, order_status")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (error) return { denial: { formError: error.message } };
  if (!data) return { denial: { formError: "Zamówienie nie istnieje albo zostało usunięte." } };

  const order = data as unknown as EditableOrderRow;
  if (!(ITEM_EDIT_ORDER_STATUSES as readonly string[]).includes(order.order_status)) {
    return {
      denial: {
        formError: AVAILABILITY_BLOCKING_ORDER_STATUSES.includes(order.order_status)
          ? "Sprzęt jest już wydany — pozycji wydanego zamówienia nie edytujemy. Doposażenie w trakcie najmu zakładamy jako osobne zamówienie."
          : "Zamówienie jest zamknięte (zwrócone albo anulowane) — pozycji nie można już zmieniać.",
      },
    };
  }

  return { order };
}

/**
 * Przeliczenie sum zamówienia z POZYCJI. Woła się po KAŻDEJ mutacji pozycji;
 * czyta stan po mutacji, więc jest odporne na to, co dokładnie się zmieniło.
 */
async function recalcOrderTotals(ctx: AuthContext, orderId: string): Promise<FormState | null> {
  const { data, error } = await ctx.supabase
    .from("order_items")
    .select("rental_grosze, deposit_grosze")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", orderId);
  if (error) return { formError: `Pozycja zapisana, ale nie udało się przeliczyć sum: ${error.message}` };

  const totals = sumOrderItemTotals(
    (data ?? []).map((row) => ({
      rentalGrosze: row.rental_grosze as number,
      depositGrosze: row.deposit_grosze as number,
    })),
  );

  const { error: updateError } = await ctx.supabase
    .from("orders")
    .update({
      total_rental_grosze: totals.totalRentalGrosze,
      total_deposit_grosze: totals.totalDepositGrosze,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", orderId);
  if (updateError) {
    return {
      formError: `Pozycja zapisana, ale sumy zamówienia nie zostały odświeżone (${updateError.message}) — odśwież stronę i powtórz operację.`,
    };
  }

  return null;
}

/* ── Dodanie pozycji ──────────────────────────────────────────────────── */

/**
 * Dodaje JEDNĄ sztukę produktu do zamówienia.
 *
 * Egzemplarz: pierwszy WOLNY w terminie zamówienia (ta sama strategia co przy
 * tworzeniu zamówienia — `pickUnits` w pricing.ts, ADR-024). Gdy wolnego nie
 * ma, pozycja wchodzi mimo to, ale BEZ przypisania (`unit_id = NULL`) — bo
 * właśnie tego wymaga uwaga N4 („dodanie produktów niedostępnych, ale
 * z pokazaniem że niedostępne"), a bramka 0010 przepuszcza pozycję bez
 * egzemplarza świadomie: rezerwacja modelu nikomu nic nie blokuje. Alternatywa
 * — wciśnięcie zajętego egzemplarza — byłaby podwójnym najmem tej samej sztuki
 * i bramka i tak by ją odrzuciła.
 *
 * Wycena: WYŁĄCZNIE silnikiem (pricing.ts) po AKTUALNYM cenniku produktu.
 * Ręczna korekta kwot jest osobną operacją (`updateOrderItemAction`) — dzięki
 * temu w rejestrze zmian widać różnicę między „cennikiem" a „decyzją operatora".
 */
export async function addOrderItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = addOrderItemSchema.safeParse({
    orderId: str(formData.get("orderId")),
    productId: str(formData.get("productId")),
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

  const loaded = await loadEditableOrder(ctx, input.orderId);
  if ("denial" in loaded) return loaded.denial;
  const order = loaded.order;

  const { count: itemCount, error: countError } = await ctx.supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", order.id);
  if (countError) return { formError: countError.message };
  if ((itemCount ?? 0) >= MAX_ORDER_ITEMS) {
    return { formError: `Zamówienie ma już maksymalną liczbę pozycji (${MAX_ORDER_ITEMS}).` };
  }

  // AUTORYTATYWNY odczyt cennika i egzemplarzy — dane z przeglądarki niczego
  // nie wyceniają i niczego nie przypisują.
  const { data: productRow, error: productError } = await ctx.supabase
    .from("products")
    .select(
      "id, name, base_price_day_grosze, deposit_grosze, auto_increment_multiplier, buffer_before_days, buffer_after_days, pricing_tiers(tier_days, multiplier), product_units(id, unavailable_from, unavailable_to)",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("active", true)
    .eq("id", input.productId)
    .maybeSingle();
  if (productError) return { formError: productError.message };
  if (!productRow) {
    return { formError: "Produkt nie istnieje albo został wygaszony — odśwież stronę." };
  }
  const product = productRow as unknown as AddProductRow;

  const unitIds = product.product_units.map((unit) => unit.id);
  const { data: bookedRows, error: bookedError } = await ctx.supabase
    .from("order_items")
    .select("unit_id, orders!inner(start_date, end_date, order_status)")
    .eq("tenant_id", ctx.tenantId)
    .in("unit_id", unitIds.length > 0 ? unitIds : ["00000000-0000-0000-0000-000000000000"])
    .in("orders.order_status", [...AVAILABILITY_BLOCKING_ORDER_STATUSES]);
  if (bookedError) return { formError: bookedError.message };

  const booked = ((bookedRows ?? []) as unknown as {
    unit_id: string;
    orders: { start_date: string; end_date: string };
  }[]).map((row) => ({
    unitId: row.unit_id,
    startDate: row.orders.start_date,
    endDate: row.orders.end_date,
  }));

  const availability = availabilityForRange(
    product.product_units.map((unit) => ({
      unitId: unit.id,
      unavailableFrom: unit.unavailable_from,
      unavailableTo: unit.unavailable_to,
    })),
    booked,
    order.start_date,
    order.end_date,
    {
      bufferBeforeDays: product.buffer_before_days,
      bufferAfterDays: product.buffer_after_days,
    },
  );
  // Egzemplarze zajęte przez WŁASNE pozycje tego zamówienia wypadają z puli
  // razem z cudzymi: zamówienie w statusie edytowalnym jest statusem
  // blokującym, więc jego pozycje są w `booked`. Ta sama sztuka nie może
  // stać na zamówieniu dwa razy.
  const unitId = availability.availableUnitIds[0] ?? null;

  let pricing;
  try {
    pricing = priceOrderItems(
      [product.id],
      new Map([[product.id, product]]),
      order.start_date,
      order.end_date,
    );
  } catch (err) {
    return { formError: err instanceof Error ? err.message : "Nie udało się wycenić pozycji." };
  }
  const priced = pricing.items[0]!;

  const { error: insertError } = await ctx.supabase.from("order_items").insert({
    tenant_id: ctx.tenantId,
    order_id: order.id,
    product_id: product.id,
    unit_id: unitId,
    rental_grosze: priced.rentalGrosze,
    deposit_grosze: priced.depositGrosze,
  });
  if (insertError) {
    if (insertError.code === PG_UNIT_CONFLICT) return { formError: unitConflictMessage(insertError.message) };
    return { formError: insertError.message };
  }

  const totalsError = await recalcOrderTotals(ctx, order.id);
  if (totalsError) return totalsError;

  revalidatePath("/", "layout");
  // Pozycja bez egzemplarza to NIE jest połowiczna porażka — to świadomy stan,
  // o którym operator ma wiedzieć od razu, a nie dowiedzieć się z tabeli.
  return unitId === null
    ? { notice: `Dodano „${product.name}" BEZ przypisanego egzemplarza — w tym terminie nie ma wolnej sztuki.` }
    : { success: "item-added" };
}

/* ── Edycja pozycji ───────────────────────────────────────────────────── */

/**
 * Zmiana przypisanego egzemplarza oraz RĘCZNA korekta najmu i kaucji pozycji.
 *
 * Wszystkie trzy kolumny idą JEDNĄ instrukcją UPDATE (wzorzec ADR-028): bramka
 * odpala się na tej samej instrukcji, więc odmowa 23P01 wycofuje komplet —
 * nie ma stanu, w którym kwoty się zapisały, a przypisanie nie.
 */
export async function updateOrderItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateOrderItemSchema.safeParse({
    orderId: str(formData.get("orderId")),
    itemId: str(formData.get("itemId")),
    unitId: str(formData.get("unitId")),
    rental: str(formData.get("rental")),
    deposit: str(formData.get("deposit")),
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

  const loaded = await loadEditableOrder(ctx, input.orderId);
  if ("denial" in loaded) return loaded.denial;

  const { data: itemRow, error: itemError } = await ctx.supabase
    .from("order_items")
    .select("id, product_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", input.orderId)
    .eq("id", input.itemId)
    .maybeSingle();
  if (itemError) return { formError: itemError.message };
  if (!itemRow) return { formError: "Pozycja nie istnieje albo została usunięta — odśwież stronę." };

  // Egzemplarz MUSI należeć do produktu pozycji. Baza tego nie pilnuje:
  // `order_items_unit_fk` sprawdza wyłącznie parę (tenant, unit), więc bez
  // tego sprawdzenia dałoby się podpiąć pod „Nagrzewnicę" sztukę agregatu —
  // wiersz spójny formalnie, bezsensowny magazynowo i niewidoczny w żadnym
  // raporcie. To jedyne miejsce, w którym ta reguła może stać.
  if (input.unitId !== null) {
    const { data: unitRow, error: unitError } = await ctx.supabase
      .from("product_units")
      .select("id, product_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", input.unitId)
      .maybeSingle();
    if (unitError) return { formError: unitError.message };
    if (!unitRow) return { formError: "Egzemplarz nie istnieje — odśwież stronę." };
    if ((unitRow as { product_id: string }).product_id !== (itemRow as { product_id: string }).product_id) {
      return { formError: "Ten egzemplarz należy do innego produktu — wybierz sztukę produktu z tej pozycji." };
    }
  }

  // JEDNA instrukcja: przypisanie + obie kwoty. `deposit_grosze` to kwota
  // ZAMIERZONA — rejestr `deposit_events` nie jest tu dotykany (nagłówek).
  const { data, error } = await ctx.supabase
    .from("order_items")
    .update({
      unit_id: input.unitId,
      rental_grosze: input.rentalGrosze,
      deposit_grosze: input.depositGrosze,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", input.orderId)
    .eq("id", input.itemId)
    .select("id");
  if (error) {
    if (error.code === PG_UNIT_CONFLICT) return { formError: unitConflictMessage(error.message) };
    return { formError: error.message };
  }
  if (!data || data.length === 0) {
    return { formError: "Pozycja zmieniła się w międzyczasie — odśwież stronę." };
  }

  const totalsError = await recalcOrderTotals(ctx, input.orderId);
  if (totalsError) return totalsError;

  revalidatePath("/", "layout");
  return { success: "item-updated" };
}

/* ── Usunięcie pozycji ────────────────────────────────────────────────── */

export async function removeOrderItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = removeOrderItemSchema.safeParse({
    orderId: str(formData.get("orderId")),
    itemId: str(formData.get("itemId")),
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

  const loaded = await loadEditableOrder(ctx, input.orderId);
  if ("denial" in loaded) return loaded.denial;

  const { data, error } = await ctx.supabase
    .from("order_items")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", input.orderId)
    .eq("id", input.itemId)
    .select("id");
  if (error) return { formError: error.message };
  if (!data || data.length === 0) {
    return { formError: "Pozycja nie istnieje albo została już usunięta — odśwież stronę." };
  }

  const totalsError = await recalcOrderTotals(ctx, input.orderId);
  if (totalsError) return totalsError;

  revalidatePath("/", "layout");
  return { success: "item-removed" };
}
