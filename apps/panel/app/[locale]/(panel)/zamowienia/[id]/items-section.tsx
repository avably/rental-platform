import { AVAILABILITY_BLOCKING_ORDER_STATUSES, type IsoDate, type OrderStatus } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { requireMember } from "@/lib/supabase-server";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { availabilityForRange, proposeItemAmounts, type ProductPricingRow } from "../pricing";
import { depositTotals, type DepositEventRow } from "./deposit";
import {
  addOrderItemAction,
  removeOrderItemAction,
  updateOrderItemAction,
} from "./items-actions";
import { ItemsEditor, type EditorItem, type EditorProduct } from "./items-editor";
import { canEditOrderItems } from "./items-validation";

/**
 * Sekcja POZYCJI zamówienia (uwagi przeglądu D6/N4) — osobny RSC z WŁASNYM
 * odczytem, tak jak `ExtensionSection` i `DeliverySection`: `page.tsx` dokłada
 * jedną linię, a cała wiedza o pozycjach mieszka tutaj (protokół antykolizyjny
 * z równoległymi zadaniami na tym ekranie).
 *
 * ============== DLACZEGO „NIEDOSTĘPNE" LICZYMY, A NIE ZAPISUJEMY ==============
 *
 * Uwaga N4 chce, żeby pozycja dodana mimo braku wolnej sztuki była JAWNIE
 * oznaczona. Kuszące jest dołożenie do schematu znacznika „dodane mimo
 * niedostępności" — i byłby to błąd, nie tylko koszt migracji: taki znacznik
 * utrwala stan z CHWILI ZAPISU, a dostępność zmienia się co godzinę (ktoś
 * odwoła sąsiednie zamówienie, ktoś skróci najem). Po tygodniu wiersz krzyczy
 * „niedostępne", choć na magazynie stoją trzy wolne sztuki.
 *
 * Dlatego oznaczenie liczy się NA ŻYWO, tym samym silnikiem, co reszta
 * dostępności: pozycja bez `unit_id` dostaje powód „brak wolnego egzemplarza
 * w tym terminie" tylko wtedy, gdy w tej chwili faktycznie nie ma czego
 * przypisać — a gdy sztuka się zwolniła, ta sama pozycja mówi operatorowi, ile
 * sztuk czeka na przypisanie. Zero migracji i mniej kłamstwa niż przy kolumnie.
 *
 * ============== WYKLUCZENIE WŁASNEJ POZYCJI ==============
 *
 * Pula wolnych sztuk dla WIERSZA liczy się z wykluczeniem rezerwacji tej
 * właśnie pozycji — dokładnie tak, jak robi to `app.assert_unit_available`
 * przez `p_exclude_item_id` (0010). Bez tego egzemplarz już przypisany do
 * pozycji wychodziłby w jej własnym wyborze jako „zajęty", a operator miałby
 * podgląd sprzeczny z bazą. Pula dla DODAWANIA nie wyklucza nic — nowa pozycja
 * nie ma jeszcze żadnej rezerwacji, a sztuka zajęta przez inną pozycję tego
 * samego zamówienia jest zajęta naprawdę (ta sama sztuka nie jedzie dwa razy).
 */

interface ItemRow {
  id: string;
  product_id: string;
  unit_id: string | null;
  rental_grosze: number;
  deposit_grosze: number;
  products: { name: string } | null;
  product_units: { serial_number: string | null } | null;
}

interface ProductRow extends ProductPricingRow {
  name: string;
  product_units: { id: string; serial_number: string | null; unavailable_from: string | null; unavailable_to: string | null }[];
}

interface BookedRow {
  id: string;
  unit_id: string;
  orders: { start_date: string; end_date: string };
}

