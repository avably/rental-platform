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
  DELIVERY_PRICING_KEY,
  DeliveryPriceOverrideError,
  DeliveryPricingError,
  EMAIL_SENDER_KEY,
  ORDER_STATUSES,
  canTransition,
  isClosingForwardTransition,
  deliveryPricingFromSettings,
  destinationColumns,
  emailAvailability,
  isLocale,
  resendTransport,
  resolveDeliveryCost,
  type Locale,
  type OrderStatus,
  type ResolvedDeliveryCost,
  type TenantSettingRow,
} from "@avably/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { AuthError } from "@/lib/auth";
import { assertClosableOrder } from "@/lib/closing";
import { hasCustomFieldErrors } from "@/lib/custom-fields";
import { readCustomFieldsForCreate } from "@/lib/custom-fields-server";
import {
  bulkStatusChangeFromFormData,
  bulkStatusChangeSchema,
  orderFormSchema,
  statusChangeFromFormData,
  statusChangeSchema,
  uuidSchema,
} from "@/lib/order-validation";
import {
  rejectReasonFromCode,
  runBulkStatusChange,
  type BulkStatusReport,
  type BulkStatusTarget,
} from "@/lib/orders/bulk-status";
import { panelEmailLogRecorder } from "@/lib/email-log";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { localePath } from "@/lib/navigation";
import { requireMember } from "@/lib/supabase-server";
import { tenantEmailLogo } from "@/lib/tenant-mark";
import { orderCurrencyCode } from "@/lib/tenant-currency";

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
/** `raise ... using errcode = '22023'` — odmowy walidacyjne funkcji app.*. */
const PG_INVALID_INPUT = "22023";

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
    // R3 — forma płatności, cena dostawy i cel dostarczenia (ADR-089).
    paymentMethod: str(formData.get("paymentMethod")),
    deliveryPriceSource: str(formData.get("deliveryPriceSource")),
    deliveryPrice: str(formData.get("deliveryPrice")),
    deliveryPointProvider: str(formData.get("deliveryPointProvider")),
    deliveryPointCode: str(formData.get("deliveryPointCode")),
    deliveryPointAddress: str(formData.get("deliveryPointAddress")),
    deliveryAddressSource: str(formData.get("deliveryAddressSource")),
    deliveryAddressName: str(formData.get("deliveryAddressName")),
    deliveryAddressStreet: str(formData.get("deliveryAddressStreet")),
    deliveryAddressZip: str(formData.get("deliveryAddressZip")),
    deliveryAddressCity: str(formData.get("deliveryAddressCity")),
    deliveryAddressPhone: str(formData.get("deliveryAddressPhone")),
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

  // Pola własne sprawdzamy PRZED pierwszym zapisem — czyli przed założeniem
  // klienta i przed `app.create_order`. Zła wartość ma odbić się o formularz,
  // a nie zostawić po sobie klienta i zamówienie do posprzątania.
  const custom = await readCustomFieldsForCreate(ctx.supabase, ctx.tenantId!, "order", formData);
  if (hasCustomFieldErrors(custom)) {
    return { fieldErrors: custom.fieldErrors, ...(custom.formError ? { formError: custom.formError } : {}) };
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
            newCustomerEmail: "Klient z tym adresem e-mail już istnieje - wybierz go z listy.",
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
    return { formError: "Któryś z produktów nie istnieje albo został wygaszony - odśwież stronę." };
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

  // Koszt dostawy WYŁĄCZNIE silnikiem (ADR-030) na autorytatywnym cenniku
  // tenanta — jak wycena najmu, nie na danych z przeglądarki. Metoda płatna
  // bez cennika rzuca (zero cichych zer): odmawiamy tworzenia zamówienia z
  // czytelnym, zlokalizowanym powodem, zamiast rozdawać darmową dostawę.
  const { data: deliveryRows, error: deliveryError } = await ctx.supabase
    .from("tenant_settings")
    .select("key, value")
    .eq("tenant_id", ctx.tenantId)
    .eq("key", DELIVERY_PRICING_KEY);
  if (deliveryError) return { formError: deliveryError.message };

  let delivery: ResolvedDeliveryCost;
  try {
    delivery = resolveDeliveryCost({
      method: input.deliveryMethod,
      pricing: deliveryPricingFromSettings((deliveryRows ?? []) as TenantSettingRow[]),
      rentalTotalGrosze: pricing.totalRentalGrosze,
      // Cena USTALONA RĘCZNIE wygrywa z cennikiem i cennika nie potrzebuje —
      // to odpowiedź na sytuację, w której cennik odpowiedzi nie ma (R3).
      overrideGrosze: input.deliveryPriceOverrideGrosze,
    });
  } catch (err) {
    if (err instanceof DeliveryPricingError) {
      const t = await getTranslations("orders.form");
      return { formError: t("deliveryPricingMissing") };
    }
    if (err instanceof DeliveryPriceOverrideError) {
      return { fieldErrors: { deliveryPrice: err.message } };
    }
    throw err;
  }

  // Cel dostarczenia rozłożony na kolumny 0044 przez silnik — akcja nie zna
  // wariantów celu z palca, zna JEDNĄ funkcję, która je rozkłada.
  const destination = destinationColumns(input.destination);

  // Atomowo: zamówienie + pozycje + koszt dostawy w jednej transakcji
  // (app.create_order, SECURITY INVOKER — RLS i bramki 0010 obowiązują
  // wewnątrz; p_delivery_grosze od 0016).
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
      p_delivery_grosze: delivery.grosze,
      p_delivery_price_source: delivery.source,
      p_payment_method: input.paymentMethod,
      p_delivery_point_provider: destination.deliveryPointProvider,
      p_delivery_point_code: destination.deliveryPointCode,
      p_delivery_point_address: destination.deliveryPointAddress,
      p_delivery_address_source: destination.deliveryAddressSource,
      p_delivery_address_name: destination.deliveryAddressName,
      p_delivery_address_street: destination.deliveryAddressStreet,
      p_delivery_address_zip: destination.deliveryAddressZip,
      p_delivery_address_city: destination.deliveryAddressCity,
      p_delivery_address_phone: destination.deliveryAddressPhone,
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
          "Wybrany termin został właśnie zajęty przez inne zamówienie - odśwież kalendarz i spróbuj ponownie.",
      };
    }
    // Bramka płatności online (0044): tenant bez konta rozliczeniowego nie ma
    // dokąd przyjąć środków. Ekran zna ten stan i wygasza wybór ZANIM
    // formularz wyjedzie — ta gałąź łapie wyścig (konto zniknęło w trakcie)
    // i nazywa go przy właściwym polu, zamiast zrzucać surowy komunikat bazy.
    if (createError.code === PG_INVALID_INPUT && /rozliczeniowego/.test(createError.message)) {
      return { fieldErrors: { paymentMethod: createError.message } };
    }
    return { formError: createError.message };
  }

  const createdOrderId = orderId as string;

  // Pola własne dopisujemy OSOBNYM zapisem, po utworzeniu zamówienia.
  //
  // DLACZEGO NIE ATOMOWO: `app.create_order` przyjmuje dziś 21 argumentów
  // i dołożenie dwudziestego drugiego znaczyłoby migrację zmieniającą sygnaturę
  // funkcji, którą D1 (godzinówki) i tak przepisze. Kolejność zadań mówi wprost,
  // żeby nie przepisywać tej funkcji trzy razy w kwartał.
  //
  // CZYM PŁACIMY: zapis nie jest częścią transakcji tworzącej zamówienie.
  // Wartości są już sprawdzone rdzeniem (wyżej), więc realną przyczyną
  // niepowodzenia jest awaria łącza — i wtedy zamówienie ISTNIEJE, a pola są
  // puste. Tego nie wolno przemilczeć ani zamienić w błąd formularza (operator
  // ponowiłby wysyłkę i założył zamówienie DRUGI RAZ), więc idziemy na kartę
  // zamówienia z jawnym ostrzeżeniem — tam pola dają się uzupełnić jednym
  // zapisem, bez zakładania czegokolwiek na nowo.
  let customFieldsSaved = true;
  if (Object.keys(custom.values).length > 0) {
    const { data: written, error: customError } = await ctx.supabase
      .from("orders")
      .update({ custom_fields: custom.values })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", createdOrderId)
      .select("id");
    customFieldsSaved = !customError && (written?.length ?? 0) > 0;
  }

  revalidatePath("/", "layout");
  redirect(
    await localePath(
      `/zamowienia/${createdOrderId}${customFieldsSaved ? "" : "?polaWlasne=niezapisane"}`,
    ),
  );
}

