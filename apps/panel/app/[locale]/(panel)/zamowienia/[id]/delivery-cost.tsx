/**
 * Koszt dostawy na szczególe zamówienia — KWOTA ZAPISANA, nie przeliczona
 * (R3-1b, doklejone do R3-1c).
 *
 * ================== CO BYŁO NIE TAK ==================
 *
 * Sekcja dostawy liczyła koszt `calculateDeliveryCost` na cenniku odczytanym
 * PRZY RENDERZE, a kolumn `orders.delivery_grosze` (0016) i
 * `orders.delivery_price_source` (0044) nie czytała w ogóle. Dawało to dwa
 * błędy naraz, oba ciche:
 *
 *  1. Cena USTALONA RĘCZNIE przy tworzeniu zamówienia była utrwalona
 *     w bazie, na fakturze i w umowie — ale na ekranie zamówienia
 *     NIEWIDOCZNA. Sprawdzone na żywo: zamówienie z zapisanym 19,00 zł
 *     pokazywało 25,00 zł, bo tyle mówił cennik.
 *  2. Zmiana cennika przepisywała historię. Zamówienie sprzed podwyżki
 *     pokazywało nową stawkę, choć klient zapłacił starą.
 *
 * ================== DLACZEGO NIE MA TU CENNIKA ==================
 *
 * Ta powierzchnia nie dostaje cennika ANI JAKO WEJŚCIA — i to jest cała
 * poprawka. Kwota dostawy zamówienia jest FAKTEM zapisanym w chwili jego
 * powstania (tym samym silnikiem, `resolveDeliveryCost`), a nie wartością
 * pochodną, którą wolno przeliczyć później. Komponent, który cennika nie
 * widzi, nie ma jak wrócić do liczenia — żadna przyszła zmiana nie przywróci
 * tu przeliczania przez nieuwagę.
 *
 * Podpowiedź z bieżącego cennika ma sens WYŁĄCZNIE przy edycji kwoty
 * (tak jak propozycja kwot przy dodawaniu pozycji) — a edycji ceny dostawy
 * ten ekran dziś nie ma. Kiedy się pojawi, podpowiedź wejdzie do formularza
 * edycji, nie do zdania o tym, ile zamówienie kosztowało.
 */
import { formatMoney, type CurrencyCode, type DeliveryPriceSource } from "@avably/core";
import { useTranslations } from "next-intl";

export function DeliveryCost({
  grosze,
  source,
  currency,
  locale,
}: {
  /** `orders.delivery_grosze` — kwota utrwalona przy tworzeniu zamówienia. */
  grosze: number;
  /** `orders.delivery_price_source` — skąd ta kwota się wzięła (0044). */
  source: DeliveryPriceSource;
  currency: CurrencyCode;
  locale: string;
}) {
  const t = useTranslations("orders.delivery.section");

  return (
    <p className="text-sm" data-delivery-cost={source}>
      {t("deliveryCost")}:{" "}
      {grosze === 0 ? (
        <span>{t("deliveryCostFree")}</span>
      ) : (
        <span className="font-semibold tabular-nums tracking-[0.01em]">
          {formatMoney(grosze, currency, locale)}
        </span>
      )}
      {/* Cena ustalona ręcznie mówi o sobie WPROST. Bez tego zdania kwota
          różna od cennika wygląda na usterkę i pierwszym odruchem operatora
          jest „poprawić" coś, co jest ustaleniem z klientem. */}
      {source === "manual" ? (
        <span className="text-muted-foreground" data-delivery-cost-manual>
          {" "}
          · {t("deliveryCostManual")}
        </span>
      ) : null}
    </p>
  );
}
