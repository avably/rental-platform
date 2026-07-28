// @vitest-environment jsdom

/**
 * Dodawanie pozycji JEDNYM krokiem i odkrywalność przypisania (R1).
 *
 * ================== CO TEN TEST PILNUJE ==================
 *
 * 1. Formularz dodawania niesie do akcji KOMPLET: egzemplarz oraz kwoty najmu
 *    i kaucji. Asercja jest o TREŚCI żądania (FormData przekazane akcji), nie
 *    o samym fakcie wywołania — „dodano" bez egzemplarza i kwot wyglądałoby
 *    z ekranu tak samo, a jest inną operacją (drugi krok przez „Edytuj").
 * 2. Kwoty są wstępnie wypełnione PROPOZYCJĄ z dat (prop `proposed*Grosze`),
 *    a ręczna zmiana jednej kwoty NIE rusza drugiej — nadpisanie jest lokalne.
 * 3. Plakietka „nieprzypisany" JEST wejściem w przypisanie: klik otwiera panel
 *    edycji tej pozycji, a kursor ląduje na wyborze egzemplarza.
 *
 * Testowany jest PRAWDZIWY `ItemsEditor` z prawdziwym adapterem selecta i
 * prawdziwym panelem edycji; zamockowane są wyłącznie akcje serwerowe (jedyna
 * granica, za którą jest sieć i baza).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderStatus } from "@avably/core";

import { groszeToInputValue } from "@/lib/money-input";
import messages from "../messages/pl.json";

import {
  ItemsEditor,
  type EditorItem,
  type EditorProduct,
} from "@/app/[locale]/(panel)/zamowienia/[id]/items-editor";

const ORDER_ID = "00000000-0000-4000-8000-0000000000f1";
const items = messages.orders.items;

const UNIT_FREE = "00000000-0000-4000-8000-0000000000b1";
const UNIT_BUSY = "00000000-0000-4000-8000-0000000000b2";

const HEATER: EditorProduct = {
  id: "00000000-0000-4000-8000-0000000000c1",
  name: "Nagrzewnica 20 kW",
  freeUnits: 1,
  totalUnits: 2,
  units: [
    { id: UNIT_FREE, label: "NG-001", free: true },
    { id: UNIT_BUSY, label: "NG-002", free: false },
  ],
  proposedRentalGrosze: 50_000,
  proposedDepositGrosze: 5_000,
};

const UNASSIGNED_ITEM: EditorItem = {
  id: "00000000-0000-4000-8000-0000000000a1",
  productName: "Nagrzewnica 20 kW",
  unitId: null,
  unitLabel: null,
  rentalGrosze: 50_000,
  depositGrosze: 5_000,
  freeUnitCount: 1,
  units: [
    { id: UNIT_FREE, label: "NG-001", free: true },
    { id: UNIT_BUSY, label: "NG-002", free: false },
  ],
};

/** Radix Select woła API, których jsdom nie implementuje. */
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

let add: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

function mount(overrides?: {
  items?: EditorItem[];
  products?: EditorProduct[];
  editable?: boolean;
  orderStatus?: OrderStatus;
}) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <ItemsEditor
        orderId={ORDER_ID}
        orderStatus={overrides?.orderStatus ?? "reserved"}
        editable={overrides?.editable ?? true}
        items={overrides?.items ?? [UNASSIGNED_ITEM]}
        products={overrides?.products ?? [HEATER]}
        collectedGrosze={0}
        totalRentalGrosze={50_000}
        totalDepositGrosze={5_000}
        currency="PLN"
        locale="pl"
        actions={{ add: add as never, update: update as never, remove: remove as never }}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  add = vi.fn(async () => ({}));
  update = vi.fn(async () => ({}));
  remove = vi.fn(async () => ({}));
});

describe("dodawanie pozycji jednym krokiem (R1)", () => {
  it("wstępnie wypełnia kwoty PROPOZYCJĄ z dat (prop proposed*Grosze)", () => {
    const { container } = mount();
    const rental = container.querySelector<HTMLInputElement>("#add-item-rental")!;
    const deposit = container.querySelector<HTMLInputElement>("#add-item-deposit")!;

    expect(rental.value).toBe(groszeToInputValue(HEATER.proposedRentalGrosze));
    expect(deposit.value).toBe(groszeToInputValue(HEATER.proposedDepositGrosze));
  });

  it("submit niesie do akcji egzemplarz i OBIE kwoty (ręczna korekta nadpisuje propozycję)", async () => {
    const { container } = mount();

    // Ręczna korekta najmu — nadpisuje propozycję; kaucja zostaje z propozycji.
    const rental = container.querySelector<HTMLInputElement>("#add-item-rental")!;
    fireEvent.change(rental, { target: { value: "420,50" } });

    const form = container.querySelector<HTMLFormElement>("[data-items-add]")!;
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(add).toHaveBeenCalledTimes(1);
    const formData = add.mock.calls[0]![1] as FormData;
    expect(formData.get("orderId")).toBe(ORDER_ID);
    expect(formData.get("productId")).toBe(HEATER.id);
    // Domyślnie wybrana PIERWSZA WOLNA sztuka — typowy dodaj bez drugiego kroku.
    expect(formData.get("unitId")).toBe(UNIT_FREE);
    // Kwoty: nadpisany najem + propozycja kaucji — komplet, nie same statusy.
    expect(formData.get("rental")).toBe("420,50");
    expect(formData.get("deposit")).toBe(groszeToInputValue(HEATER.proposedDepositGrosze));
  });
});

describe("odkrywalność przypisania (R1)", () => {
  it("klik w plakietkę »nieprzypisany« otwiera edycję z fokusem na egzemplarzu", async () => {
    mount();

    // Przed kliknięciem panelu edycji nie ma.
    expect(screen.queryByText(items.editTitle.replace("{name}", UNASSIGNED_ITEM.productName))).toBeNull();

    const trigger = screen.getByRole("button", { name: items.assignUnit });
    await act(async () => {
      fireEvent.click(trigger);
      await Promise.resolve();
    });

    // Panel edycji tej pozycji jest otwarty…
    expect(
      screen.getByText(items.editTitle.replace("{name}", UNASSIGNED_ITEM.productName)),
    ).toBeTruthy();
    // …a kursor stoi na wyborze egzemplarza tej pozycji.
    expect(document.activeElement?.id).toBe(`item-unit-${UNASSIGNED_ITEM.id}`);
  });

  it("na zamówieniu zamkniętym plakietka NIE jest przyciskiem i stoi powód blokady", () => {
    mount({ editable: false, orderStatus: "cancelled" });

    expect(screen.queryByRole("button", { name: items.assignUnit })).toBeNull();
    // Powód, dla którego pozycji nie da się zmienić, jest widoczny przy pozycjach.
    expect(screen.getByText(items.lockedClosed)).toBeTruthy();
  });
});