export async function changeOrderStatusAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = statusChangeSchema.safeParse(statusChangeFromFormData(formData));
  if (!parsed.success) return zodErrorToState(parsed.error);
  const { orderId, to, expectedFrom } = parsed.data;

  // Opt-in okna domykania (ADR-138): wydanie/zwrot to sedno trybu — ale
  // WYŁĄCZNIE do przodu i wyłącznie na zamrożonym zbiorze (predykaty niżej).
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, orderId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Wygoda UI: czytelna odmowa bez rundy do bazy. Bramką jest trigger 0010.
  if (!canTransition(expectedFrom as OrderStatus, to as OrderStatus)) {
    return { formError: "To przejście statusu nie jest dozwolone." };
  }

  // FORWARD-ONLY w oknie domykania (Zasada 8): cofnięcia, `pending→reserved`
  // i anulowanie ZABLOKOWANE predykatem na argumencie — mapa zdolności
  // (canTransition) zostaje nietknięta dla normalnej pracy.
  if (ctx.closing && !isClosingForwardTransition(expectedFrom as OrderStatus, to as OrderStatus)) {
    return {
      formError:
        "W oknie domykania statusy idą wyłącznie do przodu (wydanie i zwrot) - cofnięcia i anulowanie są niedostępne.",
    };
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
          "Nie można anulować zamówienia z nierozliczoną płatnością - najpierw zarejestruj zwrot.",
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
      formError: "Status zamówienia został w międzyczasie zmieniony - odśwież stronę.",
    };
  }

  // WYSYŁKI TU NIE MA — i to jest zmiana z N3/ADR-075, nie przeoczenie.
  // Tranzycja i powiadomienie klienta są od teraz DWOMA krokami: ten kończy
  // się na utrwalonym statusie, a wiadomość wysyła osobna, jawnie wołana
  // `sendTransitionEmailAction` — dopiero po 10-sekundowym oknie na
  // cofnięcie. Dzięki temu „anuluj" znaczy, że mail NIE POSZEDŁ, a nie że
  // ekran udaje cofnięcie czegoś, co już wyleciało (ADR-033 domknięte).
  revalidatePath("/", "layout");
  return { success: "changed" };
}

