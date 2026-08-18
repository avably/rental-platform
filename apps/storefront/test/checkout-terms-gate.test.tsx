// @vitest-environment jsdom
/**
 * BRAMKA DOKUMENTÓW PRAWNYCH W UI CHECKOUTU (H-COMP-01, ADR-191).
 *
 * Trzy zdania, których broni ten plik:
 *   1. Bez kompletu opublikowanych dokumentów NIE MA checkboxa zgody (martwy
 *      checkbox sugeruje, że jest co zaakceptować), jest blokujący komunikat,
 *      a submit nie wychodzi — nawet `requestSubmit` ze skryptu, który omija
 *      `disabled` przycisku.
 *   2. Z dokumentami submit niesie DOKŁADNIE etykietę wersji z rejestru —
 *      dawny fallback na stałą „1.0" utrwalał zgodę wskazującą dokument,
 *      którego nie ma, i nie może wrócić niezauważony.
 *   3. Etykieta zgody linkuje PERMALINK KONKRETNEJ WERSJI, nie żywy adres —
 *      najemca może jutro opublikować nową wersję, a dowód zgody ma wskazywać
 *      tekst, który klient naprawdę widział.
 *
 * Wzorzec renderu i podmian: store-term.test.tsx (ta sama powłoka jsdom).
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitCheckout = vi.fn();
vi.mock("@/lib/actions/checkout", () => ({
  submitCheckout: (...args: unknown[]) => submitCheckout(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const { StoreTermProvider } = await import("@/components/storefront/store-term");
const { CheckoutForm } = await import("@/components/storefront/checkout-form");
const { EmbedWidget } = await import("@/components/embed/embed-widget");
const { writeCart } = await import("@/lib/cart/storage");
const { getStorefrontCopy } = await import("@/lib/storefront/copy");
const plMessages = (await import("../messages/pl.json")).default;

const copy = await getStorefrontCopy("pl");

const ROWER = "11111111-1111-4111-8111-111111111111";

const PRODUCTS = [
  {
    id: ROWER,
    name: "Rower górski",
    description: null,
    base_price_day_grosze: 12_000,
    deposit_grosze: 40_000,
    auto_increment_multiplier: 1,
    buffer_before_days: 0,
    buffer_after_days: 0,
    custom_fields: {},
    category_ids: [],
    pricing_tiers: [],
    images: [],
  },
];

const TERMS = { href: "/regulamin/w/3", versionLabel: "v3" };

function checkoutForm(terms?: { href: string; versionLabel: string }) {
  return (
    <StoreTermProvider>
      <CheckoutForm
        products={PRODUCTS as never}
        deliveryMethods={[{ method: "pickup", price_grosze: 0 }] as never}
        pickupLocations={
          [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Magazyn",
              address_street: null,
              address_zip: null,
              address_city: "Warszawa",
            },
          ] as never
        }
        currency="PLN"
        locale="pl"
        copy={copy}
        paymentMethods={["transfer"] as never}
        customFields={[]}
        terms={terms}
      />
    </StoreTermProvider>
  );
}

/** Koszyk gotowy do wysłania — bramki koszyka nie są przedmiotem tych testów. */
function seedCart(): void {
  writeCart({
    items: [{ productId: ROWER, quantity: 1 }],
    startDate: "2026-10-01",
    endDate: "2026-10-03",
  } as never);
}

function fillRequiredFields(): void {
  fireEvent.change(document.querySelector("#co-fullname")!, { target: { value: "Jan Kowalski" } });
  fireEvent.change(document.querySelector("#co-email")!, {
    target: { value: "jan@example.com" },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  seedCart();
  submitCheckout.mockReset();
  submitCheckout.mockResolvedValue({ status: "rate_limited" });
});

afterEach(cleanup);

describe("checkout bez kompletu dokumentów (terms=undefined)", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: przywrócenie dawnego zachowania — checkbox z
  // nielinkowaną etykietą i fallback `?? "1.0"` w submicie — zapala wszystkie
  // trzy przypadki naraz: checkbox wraca, komunikat znika, submit wychodzi.
  it("nie renderuje checkboxa zgody, renderuje blokujący komunikat", () => {
    render(checkoutForm(undefined));

    expect(document.querySelector("#co-terms")).toBeNull();
    const notice = document.querySelector("[data-checkout-terms-missing]");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toBe(copy.checkout.termsMissingNotice);
  });

  it("przycisk złożenia zamówienia jest niedostępny", () => {
    render(checkoutForm(undefined));
    const submit = document.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(submit).not.toBeNull();
    expect(submit!.disabled).toBe(true);
  });

  it("submit NIE wychodzi nawet z pominięciem disabled (fireEvent.submit na formie)", async () => {
    render(checkoutForm(undefined));
    fillRequiredFields();
    fireEvent.submit(document.querySelector("form")!);

    // `waitFor` na negację bywa fałszywie zielony od razu — dajemy pętli
    // zdarzeń szansę wykonać ewentualny (błędny) submit, zanim zapytamy.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(submitCheckout).not.toHaveBeenCalled();
  });
});

