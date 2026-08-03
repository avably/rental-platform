"use client";

/**
 * Pozycje zamówienia (R3, pinezka 0007c5a4: „przy większej ilości produktów
 * dodawanie pozycji z dropdownu będzie kiepskie, powinniśmy to zrobić jakoś
 * z searchem i pod przyciskiem").
 *
 * STAN PRZED: każdy wiersz pozycji miał własną listę rozwijaną ze wszystkimi
 * produktami — czyli tyle list, ile pozycji, i za każdym razem to samo
 * przewijanie.
 *
 * PO: pozycje są LISTĄ tego, co już w koszyku, a dodawanie chowa się pod
 * jednym przyciskiem, który rozwija wyszukiwarkę. Wyszukiwarka pracuje nad
 * produktami WCZYTANYMI przez stronę (te same, na których liczy się podgląd
 * dostępności i wyceny) — nie ma tu drugiego źródła prawdy o katalogu.
 *
 * Wiersz pozycji pokazuje DOSTĘPNOŚĆ w wybranym terminie, bo to jedyna
 * informacja, która w tym momencie zmienia decyzję. Braki nazywa po imieniu
 * podgląd wyceny niżej — tu wystarczy liczba.
 */
import { Button, Input } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import type { WizardProduct } from "./wizard-data";

export function ItemPicker({
  products,
  itemProductIds,
  onChange,
  freeUnitsByProduct,
  errorSlot,
}: {
  products: WizardProduct[];
  itemProductIds: string[];
  onChange: (next: string[]) => void;
  /** Wolne egzemplarze w wybranym terminie; `null` = termin jeszcze niewybrany. */
  freeUnitsByProduct: Map<string, number> | null;
  errorSlot: (field: string) => React.ReactNode;
}) {
  const t = useTranslations("orders.form");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const productById = useMemo(
    () => new Map(products.map((product) => [product.pricing.id, product])),
    [products],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return products;
    return products.filter((product) => product.name.toLowerCase().includes(needle));
  }, [products, query]);

  const addProduct = (productId: string) => {
    onChange([...itemProductIds, productId]);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {itemProductIds.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("itemsEmpty")}</p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-lg border" data-order-items>
          {itemProductIds.map((productId, index) => {
            const product = productById.get(productId);
            const free = freeUnitsByProduct?.get(productId);
            return (
              // Indeks w kluczu jest tu poprawny: wiersze nie zmieniają
              // kolejności (dodawanie na koniec, usuwanie po indeksie).
              <li key={`${index}-${productId}`} className="flex items-center justify-between gap-4 px-3 py-2">
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="font-medium">{product?.name ?? productId}</span>
                  <span className="text-muted-foreground text-xs">
                    {freeUnitsByProduct === null
                      ? t("itemAvailabilityUnknown")
                      : t("itemAvailability", { count: free ?? 0 })}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onChange(itemProductIds.filter((_, position) => position !== index))}
                >
                  {t("removeItem")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <div className="border-border flex flex-col gap-2 rounded-lg border p-3">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("itemSearchPlaceholder")}
            aria-label={t("itemSearchPlaceholder")}
            autoComplete="off"
            autoFocus
            data-item-search
          />
          {matches.length === 0 ? (
            <p className="text-muted-foreground text-sm" role="status">
              {t("itemNoMatch", { query: query.trim() })}
            </p>
          ) : (
            <ul className="divide-border max-h-72 divide-y overflow-auto" data-item-results>
              {matches.map((product) => {
                const free = freeUnitsByProduct?.get(product.pricing.id);
                return (
                  <li key={product.pricing.id}>
                    <button
                      type="button"
                      onClick={() => addProduct(product.pricing.id)}
                      className="hover:bg-secondary focus-visible:outline-accent dark:focus-visible:outline-ring flex w-full flex-col items-start gap-0.5 px-2 py-2 text-left text-sm outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:-outline-offset-2"
                    >
                      <span className="font-medium">{product.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {freeUnitsByProduct === null
                          ? t("itemAvailabilityUnknown")
                          : t("itemAvailability", { count: free ?? 0 })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("cancelAddItem")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" variant="outline" onClick={() => setOpen(true)} data-add-item>
            {t("addItem")}
          </Button>
        </div>
      )}

      {/* Koszyk jedzie jednym polem JSON — kontrakt wysyłki bez zmian od P4:
          pozycja niesie WYŁĄCZNIE productId, kwoty liczy serwer (ADR-024). */}
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(itemProductIds.map((id) => ({ productId: id })))}
      />
      {errorSlot("items")}
    </div>
  );
}