/**
 * Wynik odroczonej wysyłki powiadomienia o zmianie statusu (N3, ADR-075).
 *
 * Jedno pole, bo jedno pytanie: „czy klient dostał wiadomość". Brak
 * `problem` = poszła. Każdy inny wynik NIESIE POWÓD — także ten, w którym
 * wiadomość wyszła, ale nie udało się jej zapisać w historii (ADR-045).
 */
export interface TransitionEmailState {
  problem?: string;
}

/** Lustro ORDER_STATUSES — wejście akcji waliduje się jak każde inne. */
const transitionEmailSchema = z.object({
  orderId: uuidSchema,
  status: z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]),
});

/**
 * Wysyłka powiadomienia o zmianie statusu — OSOBNA, EKSPORTOWANA akcja
 * (N3, ADR-075). Woła ją klient po upływie okna na cofnięcie; do tego czasu
 * NIC nie leci ani do dostawcy, ani do `email_logs`.
 *
 * ============== DLACZEGO STATUS JEST SPRAWDZANY PONOWNIE ==============
 *
 * Wydzielenie wysyłki z tranzycji czyni z niej powierzchnię wołaną WPROST
 * z przeglądarki: gdyby brała status z argumentu na słowo, członek tenanta
 * mógłby wysłać klientowi „sprzęt wydany" do zamówienia, które stoi w
 * `pending` — i to bez jednego kłamstwa po stronie bazy. Dlatego status
 * z żądania musi zgadzać się z AUTORYTATYWNYM odczytem `orders.order_status`;
 * rozjazd (ktoś zdążył zmienić status w oknie odliczania) kończy się odmową
 * z powodem, nie wiadomością o nieprawdziwym stanie.
 *
 * Reszta pozostaje jak była: logika (bramki konfiguracji, uczciwa częściowa
 * porażka) siedzi w `sendRentalEmailForTransition` i jest testowana bez
 * Supabase, a treść trafia do historii WYŁĄCZNIE przez `sendAndLog`.
 */
