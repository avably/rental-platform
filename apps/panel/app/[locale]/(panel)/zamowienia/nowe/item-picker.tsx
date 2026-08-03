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
 * ============ CO DOKŁADA R3-1c (uwagi właściciela 3 i 4) ============
 *
 * 1. WIERSZ MÓWI, ILE KOSZTUJE. Do R3-1c cena stała wyłącznie w zbiorczej
 *    wycenie po prawej, więc na pytanie „ile kosztuje ta jedna pozycja"
 *    operator odpowiadał sobie sam, przeliczając w głowie. Kwota przy wierszu
 *    przychodzi GOTOWA z wyceny silnika (`priceOrderItems` w `pricing.ts`) —
 *    ten komponent jej NIE LICZY, tylko formatuje. To jest różnica, która ma
 *    znaczenie: silnik zna progi cenowe i mnożnik automatyczny, a mnożenie
 *    ceny dobowej przez liczbę dni dałoby inną kwotę niż zamówienie, które
 *    zaraz powstanie.
 *
 * 2. WIERSZ DAJE SIĘ EDYTOWAĆ, A NIE TYLKO USUNĄĆ. Jedyna właściwość pozycji,
 *    którą PRZED zapisem da się w tym modelu zmienić, to LICZBA SZTUK —
 *    termin siedzi na zamówieniu (jeden na całe), a egzemplarze przypisuje
 *    serwer pierwszymi wolnymi (ADR-024) i zmienia się je na szczególe
 *    zamówienia, gdzie widać już realne konflikty. Dlatego wiersz dostaje
 *    licznik sztuk, a nie panel edycji na wzór szczegółu: pole, którego ten
 *    ekran nie ma czym wypełnić, byłoby atrapą.
 *
 * Wiersz pokazuje też DOSTĘPNOŚĆ w wybranym terminie — braki nazywa po
 * imieniu podgląd wyceny niżej, tu wystarczy liczba.
 */
import { formatMoney, type CurrencyCode } from "@avably/core";
import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  BASKET_MAX_QUANTITY,
  BASKET_MIN_QUANTITY,
  groupBasketLines,
  parseBasketQuantity,
  removeLine,
  setLineQuantity,
  type BasketLineAmounts,
} from "./basket-lines";
import type { WizardProduct } from "./wizard-data";

