"use server";

/**
 * Akcje zamówień. Wzorzec katalogu: walidacja Zod PRZED Supabase, guard
 * requireMember (obie role — obsługa zamówień to praca lady), mutacje
 * klientem z sesją. Bramkami są RLS (0007) i triggery 0010 — canTransition
 * i podgląd silnika w kreatorze to wygoda UI, autorytatywna odmowa
 * przychodzi z bazy (kody 23P01 / 23514 / 23001, patrz nagłówek 0010).
 */
import {
  AVAILABILITY_BLOCKING_ORDER_STATUSES,
  DEFAULT_TENANT_LOCALE,
  EMAIL_SENDER_KEY,
  canTransition,
  emailAvailability,
  isLocale,
  resendTransport,
  type Locale,
  type OrderStatus,
  type TenantSettingRow,
} from "@avably/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth";
import { orderFormSchema, statusChangeSchema } from "@/lib/order-validation";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { localePath } from "@/lib/navigation";
import { requireMember } from "@/lib/supabase-server";
import { getTenantCurrency } from "@/lib/tenant-currency";

import {
  sendRentalEmailForTransition,
  type RentalEmailOrderRow,
} from "./[id]/rental-email";
import {
  availabilityForRange,
  pickUnits,
  priceOrderItems,
  type ProductPricingRow,
} from "./pricing";

/** Kody bramek 0010 — mapowane na komunikaty dla operatora. */
const PG_UNIT_CONFLICT = "23P01";
const PG_BAD_TRANSITION = "23514";
const PG_CANCEL_BLOCKED = "23001";
const PG_UNIQUE_VIOLATION = "23505";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

interface AuthoritativeProductRow extends ProductPricingRow {
  product_units: { id: string; unavailable_from: string | null; unavailable_to: string | null }[];
}

