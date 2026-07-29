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

import { writeExtensionItemRentals } from "./extension-mutation";
import {
  extensionItemRentals,
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
  order_items: { id: string; rental_grosze: number; products: ExtensionProductRow | null }[];
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
      "id, start_date, end_date, order_status, total_rental_grosze, order_items(id, rental_grosze, products(base_price_day_grosze, deposit_grosze, auto_increment_multiplier, pricing_tiers(tier_days, multiplier)))",
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

  // Wycena WYŁĄCZNIE silnikiem, po AKTUALNYM cenniku (ADR-029): dopłata liczy
  // się PER POZYCJA, a suma tych dopłat jest dopłatą całości. Nowy total =
  // zapisany total + suma dopłat pozycji; te SAME liczby trafiają na pozycje
  // (patrz niżej), więc sumy zamówienia i pozycji nie mają jak się rozjechać.
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

  // Absolutne nowe kwoty pozycji (bieżący najem + dopłata silnika tej pozycji).
  // Liczymy PRZED mutacją, żeby ujemny wynik odsiać zanim cokolwiek zmienimy:
  // przy ręcznym rabacie pozycji + zejściu w tańszy próg pojedyncza pozycja
  // mogłaby zejść poniżej zera (CHECK `rental_grosze >= 0` odbiłby to dopiero
  // w połowie zapisu, zostawiając rozjazd sum).
  const { updates: itemRentalUpdates, hasNegative } = extensionItemRentals(
    new Map(order.order_items.map((item) => [item.id, item.rental_grosze])),
    quote.items,
  );
  if (hasNegative) {
    return {
      formError:
        "Przedłużenie obniżyłoby najem którejś pozycji poniżej zera — skoryguj kwoty pozycji ręcznie przed przedłużeniem.",
    };
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

  // Dopłata NA POZYCJE — osobny krok od UPDATE zamówienia (PostgREST nie daje
  // transakcji przez dwa żądania; wzorzec recalcOrderTotals w items-actions.ts).
  // Idzie PO bramkowanym UPDATE terminu: gdyby data kolidowała, bramka 0010
  // odrzuca całość powyżej i pozycji nie ruszamy. Zmiana samego rental_grosze
  // nie przechodzi przez bramkę przypisania (short-circuit w 0010), więc nie
  // wywoła fałszywej kolizji. Nieudany krok = WIDOCZNY rozjazd sum (ostrzeżenie
  // sekcji pozycji), nie cichy — i naprawialny kolejną edycją pozycji.
  const itemsError = await writeExtensionItemRentals(
    ctx.supabase,
    ctx.tenantId!,
    itemRentalUpdates,
  );
  if (itemsError) {
    return {
      formError: `Termin przedłużony, ale kwoty pozycji nie zostały zaktualizowane (${itemsError.error}) — odśwież stronę i sprawdź sumy pozycji.`,
    };
  }

  revalidatePath("/", "layout");
  return { success: "extended" };
}
