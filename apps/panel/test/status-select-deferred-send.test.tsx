// @vitest-environment jsdom

/**
 * ODROCZENIE WYSYŁKI JEST PRAWDZIWE (uwaga właściciela N3, ADR-075).
 *
 * ================== CZEGO TEN TEST PILNUJE ==================
 *
 * Cofnięcie w 10 sekund da się „zaimplementować” na dwa sposoby, które z
 * ekranu wyglądają identycznie: wysłać wiadomość od razu i pokazać przycisk
 * „Anuluj”, który nic nie cofa — albo ODROCZYĆ wysyłkę i nie wykonać jej
 * wcale, gdy operator anuluje. Różnica jest niewidoczna dla oka i całkowita
 * dla klienta, więc musi być przypięta testem, a nie recenzją.
 *
 * Asercja jest zawsze o TYM SAMYM: ile razy została zawołana akcja wysyłki.
 * Zero wywołań = wiadomość nie powstała, nie ma żądania do dostawcy i nie ma
 * wpisu w `email_logs`. Dowód „nic nie poszło” musi być liczbą wywołań, bo
 * każdy słabszy ślad (napis na ekranie, stan komponentu) przeszedłby także
 * przy implementacji udającej cofnięcie.
 *
 * ================== DLACZEGO REALNY KOMPONENT ==================
 *
 * Testowana jest PRAWDZIWA `StatusSelect` z prawdziwym adapterem selecta,
 * prawdziwą maszyną stanów z `@avably/core` i prawdziwym oknem dialogowym —
 * zamockowane są wyłącznie dwie akcje serwerowe (to jedyna granica, za którą
 * jest sieć i baza). Test powtarzający „logikę odliczania” obok komponentu
 * świeciłby na zielono nad kodem, którego nie dotyka.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FormState } from "@/lib/form-state";

import messages from "../messages/pl.json";

import { StatusSelect } from "@/app/[locale]/(panel)/zamowienia/[id]/status-select";

const ORDER_ID = "00000000-0000-4000-8000-0000000000f1";
const detail = messages.orders.detail;
const statusLabels = messages.orders.statusLabels.order;

/** Radix Select i Dialog wołają API, których jsdom nie implementuje. */
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

let changeStatus: ReturnType<typeof vi.fn>;
let sendEmail: ReturnType<typeof vi.fn>;

type MountOptions = {
  currentStatus?: "pending" | "reserved" | "ready_for_pickup" | "picked_up";
  paymentStatus?: "unpaid" | "paid";
  emailAvailability?: { available: boolean };
};

function mount(options: MountOptions = {}) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <StatusSelect
        changeStatus={changeStatus as never}
        sendEmail={sendEmail as never}
        orderId={ORDER_ID}
        currentStatus={options.currentStatus ?? "reserved"}
        paymentStatus={options.paymentStatus ?? "unpaid"}
        emailAvailability={options.emailAvailability ?? { available: true }}
      />
    </NextIntlClientProvider>,
  );
}

/** Klik + opróżnienie mikrozadań: akcje serwerowe są asynchroniczne. */
async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

/** Przesunięcie zegarów o `ms` — tak upływa okno na cofnięcie. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openDropdown() {
  await click(screen.getByRole("combobox"));
  return screen.getByRole("listbox");
}

/** Wybór statusu z dropdownu — dokładnie tą drogą, którą idzie operator. */
async function pickStatus(label: string) {
  const listbox = await openDropdown();
  await click(within(listbox).getByRole("option", { name: label }));
}

