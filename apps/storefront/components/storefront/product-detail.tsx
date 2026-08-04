"use client";

/**
 * Podstrona produktu (2.4b): galeria + opis + wybór terminu z podglądem
 * dostępności (getPublicAvailability przez server action — WYŁĄCZNIE liczby,
 * bez cudzych rezerwacji) + dodanie do koszyka.
 *
 * Termin jest WSPÓLNY dla całego zamówienia (MVP, jak model orders): dodanie
 * produktu ustawia zakres dat koszyka na wybrany tu termin. Podgląd ceny liczy
 * calculatePrice (@avably/core) — to SZACUNEK; wiążącą kwotę policzy serwer przy
 * składaniu zamówienia (ADR-042).
 *
 * WYGLĄD Z MOTYWU NAJEMCY (K6, ADR-092): podstrona nosi role, nie kolory.
 * Pola i przyciski są ZWYKŁYMI elementami HTML, nie komponentami `@avably/ui` —
 * tamte wnoszą własne tokeny panelu, których skan źródeł tego pliku nie widzi,
 * więc gwarancja „bez palety panelu" byłaby pozorna.
 */
import { calculatePrice, formatMoney, type CurrencyCode } from "@avably/core";
import Link from "next/link";
import { useMemo, useState } from "react";

import { checkAvailability } from "@/lib/actions/availability";
import { SITE_HEADING } from "@/components/storefront/store-chrome";
import { MAX_QUANTITY_PER_PRODUCT } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import type { ProductDetailView } from "@/lib/catalog/present";
import { format, type StorefrontCopy } from "@/lib/storefront/copy";