/** Kwoty wiersza — albo z silnika, albo (bez terminu) po prostu nieznane. */
function LineAmounts({
  amounts,
  currency,
  locale,
}: {
  amounts: BasketLineAmounts | undefined;
  currency: CurrencyCode;
  locale: string;
}) {
  const t = useTranslations("orders.form");

  // Bez pełnego terminu silnik nie ma czego policzyć. Piszemy to WPROST,
  // zamiast pokazywać „0,00 zł" — zero jest kwotą, a nie brakiem odpowiedzi.
  if (!amounts) {
    return (
      <span className="text-muted-foreground text-xs" data-item-price-unknown>
        {t("itemPriceUnknown")}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-0.5 text-sm" data-item-price>
      <span className="font-medium tabular-nums tracking-[0.01em]">
        {formatMoney(amounts.rentalGrosze, currency, locale)}
      </span>
      {amounts.depositGrosze > 0 ? (
        <span className="text-muted-foreground text-xs tabular-nums tracking-[0.01em]">
          {t("itemDeposit", {
            amount: formatMoney(amounts.depositGrosze, currency, locale),
          })}
        </span>
      ) : null}
    </span>
  );
}

export function ItemPicker({
  products,
  itemProductIds,
  onChange,
  freeUnitsByProduct,
  amountsByProduct,
  currency,
  locale,
  errorSlot,
}: {
  products: WizardProduct[];
  itemProductIds: string[];
  onChange: (next: string[]) => void;
  /** Wolne egzemplarze w wybranym terminie; `null` = termin jeszcze niewybrany. */
  freeUnitsByProduct: Map<string, number> | null;
  /**
   * Kwoty wierszy WYLICZONE PRZEZ SILNIK (suma sztuk produktu); `null` = nie
   * ma jeszcze terminu, więc nie ma czego liczyć. Ten komponent kwot nie
   * wylicza — dostaje je gotowe z tej samej wyceny, która pojedzie na serwer.
   */
  amountsByProduct: Map<string, BasketLineAmounts> | null;
  currency: CurrencyCode;
  locale: string;
  errorSlot: (field: string) => React.ReactNode;
}) {
  const t = useTranslations("orders.form");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const productById = useMemo(
    () => new Map(products.map((product) => [product.pricing.id, product])),
    [products],
  );

  const lines = useMemo(() => groupBasketLines(itemProductIds), [itemProductIds]);

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

  const changeQuantity = (productId: string, quantity: number) => {
    onChange(setLineQuantity(itemProductIds, productId, quantity));
  };

  return (
    <div className="flex flex-col gap-3">
      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("itemsEmpty")}</p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-lg border" data-order-items>
          {lines.map((line) => {
            const product = productById.get(line.productId);
            const free = freeUnitsByProduct?.get(line.productId);
            const amounts = amountsByProduct?.get(line.productId);
            const quantityId = `order-item-quantity-${line.productId}`;
            return (
              <li
                key={line.productId}
                data-order-item={line.productId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-3 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                  <span className="font-medium">{product?.name ?? line.productId}</span>
                  <span className="text-muted-foreground text-xs">
                    {freeUnitsByProduct === null
                      ? t("itemAvailabilityUnknown")
                      : t("itemAvailability", { count: free ?? 0 })}
                  </span>
                </div>

                {/* Licznik sztuk: dwa przyciski i pole. Przyciski robią typową
                    zmianę o jeden bez celowania w pole, pole przyjmuje skok od
                    razu do właściwej liczby. Klamry pilnuje `basket-lines`, nie
                    atrybut `min`/`max` — atrybut jest podpowiedzią przeglądarki,
                    a nie regułą (wklejenie omija go bez śladu). */}
                <div className="flex items-center gap-2" data-item-quantity={line.quantity}>
                  <Label htmlFor={quantityId} className="text-muted-foreground text-xs">
                    {t("itemQuantity")}
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    data-item-quantity-decrease
                    aria-label={t("itemQuantityDecrease", { product: product?.name ?? "" })}
                    disabled={line.quantity <= BASKET_MIN_QUANTITY}
                    onClick={() => changeQuantity(line.productId, line.quantity - 1)}
                  >
                    −
                  </Button>
                  <Input
                    id={quantityId}
                    inputMode="numeric"
                    className="w-14 text-center tabular-nums"
                    value={String(line.quantity)}
                    data-item-quantity-input
                    onChange={(event) => {
                      const next = parseBasketQuantity(event.target.value);
                      // Puste pole w trakcie wpisywania NIE jest zmianą ilości —
                      // inaczej skasowanie zawartości zdejmowałoby sztuki.
                      if (next === null) return;
                      changeQuantity(line.productId, next);
                    }}
                    onBlur={(event) => {
                      // Wyjście z pola domyka edycję: cokolwiek w nim zostało,
                      // wraca do stanu, który koszyk naprawdę ma.
                      event.target.value = String(line.quantity);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    data-item-quantity-increase
                    aria-label={t("itemQuantityIncrease", { product: product?.name ?? "" })}
                    disabled={line.quantity >= BASKET_MAX_QUANTITY}
                    onClick={() => changeQuantity(line.productId, line.quantity + 1)}
                  >
                    +
                  </Button>
                </div>

                <LineAmounts amounts={amounts} currency={currency} locale={locale} />

                <Button
                  type="button"
                  variant="outline"
                  data-item-remove
                  onClick={() => onChange(removeLine(itemProductIds, line.productId))}
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
          pozycja niesie WYŁĄCZNIE productId, kwoty liczy serwer (ADR-024).
          Ilość z wiersza jest tu rozwinięta z powrotem w tyle wpisów, ile
          sztuk — bo pozycja zamówienia to jedna sztuka (patrz basket-lines). */}
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(itemProductIds.map((id) => ({ productId: id })))}
      />
      {errorSlot("items")}
    </div>
  );
}