export async function createOrderAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = orderFormSchema.safeParse({
    customerId: str(formData.get("customerId")),
    newCustomerEmail: str(formData.get("newCustomerEmail")),
    newCustomerName: str(formData.get("newCustomerName")),
    newCustomerPhone: str(formData.get("newCustomerPhone")),
    items: str(formData.get("items")),
    startDate: str(formData.get("startDate")),
    endDate: str(formData.get("endDate")),
    deliveryMethod: str(formData.get("deliveryMethod")),
    pickupLocationId: str(formData.get("pickupLocationId")),
    notes: str(formData.get("notes")),
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

  // Klient: istniejący albo utworzony w locie (dokładnie jeden — schemat).
  let customerId = input.customerId;
  if (!customerId) {
    const { data: created, error } = await ctx.supabase
      .from("customers")
      .insert({
        tenant_id: ctx.tenantId,
        email: input.newCustomer!.email,
        full_name: input.newCustomer!.fullName,
        phone: input.newCustomer!.phone,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        return {
          fieldErrors: {
            newCustomerEmail: "Klient z tym adresem e-mail już istnieje — wybierz go z listy.",
          },
        };
      }
      return { formError: error.message };
    }
    customerId = created.id as string;
  }

  // AUTORYTATYWNY odczyt cennika i kalendarza — wycena i przypisanie liczą
  // się na stanie z bazy, nie na danych, które przyszły z przeglądarki.
  const productIds = input.items.map((item) => item.productId);
  const uniqueProductIds = [...new Set(productIds)];

  const { data: productRows, error: productsError } = await ctx.supabase
    .from("products")
    .select(
      "id, base_price_day_grosze, deposit_grosze, auto_increment_multiplier, buffer_before_days, buffer_after_days, pricing_tiers(tier_days, multiplier), product_units(id, unavailable_from, unavailable_to)",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("active", true)
    .in("id", uniqueProductIds)
    .order("created_at", { referencedTable: "product_units", ascending: true });
  if (productsError) return { formError: productsError.message };

  const products = (productRows ?? []) as unknown as AuthoritativeProductRow[];
  if (products.length !== uniqueProductIds.length) {
    return { formError: "Któryś z produktów nie istnieje albo został wygaszony — odśwież stronę." };
  }

  const allUnitIds = products.flatMap((product) => product.product_units.map((unit) => unit.id));
  const { data: bookedRows, error: bookedError } = await ctx.supabase
    .from("order_items")
    .select("unit_id, orders!inner(start_date, end_date, order_status)")
    .eq("tenant_id", ctx.tenantId)
    .in("unit_id", allUnitIds.length > 0 ? allUnitIds : ["00000000-0000-0000-0000-000000000000"])
    .in("orders.order_status", [...AVAILABILITY_BLOCKING_ORDER_STATUSES]);
  if (bookedError) return { formError: bookedError.message };

  const bookedByUnit = new Map<string, { unitId: string; startDate: string; endDate: string }[]>();
  for (const row of (bookedRows ?? []) as unknown as {
    unit_id: string;
    orders: { start_date: string; end_date: string };
  }[]) {
    const list = bookedByUnit.get(row.unit_id) ?? [];
    list.push({ unitId: row.unit_id, startDate: row.orders.start_date, endDate: row.orders.end_date });
    bookedByUnit.set(row.unit_id, list);
  }

  // Dostępność per produkt (silnik) → pula wolnych egzemplarzy per produkt.
  const pools = new Map<string, readonly string[]>();
  for (const product of products) {
    const units = product.product_units.map((unit) => ({
      unitId: unit.id,
      unavailableFrom: unit.unavailable_from,
      unavailableTo: unit.unavailable_to,
    }));
    const booked = units.flatMap((unit) => bookedByUnit.get(unit.unitId) ?? []);
    const result = availabilityForRange(units, booked, input.startDate, input.endDate, {
      bufferBeforeDays: product.buffer_before_days,
      bufferAfterDays: product.buffer_after_days,
    });
    pools.set(product.id, result.availableUnitIds);
  }

  // Wybór egzemplarzy: decyzja warstwy zamówień (pierwsze wolne po
  // created_at) — patrz pricing.ts i ADR-024.
  const unitIds = pickUnits(productIds, pools);
  if (unitIds === null) {
    return { formError: "Za mało wolnych egzemplarzy w wybranym terminie." };
  }

  // Wycena WYŁĄCZNIE silnikiem (pricing.ts) na autorytatywnym cenniku.
  const pricingMap = new Map(products.map((product) => [product.id, product]));
  let pricing;
  try {
    pricing = priceOrderItems(productIds, pricingMap, input.startDate, input.endDate);
  } catch (err) {
    return { formError: err instanceof Error ? err.message : "Nie udało się wycenić zamówienia." };
  }

  // Atomowo: zamówienie + pozycje w jednej transakcji (app.create_order,
  // SECURITY INVOKER — RLS i bramki 0010 obowiązują wewnątrz).
  const { data: orderId, error: createError } = await ctx.supabase
    .schema("app")
    .rpc("create_order", {
      p_customer_id: customerId,
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_delivery_method: input.deliveryMethod,
      p_pickup_location_id: input.pickupLocationId,
      p_notes: input.notes,
      p_total_rental_grosze: pricing.totalRentalGrosze,
      p_total_deposit_grosze: pricing.totalDepositGrosze,
      p_items: productIds.map((productId, index) => ({
        product_id: productId,
        unit_id: unitIds[index],
        rental_grosze: pricing.items[index]!.rentalGrosze,
        deposit_grosze: pricing.items[index]!.depositGrosze,
      })),
    });
  if (createError) {
    if (createError.code === PG_UNIT_CONFLICT) {
      return {
        formError:
          "Wybrany termin został właśnie zajęty przez inne zamówienie — odśwież kalendarz i spróbuj ponownie.",
      };
    }
    return { formError: createError.message };
  }

  revalidatePath("/", "layout");
  redirect(await localePath(`/zamowienia/${orderId as string}`));
}

export async function changeOrderStatusAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = statusChangeSchema.safeParse({
    orderId: str(formData.get("orderId")),
    to: str(formData.get("to")),
    expectedFrom: str(formData.get("expectedFrom")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);
  const { orderId, to, expectedFrom } = parsed.data;

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Wygoda UI: czytelna odmowa bez rundy do bazy. Bramką jest trigger 0010.
  if (!canTransition(expectedFrom as OrderStatus, to as OrderStatus)) {
    return { formError: "To przejście statusu nie jest dozwolone." };
  }

  // Optymistyczna współbieżność: UPDATE trafia wyłącznie wiersz, który
  // wciąż jest w stanie widzianym przez operatora. `.select("id")` po
  // mutacji — RLS i chybione expectedFrom nie zgłaszają odmowy, dosięgają
  // zero wierszy; pusty wynik musi być błędem, nie cichym sukcesem.
  const { data, error } = await ctx.supabase
    .from("orders")
    .update({ order_status: to })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", orderId)
    .eq("order_status", expectedFrom)
    .select("id");
  if (error) {
    if (error.code === PG_CANCEL_BLOCKED) {
      return {
        formError:
          "Nie można anulować zamówienia z nierozliczoną płatnością — najpierw zarejestruj zwrot.",
      };
    }
    if (error.code === PG_BAD_TRANSITION) {
      return { formError: "To przejście statusu nie jest dozwolone." };
    }
    if (error.code === PG_UNIT_CONFLICT) {
      return { formError: "Egzemplarz z tego zamówienia jest już zajęty w tym terminie." };
    }
    return { formError: error.message };
  }
  if (!data || data.length === 0) {
    return {
      formError: "Status zamówienia został w międzyczasie zmieniony — odśwież stronę.",
    };
  }

  // Wysyłka jest krokiem PO utrwalonej tranzycji i NIGDY jej nie blokuje
  // (ADR-033). Od tego miejsca w dół status jest już zmieniony w bazie —
  // cokolwiek pójdzie nie tak z pocztą, akcja musi to zgłosić jako powód
  // przy sukcesie, nie jako porażkę całej operacji.
  const emailProblem =
    parsed.data.sendEmail === "on"
      ? await sendEmailAfterTransition(ctx, orderId, to as OrderStatus)
      : undefined;

  revalidatePath("/", "layout");
  // Sukces NIESIE powód niewysłania: status JEST zmieniony, ale operator
  // musi wiedzieć, że klient nic nie dostał.
  return emailProblem ? { success: "changed", formError: emailProblem } : { success: "changed" };
}

/**
 * Dociąga dane potrzebne do wiadomości i zleca wysyłkę. Zwraca powód
 * niewysłania albo undefined.
 *
 * Wydzielone z akcji, bo to wyłącznie I/O: logika (bramki konfiguracji,
 * uczciwa częściowa porażka) siedzi w sendRentalEmailForTransition i jest
 * testowana bez Supabase.
 */
async function sendEmailAfterTransition(
  ctx: Awaited<ReturnType<typeof requireMember>>,
  orderId: string,
  to: OrderStatus,
): Promise<string | undefined> {
  // Zapytania są niezależne — jedna runda, nie cztery po kolei.
  const [orderResult, settingsResult, tenantResult, currency] = await Promise.all([
    ctx.supabase
      .from("orders")
      .select(
        "order_number, start_date, end_date, total_rental_grosze, customers(full_name, email), pickup_locations(name)",
      )
      .eq("tenant_id", ctx.tenantId)
      .eq("id", orderId)
      .maybeSingle(),
    ctx.supabase
      .from("tenant_settings")
      .select("key, value")
      .eq("tenant_id", ctx.tenantId)
      .eq("key", EMAIL_SENDER_KEY),
    ctx.supabase.from("tenants").select("name, locale").eq("id", ctx.tenantId).maybeSingle(),
    // `!` jak w całym panelu: requireMember rzuca, gdy tenanta brak (auth.ts).
    getTenantCurrency(ctx.supabase, ctx.tenantId!),
  ]);

  const order = orderResult.data as RentalEmailOrderRow | null;
  const tenant = tenantResult.data as { name: string; locale: string | null } | null;
  if (!order || !tenant) {
    return "Status zmieniony, ale nie udało się odczytać danych do wiadomości — klient nie dostał powiadomienia.";
  }

  return sendRentalEmailForTransition({
    status: to,
    order,
    tenantName: tenant.name,
    // tenants.locale jest not null (0005), ale nieznana wartość nie może
    // wywrócić wysyłki — spada na domyślne locale tenanta.
    locale: isLocale(tenant.locale ?? "") ? (tenant.locale as Locale) : DEFAULT_TENANT_LOCALE,
    currency,
    settings: (settingsResult.data ?? []) as TenantSettingRow[],
    availability: emailAvailability(),
    transport: resendTransport(),
  });
}
