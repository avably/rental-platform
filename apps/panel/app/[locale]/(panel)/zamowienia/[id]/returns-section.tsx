import { requireMember } from "@/lib/supabase-server";

import { toggleItemReturnAction } from "./return-actions";
import { ReturnsEditor, type ReturnItemView } from "./returns-editor";

/**
 * Sekcja ZWROTU CZĘŚCIOWEGO (ADR-272) — osobny RSC z WŁASNYM odczytem, wzorem
 * `ItemsSection`/`ExtensionSection`: `page.tsx` dokłada jedną linię. Renderuje
 * się tylko dla zamówienia wydanego (bramkę widoczności trzyma page.tsx, samą
 * regułę „tylko picked_up" egzekwuje RPC). Reużywa istniejących tokenów i
 * komponentu Checkbox — zero nowego kierunku wizualnego.
 */
interface ItemRow {
  id: string;
  returned_at: string | null;
  products: { name: string } | null;
  product_units: { serial_number: string | null } | null;
}

export async function ReturnsSection({ orderId }: { orderId: string }) {
  const ctx = await requireMember();

  const { data: itemRows } = await ctx.supabase
    .from("order_items")
    .select("id, returned_at, products(name), product_units(serial_number)")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  const items: ReturnItemView[] = ((itemRows ?? []) as unknown as ItemRow[]).map((item) => ({
    id: item.id,
    productName: item.products?.name ?? "—",
    serialNumber: item.product_units?.serial_number ?? null,
    returned: item.returned_at !== null,
  }));

  if (items.length === 0) return null;

  return <ReturnsEditor orderId={orderId} items={items} action={toggleItemReturnAction} />;
}
