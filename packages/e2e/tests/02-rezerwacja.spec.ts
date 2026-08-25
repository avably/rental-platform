import { expect, test, type Page } from "@playwright/test";

import { dateISO } from "../lib/dates";
import { storefrontUrl } from "../lib/env";
import { readSeedState } from "../lib/seed-state";

/**
 * Ogniwo 2: rezerwacja od strony klienta — wybór terminu w widgecie
 * rezerwacji, liczba wolnych sztuk, dodanie do koszyka i przejście do kasy.
 *
 * OD ADR-180 ŚCIEŻKA WYGLĄDA INACZEJ: para pól `<input type="date">` i przycisk
 * „Sprawdź dostępność" zniknęły ze strony sprzętu razem z całą jej własną
 * obsługą terminu. OD ADR-194 siatka nie wisi już na stałe: karta rezerwacji
 * niesie POLE terminu, kalendarz otwiera się w OKNIE wyboru, a zapis do stanu
 * koszyka (jedno źródło prawdy, ADR-179) robi wyłącznie „Zastosuj". Dostępność
 * przychodzi SAMA z jednego wywołania zbiorczego — bez klikania „sprawdź".
 */

/**
 * Klik w dzień siatki, przewijając kalendarz do jego miesiąca.
 *
 * Przewijanie jest częścią scenariusza, a nie obejściem: okno wyboru otwiera
 * się na miesiącu bieżącego terminu, więc termin za miesiąc naprawdę wymaga
 * kliknięcia „następny miesiąc" — i tę drogę klient też przechodzi.
 */
async function klikDzien(page: Page, iso: string): Promise<void> {
  for (let skok = 0; skok < 4; skok += 1) {
    const dzien = page.locator(`[data-calendar-day="${iso}"]`);
    if ((await dzien.count()) > 0) {
      await dzien.click();
      return;
    }
    await page.getByRole("button", { name: "Następny miesiąc" }).click();
  }
  throw new Error(`Brak dnia ${iso} w siatce kalendarza po przewinięciu okna`);
}

test("klient wybiera termin, widzi dostępność i dodaje produkt do koszyka", async ({ page }) => {
  const seed = readSeedState();

  // Wejście jak klient: katalog → klik w kartę produktu.
  await page.goto(`${storefrontUrl(seed.slug)}/`);

  // BEZ TERMINU KAFEL MILCZY (ADR-180) — brak informacji o dostępności nie jest
  // zdaniem „dostępne". Pierwsze wejście klienta to dokładnie ten stan.
  await expect(page.locator("[data-products-availability]")).toHaveCount(0);

  await page.getByRole("link", { name: new RegExp(seed.productName) }).click();
  // ADRES CZYTELNY, nie identyfikator (ADR-182): kafel katalogu prowadzi pod
  // `/produkt/{slug}`, a `/product/{uuid}` zostaje wyłącznie jako źródło 308.
  await expect(page).toHaveURL(new RegExp(`/produkt/${seed.productSlug}$`));

  // Widget rezerwacji stoi na stronie sprzętu i jest JEDEN (ADR-180).
  const widget = page.locator(`[data-product-booking="${seed.productId}"]`);
  await expect(widget).toBeVisible();

  // FORMA ZWARTA (ADR-194): siatki nie ma, dopóki klient nie kliknie POLA
  // terminu — dokładnie ten stan zastaje pierwsze wejście.
  await expect(page.locator("[data-calendar-day]")).toHaveCount(0);
  await widget.locator("[data-product-booking-field]").click();

  // Termin trzydniowy w przyszłości (zakresy są INCLUSIVE: start = end to
  // najem jednodniowy). Dwa kliknięcia w siatkę — otwarcie i domknięcie
  // zakresu — a zapis do koszyka robi dopiero „Zastosuj" (jedyny zapis,
  // ADR-194); okno zamyka się po nim samo.
  await klikDzien(page, dateISO(7));
  await klikDzien(page, dateISO(9));
  await page.locator("[data-store-term-apply]").click();
  await expect(page.locator("[data-store-term-modal]")).toHaveCount(0);

  // Oba zasiane egzemplarze wolne w tym terminie. Liczba przychodzi SAMA,
  // z tej samej odpowiedzi katalogowej, która maluje kafle.
  await expect(widget.locator(`[data-product-booking-units="${seed.unitCount}"]`)).toBeVisible();

  await page.locator("#booking-qty").fill("1");
  await page.getByRole("button", { name: "Dodaj do koszyka" }).click();
  await expect(page.getByText("Dodano do koszyka")).toBeVisible();

  // Koszyk: pozycja z zasianym produktem i przejście do kasy.
  // [F8] Pole liczbowe `#qty-…` zastąpił stepper `− n +` (spec F8) — intencja
  // asercji bez zmian: pozycja ma ilość 1; zmienił się WYŁĄCZNIE nośnik.
  await page.getByRole("link", { name: "Przejdź do koszyka" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText(seed.productName)).toBeVisible();
  await expect(
    page.locator(`[data-cart-stepper="${seed.productId}"] [data-cart-stepper-quantity]`),
  ).toHaveText("1");
  await expect(page.getByRole("link", { name: "Przejdź do zamówienia" })).toBeVisible();

  // KATALOG PO WYBRANIU TERMINU: kafel niesie liczbę wolnych sztuk (ADR-180).
  // Termin mieszka w koszyku, więc przetrwał przejście między stronami — i to
  // jest dowód całej ścieżki: baza → akcja serwera → powłoka → kafel.
  await page.goto(`${storefrontUrl(seed.slug)}/`);
  await expect(page.locator(`[data-products-availability="${seed.productId}"]`)).toContainText(
    String(seed.unitCount),
  );
});
