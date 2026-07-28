// @vitest-environment jsdom

/**
 * Karuzela osi czasu na wąskim ekranie (uwaga właściciela R3).
 *
 * ================== CZEGO TEN TEST PILNUJE ==================
 *
 * Oś jest pozioma na każdej szerokości, a poniżej `md` staje się karuzelą.
 * Sedno uwagi właściciela brzmiało: przy wejściu widoczny ma być krok
 * BIEŻĄCY („w toku"), a nie pierwszy z brzegu — inaczej na telefonie aktualny
 * status chowa się za prawą krawędzią i trzeba go szukać scrollem. To da się
 * „zaimplementować" tak, że z DOM-u wygląda identycznie (kroki są, klasy się
 * zgadzają), a mimo to karuzela nie przewija się na bieżący krok. Różnica jest
 * niewidoczna w statycznym renderze i całkowita dla użytkownika telefonu, więc
 * pinujemy ją przez EFEKT: `scrollIntoView` musi paść na kroku bieżącym.
 *
 * jsdom nie ma layoutu, więc nie udajemy pikseli — asercja jest o WYWOŁANIU
 * (że `scrollTo` padło na KONTENERZE osi, natychmiastowo) i o STRUKTURZE
 * (`aria-current`, fokusowalny kontener). Przewijamy KONTENER, nie krok:
 * `scrollIntoView` na kroku szarpnąłby całą stronę w pionie (błąd Safari),
 * a `scrollTo` na `<ol>` rusza wyłącznie tę oś. Dowód mutacyjny: wyłączenie
 * inicjalnego pozycjonowania (`false && …` w efekcie) zabiera wywołanie → ten
 * test świeci na czerwono.
 */
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

import {
  OrderTimeline,
  type OrderTimelineInput,
} from "@/app/[locale]/(panel)/zamowienia/[id]/order-timeline";

let origScrollWidth: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

/** jsdom nie implementuje scrollTo — podstawiamy metodę, którą podglądamy. */
beforeAll(() => {
  if (!("scrollTo" in Element.prototype)) {
    // @ts-expect-error — dokładamy metodę, której jsdom nie ma
    Element.prototype.scrollTo = () => {};
  }
  origScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
});

beforeEach(() => {
  // Efekt czeka na realny rozmiar kontenera przez ResizeObserver (odsłonięcie
  // Suspense), którego jsdom nie ma. Podstawiamy shim odpalający callback
  // NATYCHMIAST przy `observe` — dzięki temu asercja o wywołaniu jest
  // deterministyczna, bez czekania na layout, którego w jsdom i tak nie ma.
  class SyncResizeObserver {
    constructor(private cb: ResizeObserverCallback) {}
    observe() {
      this.cb([], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", SyncResizeObserver);

  // Efekt wyrównuje dopiero, gdy oś REALNIE ma co przewijać
  // (`scrollWidth > clientWidth`). jsdom nie liczy layoutu (obie wartości 0),
  // więc symulujemy przepełnienie karuzeli — bez tego strażnik zwróciłby
  // wcześnie i `scrollTo` nigdy by nie padło (a wtedy test nie broniłby niczego).
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 343 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (origScrollWidth) Object.defineProperty(HTMLElement.prototype, "scrollWidth", origScrollWidth);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
});

const NO_DEPOSIT: OrderTimelineInput["deposit"] = {
  required: false,
  collectedGrosze: 0,
  balanceGrosze: 0,
  settled: false,
};

function input(partial: Partial<OrderTimelineInput> = {}): OrderTimelineInput {
  return {
    orderStatus: "pending",
    paymentStatus: "unpaid",
    shipmentStatus: null,
    createdAt: "2026-07-20T10:00:00Z",
    endDate: "2026-07-25",
    shipmentDispatchedAt: null,
    deposit: NO_DEPOSIT,
    ...partial,
  };
}

function renderTimeline(inp: OrderTimelineInput) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <OrderTimeline currency="PLN" {...inp} />
    </NextIntlClientProvider>,
  );
}

/**
 * Zamówienie w ŚRODKU obiegu: opłacone, wysyłka w toku → krok bieżący to
 * `shipment` (trzeci z pięciu, nie na brzegu). Właśnie taki przypadek pokazuje,
 * że karuzela przewija się na bieżący, a nie zostaje na pierwszym kroku.
 */
const MID_FLOW = input({
  orderStatus: "ready_for_pickup",
  paymentStatus: "paid",
  deposit: { required: true, collectedGrosze: 0, balanceGrosze: 0, settled: false },
});

describe("oś czasu (R3) — karuzela ustawia się na kroku bieżącym", () => {
  it("przy wejściu przewija KONTENER osi, natychmiastowo (bez animacji, bez ruszania strony)", () => {
    const spy = vi.spyOn(Element.prototype, "scrollTo").mockImplementation(() => {});

    renderTimeline(MID_FLOW);

    // Wywołane raz i na KONTENERZE osi (`<ol data-order-timeline>`), a nie na
    // kroku — przewijamy oś, nie stronę.
    expect(spy).toHaveBeenCalledTimes(1);
    const target = spy.mock.instances[0] as HTMLElement;
    expect(target.getAttribute("data-order-timeline")).not.toBeNull();
    // Natychmiast, żeby nadpisać `scroll-smooth` — pozycja startowa bez animacji.
    expect(spy.mock.calls[0]![0]).toMatchObject({ behavior: "instant" });
  });

  it("zamówienie anulowane nie ma kroku bieżącego → brak przewijania", () => {
    // Kontrola negatywna: bez tego „przewiń na bieżący" mogłoby fałszywie
    // wołać przewijanie także tam, gdzie nie ma dokąd celować, i wciąż
    // wyglądać zielono wyżej.
    const spy = vi.spyOn(Element.prototype, "scrollTo").mockImplementation(() => {});

    renderTimeline(input({ orderStatus: "cancelled", paymentStatus: "cancelled" }));

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("oś czasu (R3) — struktura karuzeli", () => {
  it("aria-current='step' siedzi DOKŁADNIE na kroku bieżącym", () => {
    const { container } = renderTimeline(MID_FLOW);

    const marked = container.querySelectorAll("[aria-current='step']");
    expect(marked).toHaveLength(1);
    expect(marked[0]!.getAttribute("data-timeline-step")).toBe("shipment");
    expect(marked[0]!.getAttribute("data-step-state")).toBe("current");
  });

  it("kontener osi jest fokusowalny — karuzelę da się przewinąć klawiaturą", () => {
    const { container } = renderTimeline(MID_FLOW);

    const list = container.querySelector("[data-order-timeline]");
    expect(list).not.toBeNull();
    expect(list!.getAttribute("tabindex")).toBe("0");
    // Kroki zostają listą semantyczną (ol/li), a nie zbiorem divów.
    expect(list!.tagName).toBe("OL");
    expect(container.querySelectorAll("li[data-timeline-step]")).toHaveLength(5);
  });
});