describe("checkout z kompletem dokumentów", () => {
  it("submit niesie DOKŁADNIE etykietę wersji z rejestru (bez fallbacku)", async () => {
    render(checkoutForm(TERMS));
    fillRequiredFields();
    fireEvent.click(document.querySelector("#co-terms")!);
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(submitCheckout).toHaveBeenCalledTimes(1));
    const input = submitCheckout.mock.calls[0][0] as { termsVersion: string };
    expect(input.termsVersion).toBe("v3");
  });

  it("etykieta zgody linkuje PERMALINK konkretnej wersji i pokazuje jej etykietę", () => {
    render(checkoutForm(TERMS));

    const link = document.querySelector<HTMLAnchorElement>("[data-checkout-terms-link]");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/regulamin/w/3");
    expect(document.querySelector("[data-checkout-terms-version]")!.textContent).toContain("v3");
    expect(document.querySelector("[data-checkout-terms-missing]")).toBeNull();
  });
});

describe("widget embedu — ta sama bramka na DRUGIEJ drodze do rdzenia", () => {
  /**
   * Formularz embedu pojawia się dopiero po wyborze zakresu dat, a mapę
   * miesiąca widget pobiera fetch-em — mock odpowiada „wszystko wolne"
   * na GET miesiąca i PRZECHWYTUJE body POST-a rezerwacji. To jest dokładnie
   * ścieżka, na której żył drugi fallback `?? "1.0"` (embed-widget.tsx:344).
   */
  const embedCopy = plMessages.storefront;

  function freeMonth(url: string): Response {
    const month = new URL(url, "http://localhost").searchParams.get("month")!;
    const days: Record<string, number> = {};
    for (let day = 1; day <= 31; day += 1) {
      days[`${month}-${String(day).padStart(2, "0")}`] = 3;
    }
    return new Response(JSON.stringify({ month, days, unresolved: [], partial: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  function mockEmbedFetch(capture: { posts: unknown[] }) {
    const mocked = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/embed/api/month")) return freeMonth(url);
      if (url.includes("/embed/api/reservations")) {
        capture.posts.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ error: { code: "rejected" } }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`nieoczekiwany fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mocked);
    return mocked;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderEmbed(terms?: { href: string; versionLabel: string }) {
    return render(
      <EmbedWidget
        copy={embedCopy as never}
        locale="pl"
        currency="PLN"
        products={
          [
            {
              id: ROWER,
              name: "Rower górski",
              description: null,
              base_price_day_grosze: 12_000,
              deposit_grosze: 40_000,
              auto_increment_multiplier: 1,
              buffer_before_days: 0,
              buffer_after_days: 0,
              pricing_tiers: [],
              images: [],
            },
          ] as never
        }
        pickupLocations={
          [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Magazyn",
              address_street: null,
              address_zip: null,
              address_city: "Warszawa",
            },
          ] as never
        }
        deliveryMethods={[{ method: "pickup", price_grosze: 0 }] as never}
        customFields={[]}
        initialProductId={ROWER}
        theme="light"
        terms={terms}
      />,
    );
  }

  function dayFromToday(offset: number): string {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() + offset);
    return now.toISOString().slice(0, 10);
  }

  /** Klik w dzień, przewijając kalendarz do jego miesiąca (wzorzec store-term). */
  async function clickEmbedDay(iso: string): Promise<void> {
    for (let hop = 0; hop < 4; hop += 1) {
      const node = await waitFor(() => {
        const found = document.querySelector<HTMLButtonElement>(`[data-embed-day="${iso}"]`);
        const monthLoaded = document.querySelector('[data-embed-day-state="free"]');
        if (found === null && monthLoaded === null) throw new Error("miesiąc się jeszcze ładuje");
        return found;
      });
      if (node !== null) {
        fireEvent.click(node);
        return;
      }
      fireEvent.click(document.querySelector(`[aria-label="${embedCopy.embed.nextMonth}"]`)!);
    }
    throw new Error(`Brak dnia ${iso} w kalendarzu embedu`);
  }

  async function openEmbedForm(): Promise<void> {
    await clickEmbedDay(dayFromToday(7));
    await clickEmbedDay(dayFromToday(9));
    await waitFor(() => {
      if (document.querySelector("[data-embed-form]") === null) {
        throw new Error("formularz się nie pokazał");
      }
    });
  }

  it("bez dokumentów: zamiast checkboxa blokada, przycisk disabled, POST nie wychodzi", async () => {
    const capture = { posts: [] as unknown[] };
    mockEmbedFetch(capture);
    renderEmbed(undefined);
    await openEmbedForm();

    expect(document.querySelector('input[name="termsAccepted"]')).toBeNull();
    expect(document.querySelector("[data-embed-terms-missing]")).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>("[data-embed-submit]")!.disabled).toBe(true);

    // Pominięcie `disabled` (submit na formie, jak requestSubmit ze skryptu
    // strony-gospodarza) też nie może wysłać rezerwacji.
    fireEvent.submit(document.querySelector("[data-embed-form]")!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(capture.posts).toEqual([]);
  });

  it("z dokumentami: POST niesie DOKŁADNIE etykietę z rejestru, link to permalink wersji", async () => {
    const capture = { posts: [] as unknown[] };
    mockEmbedFetch(capture);
    renderEmbed({ href: "/regulamin/w/3", versionLabel: "v3" });
    await openEmbedForm();

    const link = document.querySelector<HTMLAnchorElement>("[data-embed-terms-link]");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/regulamin/w/3");

    fireEvent.click(document.querySelector('input[name="termsAccepted"]')!);
    fireEvent.submit(document.querySelector("[data-embed-form]")!);
    await waitFor(() => expect(capture.posts.length).toBe(1));
    expect((capture.posts[0] as { termsVersion: string }).termsVersion).toBe("v3");
  });
});