export async function ItemsSection({
  order,
}: {
  order: {
    id: string;
    startDate: string;
    endDate: string;
    status: OrderStatus;
    /** Sumy z kolumn zamówienia — to ICH używa faktura, e-mail i lista. */
    totalRentalGrosze: number;
    totalDepositGrosze: number;
  };
}) {
  const ctx = await requireMember();

  const [{ data: itemRows }, { data: productRows }, { data: bookedRows }, { data: depositRows }] =
    await Promise.all([
      ctx.supabase
        .from("order_items")
        .select(
          "id, product_id, unit_id, rental_grosze, deposit_grosze, products(name), product_units(serial_number)",
        )
        .eq("tenant_id", ctx.tenantId)
        .eq("order_id", order.id)
        .order("created_at", { ascending: true }),
      ctx.supabase
        .from("products")
        .select(
          "id, name, base_price_day_grosze, deposit_grosze, auto_increment_multiplier, buffer_before_days, buffer_after_days, pricing_tiers(tier_days, multiplier), product_units(id, serial_number, unavailable_from, unavailable_to)",
        )
        .eq("tenant_id", ctx.tenantId)
        .eq("active", true)
        .order("name")
        .order("created_at", { referencedTable: "product_units", ascending: true }),
      // Zajęte terminy — `id` pozycji jest tu potrzebne, żeby móc wykluczyć
      // rezerwację EDYTOWANEGO wiersza (lustro p_exclude_item_id z 0010).
      ctx.supabase
        .from("order_items")
        .select("id, unit_id, orders!inner(start_date, end_date, order_status)")
        .eq("tenant_id", ctx.tenantId)
        .not("unit_id", "is", null)
        .in("orders.order_status", [...AVAILABILITY_BLOCKING_ORDER_STATUSES]),
      // Rejestr kaucji — WYŁĄCZNIE do odczytu, żeby powiedzieć operatorowi,
      // że zmiana kwoty zamierzonej nie jest zwrotem. Ta sekcja nie zapisuje
      // do niego ani jednego wiersza (ADR-069/070/072).
      ctx.supabase
        .from("deposit_events")
        .select("kind, amount_grosze")
        .eq("tenant_id", ctx.tenantId)
        .eq("order_id", order.id),
    ]);

  const items = (itemRows ?? []) as unknown as ItemRow[];
  const products = (productRows ?? []) as unknown as ProductRow[];
  const booked = (bookedRows ?? []) as unknown as BookedRow[];
  const collectedGrosze = depositTotals(
    (depositRows ?? []) as unknown as DepositEventRow[],
  ).collectedGrosze;

  const start = order.startDate as IsoDate;
  const end = order.endDate as IsoDate;

  /** Wolne sztuki produktu w terminie zamówienia, z opcjonalnym wykluczeniem pozycji. */
  function freeUnitIds(product: ProductRow, excludeItemId?: string): Set<string> {
    const units = product.product_units.map((unit) => ({
      unitId: unit.id,
      unavailableFrom: unit.unavailable_from,
      unavailableTo: unit.unavailable_to,
    }));
    const unitIds = new Set(units.map((unit) => unit.unitId));
    const ranges = booked
      .filter((row) => unitIds.has(row.unit_id) && row.id !== excludeItemId)
      .map((row) => ({
        unitId: row.unit_id,
        startDate: row.orders.start_date,
        endDate: row.orders.end_date,
      }));

    return new Set(
      availabilityForRange(units, ranges, start, end, {
        bufferBeforeDays: product.buffer_before_days,
        bufferAfterDays: product.buffer_after_days,
      }).availableUnitIds,
    );
  }

  const productById = new Map(products.map((product) => [product.id, product]));

  const editorProducts: EditorProduct[] = products.map((product) => {
    // Pula wolnych sztuk dla DODAWANIA nie wyklucza żadnej pozycji — nowa
    // pozycja nie ma jeszcze rezerwacji (nagłówek). Propozycja kwot liczy się
    // z dat zamówienia tym samym silnikiem, co reszta wyceny.
    const free = freeUnitIds(product);
    const proposal = proposeItemAmounts(product, start, end);
    return {
      id: product.id,
      name: product.name,
      freeUnits: free.size,
      totalUnits: product.product_units.length,
      units: product.product_units.map((unit) => ({
        id: unit.id,
        label: unit.serial_number ?? unit.id.slice(0, 8),
        free: free.has(unit.id),
      })),
      proposedRentalGrosze: proposal.rentalGrosze,
      proposedDepositGrosze: proposal.depositGrosze,
    };
  });

  const editorItems: EditorItem[] = items.map((item) => {
    const product = productById.get(item.product_id);
    // Produkt wygaszony (`active = false`) nie znika z zamówienia, tylko
    // z katalogu — pozycja zostaje bez listy egzemplarzy do wyboru, zamiast
    // wywracać sekcję.
    const free = product ? freeUnitIds(product, item.id) : new Set<string>();

    return {
      id: item.id,
      productName: item.products?.name ?? "—",
      unitId: item.unit_id,
      unitLabel: item.unit_id
        ? (item.product_units?.serial_number ?? item.unit_id.slice(0, 8))
        : null,
      rentalGrosze: item.rental_grosze,
      depositGrosze: item.deposit_grosze,
      freeUnitCount: free.size,
      units: (product?.product_units ?? []).map((unit) => ({
        id: unit.id,
        label: unit.serial_number ?? unit.id.slice(0, 8),
        free: free.has(unit.id),
      })),
    };
  });

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("orders.detail");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("items")}</h2>
      <ItemsEditor
        orderId={order.id}
        orderStatus={order.status}
        editable={canEditOrderItems(order.status)}
        items={editorItems}
        products={editorProducts}
        collectedGrosze={collectedGrosze}
        totalRentalGrosze={order.totalRentalGrosze}
        totalDepositGrosze={order.totalDepositGrosze}
        currency={currency}
        locale={locale}
        actions={{
          add: addOrderItemAction,
          update: updateOrderItemAction,
          remove: removeOrderItemAction,
        }}
      />
    </section>
  );
}