export async function sendTransitionEmailAction(input: {
  orderId: string;
  status: OrderStatus;
}): Promise<TransitionEmailState> {
  const parsed = transitionEmailSchema.safeParse(input);
  if (!parsed.success) return { problem: "Nieprawidłowe dane wysyłki wiadomości." };
  const { orderId, status } = parsed.data;

  // Opt-in okna domykania (ADR-138): mail o zmianie statusu jedzie razem
  // z wydaniem/zwrotem — klient najemcy ma dostać powiadomienie jak przy
  // niezawieszonym najemcy (Zasada 3). Zbiór pilnowany predykatem.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, orderId);
  } catch (err) {
    if (err instanceof AuthError) return { problem: err.message };
    throw err;
  }

  // Zapytania są niezależne — jedna runda, nie cztery po kolei.
  // Waluta z WIERSZA ZAMÓWIENIA (orders.currency, 0049/ADR-103) — mail
  // o zamówieniu formatuje kwoty walutą, w której ono POWSTAŁO.
  const [orderResult, settingsResult, tenantResult] = await Promise.all([
    ctx.supabase
      .from("orders")
      .select(
        "order_status, order_number, start_date, end_date, total_rental_grosze, currency, customers(full_name, email, locale), pickup_locations(name)",
      )
      .eq("tenant_id", ctx.tenantId)
      .eq("id", orderId)
      .maybeSingle(),
    ctx.supabase
      .from("tenant_settings")
      .select("key, value")
      .eq("tenant_id", ctx.tenantId)
      .eq("key", EMAIL_SENDER_KEY),
    // Kolumna OPUBLIKOWANA, nigdy szkic: wiadomość wychodzi na zewnątrz (ADR-175).
    ctx.supabase.from("tenants").select("name, locale, logo_published").eq("id", ctx.tenantId).maybeSingle(),
  ]);

  const order = orderResult.data as (RentalEmailOrderRow & { order_status: OrderStatus }) | null;
  const tenant = tenantResult.data as
    | { name: string; locale: string | null; logo_published?: unknown }
    | null;
  if (!order || !tenant) {
    return {
      problem:
        "Nie udało się odczytać danych do wiadomości - klient nie dostał powiadomienia.",
    };
  }
  if (order.order_status !== status) {
    return {
      problem:
        "Status zamówienia zmienił się w międzyczasie - wiadomość NIE została wysłana, żeby nie opisywała nieaktualnego stanu.",
    };
  }

  // Znak z WIERSZA tego najemcy — nie z sesji i nie z nagłówka (ADR-175).
  const tenantLogo = tenantEmailLogo(tenant);

  const problem = await sendRentalEmailForTransition({
    status,
    order,
    orderId,
    tenantName: tenant.name,
    ...(tenantLogo ? { tenantLogo } : {}),
    // tenants.locale jest not null (0005), ale nieznana wartość nie może
    // wywrócić wysyłki — spada na domyślne locale tenanta.
    locale: isLocale(tenant.locale ?? "") ? (tenant.locale as Locale) : DEFAULT_TENANT_LOCALE,
    currency: orderCurrencyCode(order.currency),
    settings: (settingsResult.data ?? []) as TenantSettingRow[],
    availability: emailAvailability(),
    transport: resendTransport(),
    // Log idzie sesją członka (RLS tenant_insert, 0021) — ta sama bramka co
    // przy tranzycji. `!` jak wyżej: requireMember rzuca bez tenanta.
    recorder: panelEmailLogRecorder(ctx.supabase, ctx.tenantId!),
  });

  // Historia komunikacji zamówienia ma pokazać nowy wpis bez ręcznego
  // odświeżenia — wysyłka jest dla tego ekranu zdarzeniem, nie tłem.
  revalidatePath("/", "layout");
  return problem ? { problem } : {};
}

/**
 * Stan masowej zmiany statusu: albo błąd całej operacji (walidacja, brak
 * uprawnień, nieudany odczyt), albo RAPORT — nigdy zbiorcze „gotowe".
 */
export interface BulkStatusState {
  formError?: string;
  report?: BulkStatusReport;
}

