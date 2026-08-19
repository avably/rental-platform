// @vitest-environment jsdom
/**
 * FOKUS I OGŁOSZENIE BŁĘDÓW WALIDACJI W WIDGECIE EMBEDU (ADR-198 — ten sam
 * wzorzec, co checkout w ADR-197; tam pilnuje go checkout-error-focus.test.tsx).
 *
 * Trzy zdania, których broni ten plik:
 *   1. Po nieudanej walidacji SERWERA fokus przenosi się do PIERWSZEGO pola
 *      z błędem W KOLEJNOŚCI DOKUMENTU — nie w kolejności kluczy mapy
 *      z serwera. Do ADR-198 fokus zostawał na przycisku, a użytkownik
 *      czytnika słyszał ciszę (dokładnie wada M-A11Y-03 sprzed ADR-197,
 *      nazwana w jego raporcie jako osobna pozycja embedu).
 *   2. Region `role="alert"` istnieje od montażu formularza i po nieudanej
 *      walidacji ogłasza LICZBĘ pól do poprawienia. Błąd bez kontrolki
 *      (daty/pozycje z kalendarza) przenosi fokus na region.
 *   3. Pole z błędem jest związane z komunikatem przez `aria-describedby`,
 *      pole zdrowe nie wskazuje niczego (WCAG 3.3.1).
 *
 * KORZEŃ FOKUSU: widget żyje we własnym dokumencie ramki (osobny root
 * `app/embed/layout.tsx`, iframe z lib/embed/loader.ts, zero Shadow DOM),
 * więc `document.activeElement` jsdom odpowiada dokładnie temu, co widzi
 * dokument ramki w produkcji — test mierzy właściwy korzeń.
 *
 * Formularz embedu jest NIEKONTROLOWANY i waliduje na serwerze: submit
 * jedzie `fetch`-em, więc podmieniamy `fetch` (miesiąc kalendarza + odmowa
 * rezerwacji), a nie akcję serwera jak w kasie.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmbedWidget } from "@/components/embed/embed-widget";
import { EMBED_MONTH_PATH, EMBED_RESERVATION_PATH } from "@/lib/embed/contract";
import { format } from "@/lib/storefront/copy";
import plMessages from "../messages/pl.json";

const copy = plMessages.storefront;

const PRODUCT = "11111111-1111-4111-8111-111111111111";

const KATALOG = {
  products: [
    {
      id: PRODUCT,
      name: "Wiertarka udarowa",
      description: null,
      base_price_day_grosze: 8000,
      deposit_grosze: 20000,
      auto_increment_multiplier: 1,
      buffer_before_days: 0,
      buffer_after_days: 0,
      pricing_tiers: [],
      images: [],
    },
  ],
  pickupLocations: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Magazyn",
      address_street: null,
      address_zip: null,
      address_city: null,
    },
  ],
} as never as { products: never[]; pickupLocations: never[] };

const TERMS = { href: "/regulamin/w/3", versionLabel: "v3" };

/** Mapa bieżącego miesiąca: KAŻDY dzień wolny — klik w dzień ma być możliwy. */
function monthPayload(month: string) {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const days: Record<string, number> = {};
  const cursor = new Date(Date.UTC(year, index - 1, 1));
  while (cursor.getUTCMonth() === index - 1) {
    days[cursor.toISOString().slice(0, 10)] = 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { month, days, unresolved: [], partial: false };
}

/**
 * Odmowa walidacji, którą kolejny submit dostanie z „serwera". Kształt 1:1
 * z handlers.ts (`embedError(422, "validation_failed", fields)`).
 */
let validationFields: Record<string, string>;

beforeEach(() => {
  validationFields = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(EMBED_MONTH_PATH)) {
        const month = new URL(url, "http://localhost").searchParams.get("month")!;
        return { ok: true, status: 200, json: async () => monthPayload(month) };
      }
      if (url.startsWith(EMBED_RESERVATION_PATH)) {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            error: { code: "validation_failed", fields: validationFields },
          }),
        };
      }
      throw new Error(`nieoczekiwane żądanie: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function widget(deliveryMethods: { method: string; price_grosze: number }[] = [
  { method: "pickup", price_grosze: 0 },
]) {
  return (
    <EmbedWidget
      copy={copy as never}
      locale="pl"
      currency="PLN"
      products={KATALOG.products}
      pickupLocations={KATALOG.pickupLocations}
      deliveryMethods={deliveryMethods as never}
      customFields={[]}
      initialProductId={PRODUCT}
      theme="light"
      terms={TERMS}
    />
  );
}

/**
 * Doprowadza widget do stanu z formularzem: czeka na mapę miesiąca i klika
 * OSTATNI dzień bieżącego miesiąca dwa razy (zakres jednodniowy) — ostatni,
 * bo dni przed dzisiejszym są `past` i wyłączone niezależnie od daty testu.
 */
async function openForm(): Promise<HTMLFormElement> {
  const lastDay = () => {
    const days = document.querySelectorAll<HTMLButtonElement>("[data-embed-day]");
    return days[days.length - 1]!;
  };
  await waitFor(() => expect(lastDay().disabled).toBe(false));
  fireEvent.click(lastDay());
  fireEvent.click(lastDay());
  const form = document.querySelector<HTMLFormElement>("[data-embed-form]");
  expect(form).not.toBeNull();
  return form!;
}

describe("fokus na pierwszym polu z błędem (ADR-198)", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie efektu przenoszącego fokus zostawia
  // aktywny element poza formularzem — przypadki robią się czerwone.
  it("jeden błąd: fokus ląduje na tym polu", async () => {
    validationFields = { email: "invalid" };
    render(widget());
    fireEvent.submit(await openForm());

    await waitFor(() =>
      expect((document.activeElement as HTMLInputElement | null)?.name).toBe("email"),
    );
    expect(document.activeElement?.getAttribute("aria-invalid")).toBe("true");
  });

  it("dwa błędy: fokus na PIERWSZYM w kolejności DOKUMENTU, nie kluczy mapy", async () => {
    // `terms` stoi w mapie PRZED `fullName`, ale w dokumencie checkbox zgody
    // jest ostatni. Fokus na checkboxie = czytanie kolejności kluczy mapy.
    validationFields = { terms: "required", fullName: "required" };
    render(widget());
    fireEvent.submit(await openForm());

    await waitFor(() =>
      expect((document.activeElement as HTMLInputElement | null)?.name).toBe("fullName"),
    );
  });

  it("błąd grupy radio (paymentMethod) jest osiągalny fokusem przez data-atrybut", async () => {
    validationFields = { paymentMethod: "invalid" };
    render(widget());
    fireEvent.submit(await openForm());

    await waitFor(() => {
      const active = document.activeElement as HTMLInputElement | null;
      expect(active?.name).toBe("paymentMethod");
      // ARIA nie wspiera `aria-invalid` na roli radio — błędną grupę oznacza
      // data-atrybut, a komunikat niesie `aria-describedby` (globalne).
      expect(active?.getAttribute("data-embed-invalid")).toBe("true");
      expect(active?.getAttribute("aria-describedby")).toBe("embed-payment-error");
    });
    expect(document.querySelector("#embed-payment-error")).not.toBeNull();
  });

  it("błąd bez kontrolki (startDate z kalendarza): fokus ląduje na regionie ogłoszeń", async () => {
    validationFields = { startDate: "invalid" };
    render(widget());
    fireEvent.submit(await openForm());

    await waitFor(() =>
      expect(document.activeElement?.hasAttribute("data-embed-error-summary")).toBe(true),
    );
  });

  it("pola adresu kuriera też niosą znacznik, komunikat i fokus", async () => {
    // Bez `pickup` w metodach widget startuje na kurierze — pola adresowe są
    // w dokumencie. Do ADR-198 nie miały ani znacznika, ani komunikatu.
    validationFields = { addressZip: "too_long" };
    render(widget([{ method: "courier", price_grosze: 1500 }]));
    fireEvent.submit(await openForm());

    await waitFor(() =>
      expect((document.activeElement as HTMLInputElement | null)?.name).toBe("addressZip"),
    );
    expect(document.activeElement?.getAttribute("aria-describedby")).toBe("embed-zip-error");
    expect(document.querySelector("#embed-zip-error")!.textContent).toBe(
      copy.embed.invalidField,
    );
  });
});

describe("region ogłoszeń walidacji", () => {
  it("istnieje od montażu formularza (pusty), żeby czytnik zdążył go zarejestrować", async () => {
    render(widget());
    await openForm();

    const region = document.querySelector("[data-embed-error-summary]");
    expect(region).not.toBeNull();
    expect(region!.getAttribute("role")).toBe("alert");
    expect(region!.textContent).toBe("");
  });

  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie regionu albo liczby błędów z komunikatu.
  it("po nieudanej walidacji ogłasza LICZBĘ pól do poprawienia", async () => {
    validationFields = { fullName: "required", email: "invalid" };
    render(widget());
    fireEvent.submit(await openForm());

    await waitFor(() => {
      const region = document.querySelector("[data-embed-error-summary]");
      expect(region!.textContent).toBe(format(copy.checkout.errors.summary, { count: 2 }));
    });
  });

  it("walidacja z polami NIE dubluje ogłoszenia ogólnym komunikatem błędu", async () => {
    validationFields = { email: "invalid" };
    render(widget());
    fireEvent.submit(await openForm());

    await waitFor(() =>
      expect((document.activeElement as HTMLInputElement | null)?.name).toBe("email"),
    );
    // Ogólny `data-embed-error` zostaje dla conflict/rate_limited/awarii —
    // przy walidacji ogłasza region podsumowania, nie dwa alerty naraz.
    expect(document.querySelector("[data-embed-error]")).toBeNull();
  });
});

describe("wiązanie pola z komunikatem (aria-describedby)", () => {
  it("pole z błędem wskazuje istniejący komunikat; pole zdrowe nie wskazuje nic", async () => {
    validationFields = { email: "invalid" };
    render(widget());
    fireEvent.submit(await openForm());

    await waitFor(() => {
      const email = document.querySelector('[name="email"]')!;
      expect(email.getAttribute("aria-invalid")).toBe("true");
      expect(email.getAttribute("aria-describedby")).toBe("embed-email-error");
    });
    expect(document.querySelector("#embed-email-error")!.textContent).toBe(
      copy.embed.invalidField,
    );

    // Kontrola negatywna: pole zdrowe nie każe czytnikowi czytać pustego węzła.
    expect(
      document.querySelector('[name="fullName"]')!.getAttribute("aria-describedby"),
    ).toBeNull();
  });
});