type AvailabilityState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; available: number; total: number }
  | { kind: "error" };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ProductDetail({
  product,
  copy,
  locale,
  currency,
}: {
  product: ProductDetailView;
  copy: StorefrontCopy;
  locale: string;
  currency: CurrencyCode;
}) {
  const { cart, setDates, add } = useCart();
  const [activeImage, setActiveImage] = useState(0);
  // null = pole nietknięte → pokazujemy termin z koszyka (wspólny dla całego
  // zamówienia). Koszyk jest znany dopiero po hydratacji (useCart), więc prefill
  // z niego wchodzi bez setState-w-efekcie: wartość jest WYLICZANA, nie kopiowana.
  const [startInput, setStartInput] = useState<string | null>(null);
  const [endInput, setEndInput] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityState>({ kind: "idle" });
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const start = startInput ?? cart.startDate ?? "";
  const end = endInput ?? cart.endDate ?? "";

  const rangeValid = start !== "" && end !== "" && end >= start;
  const rangeInverted = start !== "" && end !== "" && end < start;

  // Podgląd ceny (szacunek) — najem + kaucja za sztukę × ilość.
  const preview = useMemo(() => {
    if (!rangeValid) return null;
    const price = calculatePrice(start, end, product.priceParams);
    return {
      rental: price.rentalGrosze * quantity,
      deposit: price.depositGrosze * quantity,
    };
  }, [rangeValid, start, end, product.priceParams, quantity]);

  function resetOnDateChange(next: { start?: string; end?: string }) {
    if (next.start !== undefined) setStartInput(next.start);
    if (next.end !== undefined) setEndInput(next.end);
    setAvailability({ kind: "idle" });
    setAdded(false);
  }

  async function onCheck() {
    if (!rangeValid) return;
    setAvailability({ kind: "loading" });
    try {
      const result = await checkAvailability(product.id, start, end);
      if (!result) {
        setAvailability({ kind: "error" });
        return;
      }
      setAvailability({ kind: "ok", available: result.available_units, total: result.total_units });
      setQuantity((q) => Math.min(Math.max(1, q), Math.max(1, result.available_units)));
    } catch {
      setAvailability({ kind: "error" });
    }
  }

  const maxQty =
    availability.kind === "ok"
      ? Math.min(availability.available, MAX_QUANTITY_PER_PRODUCT)
      : MAX_QUANTITY_PER_PRODUCT;
  const canAdd = rangeValid && availability.kind === "ok" && availability.available > 0 && quantity >= 1;

  function onAdd() {
    if (!canAdd) return;
    setDates(start, end);
    add(product.id, quantity);
    setAdded(true);
  }

  return (
    <div className="grid gap-10 md:grid-cols-2">
      {/* Galeria */}
      <div className="flex flex-col gap-4">
        {product.images.length > 0 ? (
          <>
            {/* Zdjęcia z publicznego Storage — zwykły <img> jak sekcja products
                w @avably/ui; next/image nie wnosi tu wartości. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.images[activeImage]!.url}
              alt={product.images[activeImage]!.alt}
              className="site-media aspect-[4/3] w-full object-cover"
            />
            {product.images.length > 1 ? (
              <ul className="flex list-none flex-wrap gap-2 p-0">
                {product.images.map((image, index) => (
                  <li key={image.url}>
                    <button
                      type="button"
                      onClick={() => setActiveImage(index)}
                      // Przełącznik zdjęcia w galerii, nie wskazanie pozycji
                      // nawigacji — stąd aria-pressed zamiast aria-current.
                      aria-pressed={index === activeImage}
                      // Zaznaczenie miniatury idzie AKCENTEM motywu, a nie
                      // kolorem panelu — obrys jako `outline`, żeby grubość
                      // ramki nie przesuwała sąsiadów przy przełączaniu.
                      className={`site-media block cursor-pointer outline-offset-1 ${
                        index === activeImage
                          ? "outline-2 outline-[color:var(--site-accent)]"
                          : "outline-1 outline-[color:var(--site-border)]"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt={image.alt} className="h-16 w-16 object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <div className="site-placeholder aspect-[4/3] w-full" aria-hidden="true" />
        )}
      </div>

      {/* Treść + akcja */}
      <div className="flex flex-col gap-5">
        <div>
          <h1 className={`text-3xl tracking-tight ${SITE_HEADING}`}>{product.name}</h1>
          <p className="site-text-muted mt-2 text-lg">{product.basePriceLabel}</p>
          <p className="site-text-muted text-sm">
            {copy.product.depositLabel}: {product.depositFormatted}
          </p>
        </div>

        {product.description ? (
          <div>
            <h2 className="site-text-muted text-sm font-semibold uppercase tracking-wide">
              {copy.product.descriptionHeading}
            </h2>
            <p className="mt-1 whitespace-pre-line leading-7">{product.description}</p>
          </div>
        ) : null}

        <div className="site-card p-4">
          <p className="font-medium">{copy.product.chooseDates}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <label htmlFor="rent-start" className="site-label text-sm">
                {copy.product.startDate}
              </label>
              <input
                id="rent-start"
                type="date"
                className="site-field h-9 w-full px-3 text-sm"
                min={todayIso()}
                value={start}
                onChange={(event) => resetOnDateChange({ start: event.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="rent-end" className="site-label text-sm">
                {copy.product.endDate}
              </label>
              <input
                id="rent-end"
                type="date"
                className="site-field h-9 w-full px-3 text-sm"
                min={start || todayIso()}
                value={end}
                onChange={(event) => resetOnDateChange({ end: event.target.value })}
              />
            </div>
          </div>

          {rangeInverted ? (
            <p className="site-error mt-2 text-sm">{copy.product.dateRangeInvalid}</p>
          ) : null}

          <button
            type="button"
            className="site-cta-secondary mt-3 cursor-pointer text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!rangeValid || availability.kind === "loading"}
            onClick={onCheck}
          >
            {availability.kind === "loading" ? copy.product.availabilityChecking : copy.product.checkAvailability}
          </button>

          <div className="mt-3 min-h-6 text-sm" role="status" aria-live="polite">
            {availability.kind === "ok" && availability.available > 0 ? (
              <span>
                {format(copy.product.available, {
                  available: availability.available,
                  total: availability.total,
                })}
              </span>
            ) : null}
            {availability.kind === "ok" && availability.available === 0 ? (
              <span className="site-error">{copy.product.unavailable}</span>
            ) : null}
            {availability.kind === "error" ? (
              <span className="site-error">{copy.product.availabilityError}</span>
            ) : null}
          </div>

          {availability.kind === "ok" && availability.available > 0 ? (
            <div className="mt-3 grid gap-3">
              <div className="grid gap-1">
                <label htmlFor="rent-qty" className="site-label text-sm">
                  {copy.product.quantity}
                </label>
                <input
                  id="rent-qty"
                  type="number"
                  min={1}
                  max={maxQty}
                  value={quantity}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    if (Number.isNaN(parsed)) return setQuantity(1);
                    setQuantity(Math.min(Math.max(1, parsed), maxQty));
                  }}
                  className="site-field h-9 w-24 px-3 text-sm"
                />
              </div>
              {preview ? (
                <p className="site-text-muted text-sm">
                  {copy.checkout.summaryRental}: {formatMoney(preview.rental, currency, locale)} ·{" "}
                  {copy.checkout.summaryDeposit}: {formatMoney(preview.deposit, currency, locale)}
                </p>
              ) : null}
              <p className="site-text-muted text-xs">{copy.common.estimateNote}</p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="site-cta cursor-pointer text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canAdd}
            onClick={onAdd}
          >
            {copy.product.addToCart}
          </button>
          {added ? (
            <span className="site-text-muted inline-flex items-center gap-2 text-sm">
              {copy.product.added} ·{" "}
              <Link href="/cart" className="site-link font-medium">
                {copy.product.goToCart}
              </Link>
            </span>
          ) : null}
        </div>

        {!rangeValid ? (
          <p className="site-text-muted text-sm">{copy.product.dateRequired}</p>
        ) : null}
      </div>
    </div>
  );
}