/**
 * Masowa zmiana statusu zaznaczonych zamówień (uwaga przeglądu U4).
 *
 * OSOBNA AKCJA, nie parametr do changeOrderStatusAction: tamta obsługuje
 * JEDNO zamówienie i zwraca FormState, ta zwraca raport per zamówienie.
 * Sygnatura pojedynczej zostaje nietknięta — używa jej ekran szczegółu
 * (status-select).
 *
 * Wysyłki wiadomości do klientów NIE robi (świadomie): masowa zmiana dziesięciu
 * statusów wysłałaby dziesięć maili bez możliwości przejrzenia treści, a
 * decyzja „wyślij" jest w tym produkcie zawsze jawna (ADR-033). Interfejs mówi
 * to wprost, zamiast po cichu nie wysyłać. Od N3/ADR-075 ta zasada obowiązuje
 * po OBU stronach: także zmiana pojedynczego statusu nie wysyła sama z siebie
 * — wysyłkę zleca osobna `sendTransitionEmailAction`, po jawnej decyzji
 * operatora i po oknie na cofnięcie.
 *
 * Odmowy przychodzą Z BAZY (trigger 0010) — akcja nie odsiewa nielegalnych
 * przejść przed wysłaniem żądania, patrz `lib/orders/bulk-status.ts`.
 */
export async function changeOrderStatusBulkAction(
  _prevState: BulkStatusState,
  formData: FormData,
): Promise<BulkStatusState> {
  const parsed = bulkStatusChangeSchema.safeParse(bulkStatusChangeFromFormData(formData));
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Nieprawidłowe zaznaczenie." };
  }
  const { orderIds, to } = parsed.data;

  // Opt-in okna domykania (ADR-138): wersja zbiorcza wydania/zwrotu jest
  // na allowliście, ale KAŻDE zamówienie przechodzi te same predykaty co
  // pojedyncze (forward-only + zamrożony zbiór) — odmowy per wiersz w
  // raporcie, nie jedną blokadą całości.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Stany bieżące jednym odczytem: raport ma nazywać zamówienia numerem, a
  // przejście liczyć od stanu FAKTYCZNEGO. Czego RLS nie pokaże, tego nie ma
  // w mapie — takie id trafia do raportu jako „nie znaleziono", a nie znika.
  const { data: rows, error: readError } = await ctx.supabase
    .from("orders")
    .select("id, order_number, order_status")
    .eq("tenant_id", ctx.tenantId)
    .in("id", orderIds);
  if (readError) return { formError: readError.message };

  const byId = new Map(
    ((rows ?? []) as { id: string; order_number: string; order_status: OrderStatus }[]).map(
      (row) => [row.id, row],
    ),
  );

  const targets: BulkStatusTarget[] = orderIds.map((orderId) => {
    const row = byId.get(orderId);
    return {
      orderId,
      // Brak wiersza = brak numeru; identyfikator jest jedyną nazwą, jaką
      // mamy — lepsza niż puste miejsce w raporcie.
      orderNumber: row?.order_number ?? orderId,
      from: row?.order_status ?? null,
    };
  });

  const report = await runBulkStatusChange(targets, to as OrderStatus, async (target) => {
    // Predykaty okna domykania PRZED mutacją (te same, co w akcji
    // pojedynczej): forward-only na parze (from, to) i zamrożony zbiór na
    // argumencie. Odmowa jest wierszem raportu — operator widzi, KTÓRE
    // zamówienia okno odrzuciło i dlaczego.
    if (ctx.closing) {
      if (!target.from || !isClosingForwardTransition(target.from, to as OrderStatus)) {
        return { ok: false, reason: "closing-window" };
      }
      try {
        await assertClosableOrder(ctx, target.orderId);
      } catch (err) {
        if (err instanceof AuthError) return { ok: false, reason: "closing-window" };
        throw err;
      }
    }
    // Ten sam UPDATE co w akcji pojedynczej, łącznie z optymistyczną
    // współbieżnością (`.eq("order_status", from)`): zero wierszy znaczy, że
    // ktoś zdążył zmienić status — to odmowa, nie cichy sukces.
    const { data, error } = await ctx.supabase
      .from("orders")
      .update({ order_status: to })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", target.orderId)
      .eq("order_status", target.from)
      .select("id");
    if (error) {
      return { ok: false, reason: rejectReasonFromCode(error.code), detail: error.message };
    }
    if (!data || data.length === 0) return { ok: false, reason: "changed-meanwhile" };
    return { ok: true };
  });

  // Odświeżamy WYŁĄCZNIE, gdy coś naprawdę wpadło — pełna odmowa nie ma czego
  // przeładowywać, a przeładowanie skasowałoby raport z ekranu.
  if (report.changed.length > 0) revalidatePath("/", "layout");

  return { report };
}