async function clickButton(name: string) {
  await click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  vi.useFakeTimers();
  changeStatus = vi.fn(async (): Promise<FormState> => ({ success: "changed" }));
  sendEmail = vi.fn(async () => ({}));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("dropdown statusu — lista przejść i bramki (N3)", () => {
  it("pokazuje WYŁĄCZNIE przejścia legalne wg canTransition", async () => {
    mount({ currentStatus: "reserved" });
    const listbox = await openDropdown();

    const labels = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent);

    // Z `reserved` maszyna stanów pozwala na trzy przejścia — i na nic więcej.
    // Gdyby dropdown wypisywał wszystkie statusy „bo to tylko lista”, operator
    // dostawałby pozycje kończące się odmową bazy.
    expect(labels.sort()).toEqual(
      [statusLabels.ready_for_pickup, statusLabels.pending, statusLabels.cancelled].sort(),
    );
    expect(labels).not.toContain(statusLabels.returned);
    expect(labels).not.toContain(statusLabels.picked_up);
  });

  it("anulowanie gaśnie przy blokującym payment_status, z podanym powodem", async () => {
    mount({ currentStatus: "reserved", paymentStatus: "paid" });
    const listbox = await openDropdown();

    const cancel = within(listbox).getByRole("option", { name: statusLabels.cancelled });
    expect(cancel.getAttribute("data-disabled")).not.toBeNull();
    // Wygaszona pozycja bez wyjaśnienia wyglądałaby jak usterka.
    expect(screen.getByText(detail.cancelBlockedHint)).toBeTruthy();
  });

  it("odmowa bramki bazy jest czytelna, a o wiadomość nikt nie pyta", async () => {
    // Trigger 0010 odmawia — dla tego ekranu to jedyna autorytatywna odpowiedź.
    changeStatus = vi.fn(async () => ({ formError: "To przejście statusu nie jest dozwolone." }));
    mount();

    await pickStatus(statusLabels.ready_for_pickup);

    expect(screen.getByRole("alert").textContent).toContain(
      "To przejście statusu nie jest dozwolone.",
    );
    // Nie ma czego zapowiadać klientowi: pytanie o wiadomość w ogóle nie pada.
    expect(screen.queryByText(detail.emailPromptTitle)).toBeNull();
    await advance(60_000);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("decyzja o wiadomości — status nie czeka na odpowiedź (ADR-075)", () => {
  it("zmiana statusu utrwala się PRZED pytaniem i niezależnie od niego", async () => {
    mount({ currentStatus: "reserved" });
    await pickStatus(statusLabels.ready_for_pickup);

    // Akcja tranzycji poszła od razu — okno dialogowe jest NASTĘPNYM krokiem,
    // nie warunkiem zapisu.
    expect(changeStatus).toHaveBeenCalledTimes(1);
    const formData = changeStatus.mock.calls[0]![1] as FormData;
    expect(formData.get("orderId")).toBe(ORDER_ID);
    expect(formData.get("to")).toBe("ready_for_pickup");
    expect(formData.get("expectedFrom")).toBe("reserved");
    // …i NIE niesie już decyzji o wysyłce: ta jest osobnym krokiem.
    expect(formData.get("sendEmail")).toBeNull();

    expect(screen.getByText(detail.emailPromptTitle)).toBeTruthy();
  });

  it("odmowa wysyłki nie cofa przejścia i NIE woła akcji wysyłki", async () => {
    mount();
    await pickStatus(statusLabels.ready_for_pickup);

    await clickButton(detail.emailPromptSkip);

    expect(screen.getByText(detail.emailSkipped)).toBeTruthy();
    // Ani teraz, ani po dowolnie długim czasie.
    await advance(60_000);
    expect(sendEmail).not.toHaveBeenCalled();
    // Tranzycja została zawołana dokładnie raz — odmowa niczego nie odkręca.
    expect(changeStatus).toHaveBeenCalledTimes(1);
  });

  it("przejście bez szablonu wiadomości w ogóle nie pyta o wysyłkę", async () => {
    // `pending` nie ma wpisu w TEMPLATE_FOR_STATUS — nie ma czego wysyłać.
    mount({ currentStatus: "reserved" });
    await pickStatus(statusLabels.pending);

    expect(changeStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(detail.emailPromptTitle)).toBeNull();
    await advance(60_000);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("niedostępna wysyłka: pytania nie ma, a powód stoi na ekranie", async () => {
    mount({ emailAvailability: { available: false } });
    // U1 (audyt W3): komunikat w całości ze słownika — neutralny, bez
    // powodu z serwera (nazw zmiennych platformy).
    expect(screen.getByText(detail.sendEmailUnavailable)).toBeTruthy();

    await pickStatus(statusLabels.ready_for_pickup);
    expect(changeStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(detail.emailPromptTitle)).toBeNull();
    await advance(60_000);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("okno na cofnięcie — ODROCZENIE, nie udawanie (ADR-075)", () => {
  async function chooseSend() {
    mount();
    await pickStatus(statusLabels.ready_for_pickup);
    await clickButton(detail.emailPromptSend);
    expect(screen.getByText(/Wiadomość do klienta wyjdzie za/)).toBeTruthy();
  }

  it("po decyzji „wyślij” akcja wysyłki NIE JEST wołana od razu", async () => {
    await chooseSend();

    // Sedno całego zadania. Gdyby wiadomość wychodziła natychmiast, a baner
    // tylko udawał odliczanie, ta asercja padłaby TU — zanim ktokolwiek
    // zdąży kliknąć „Anuluj”.
    expect(sendEmail).not.toHaveBeenCalled();

    await advance(9_000);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("anulowanie w trakcie odliczania znaczy, że wiadomość NIE POWSTAŁA", async () => {
    await chooseSend();
    await advance(4_000);

    await clickButton(detail.emailCountdownCancel);

    expect(screen.getByText(detail.emailCancelled)).toBeTruthy();
    // Zegar biegnie dalej — i nic się nie dzieje, bo nie ma czego wysłać.
    await advance(60_000);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(screen.queryByText(/Wiadomość do klienta wyjdzie za/)).toBeNull();
  });

  it("po pełnych 10 s wiadomość wychodzi DOKŁADNIE RAZ, z aktualnym statusem", async () => {
    await chooseSend();
    await advance(10_000);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith({ orderId: ORDER_ID, status: "ready_for_pickup" });
    expect(screen.getByText(detail.emailSent)).toBeTruthy();

    // Zegar biegnie dalej — powtórki nie ma.
    await advance(60_000);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("powód niewysłania z serwera trafia na ekran zamiast fałszywego „wysłano”", async () => {
    sendEmail = vi.fn(async () => ({
      problem: "Zamówienie nie ma adresu e-mail klienta — wiadomość nie została wysłana.",
    }));
    await chooseSend();
    await advance(10_000);

    expect(
      screen.getByText(
        "Zamówienie nie ma adresu e-mail klienta — wiadomość nie została wysłana.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(detail.emailSent)).toBeNull();
  });

  it("odliczanie ostrzega, że opuszczenie strony przerywa wysyłkę", async () => {
    await chooseSend();
    // Rozstrzygnięcie ADR-075 musi stać W INTERFEJSIE, zanim operator zamknie
    // kartę — nie w dokumentacji, do której nie zajrzy.
    expect(screen.getByText(detail.emailCountdownLeaveWarning)).toBeTruthy();
  });

  it("opuszczenie ekranu w trakcie odliczania NIE wysyła wiadomości", async () => {
    await chooseSend();
    await advance(3_000);

    cleanup(); // odmontowanie = przejście na inny ekran panelu

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    // Świadoma decyzja ADR-075: odroczenie żyje w tej karcie. „Wyślij na
    // wszelki wypadek przy odmontowaniu” zamieniałoby każde przemontowanie
    // komponentu w cichą wysyłkę PRZED końcem odliczania.
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("nowa zmiana statusu w trakcie odliczania anuluje poprzednią wysyłkę", async () => {
    await chooseSend();
    await advance(3_000);

    // Wiadomość o poprzednim statusie przestała być prawdziwa — nie może
    // wyjść „w tle” po kolejnej zmianie.
    await pickStatus(statusLabels.cancelled);
    await advance(60_000);

    expect(changeStatus).toHaveBeenCalledTimes(2);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
