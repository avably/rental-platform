// @vitest-environment jsdom

/**
 * Notatki zamówienia jako LISTA WPISÓW (ADR-079) — kontrakt renderowania.
 * Mechanikę zapisu (RLS, autor, odczyt-po-zapisie) dowodzi order-notes.test.ts
 * na żywym Supabase; TU pilnujemy warstwy klienta:
 *
 *  1. lista pokazuje treść, AUTORA i DATĘ każdego wpisu; wpis bez autora → „—";
 *  2. pusta lista pokazuje komunikat „brak notatek", a nie znika bez śladu;
 *  3. dodanie: przycisk wygaszony przy pustym polu, submit niesie orderId+body;
 *  4. edycja inline: „Edytuj" odsłania treść w polu, submit niesie noteId+body;
 *  5. usunięcie WYMAGA potwierdzenia: pierwszy „Usuń" tylko odsłania pytanie,
 *     dopiero potwierdzenie woła akcję z noteId.
 *
 * Dowód mutacyjny (opis w raporcie): usunięcie kroku potwierdzenia (klik „Usuń"
 * od razu submituje) → test „usunięcie wymaga potwierdzenia" czerwony.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OrderNotes,
  type OrderNoteEntry,
} from "@/app/[locale]/(panel)/zamowienia/[id]/order-notes";
import type { FormState } from "@/lib/form-state";

const messages = {
  orders: {
    notes: {
      addLabel: "Dodaj notatkę",
      placeholder: "np. porysowany kabel…",
      addCta: "Dodaj notatkę",
      empty: "Brak notatek.",
      authorUnknown: "—",
      editLabel: "Treść notatki",
      edit: "Edytuj",
      save: "Zapisz",
      cancel: "Anuluj",
      delete: "Usuń",
      deleteConfirm: "Usunąć tę notatkę? Tej operacji nie można cofnąć.",
      added: "Notatka dodana.",
      edited: "Notatka zapisana.",
      deleted: "Notatka usunięta.",
    },
  },
};

const ORDER_ID = "11111111-2222-4333-8444-555555555555";

const entries: OrderNoteEntry[] = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    body: "Kabel porysowany.",
    author: "anna@wypozyczalnia.pl",
    createdAtLabel: "29.07.2026, 12:34",
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    body: "Notatka historyczna.",
    author: null,
    createdAtLabel: "01.07.2026, 09:00",
  },
];

const ok = async (_prev: FormState, _formData: FormData): Promise<FormState> => ({ success: "ok" });

function renderNotes(
  props: Partial<{
    notes: OrderNoteEntry[];
    addAction: (p: FormState, f: FormData) => Promise<FormState>;
    editAction: (p: FormState, f: FormData) => Promise<FormState>;
    deleteAction: (p: FormState, f: FormData) => Promise<FormState>;
  }> = {},
) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <OrderNotes
        orderId={ORDER_ID}
        notes={props.notes ?? entries}
        addAction={props.addAction ?? ok}
        editAction={props.editAction ?? ok}
        deleteAction={props.deleteAction ?? ok}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("OrderNotes — lista wpisów", () => {
  it("pokazuje treść, autora i datę wpisu; wpis bez autora dostaje myślnik", () => {
    renderNotes();
    expect(screen.getByText("Kabel porysowany.")).toBeTruthy();
    expect(screen.getByText("anna@wypozyczalnia.pl")).toBeTruthy();
    expect(screen.getByText("29.07.2026, 12:34")).toBeTruthy();
    expect(screen.getByText("Notatka historyczna.")).toBeTruthy();
    // Wpis historyczny (author null) pokazuje myślnik.
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("pusta lista pokazuje komunikat zamiast znikać", () => {
    renderNotes({ notes: [] });
    expect(screen.getByText("Brak notatek.")).toBeTruthy();
  });
});

describe("OrderNotes — dodanie", () => {
  it("wygasza przycisk przy pustym polu i niesie orderId+body do akcji", async () => {
    const addAction = vi.fn(ok);
    renderNotes({ addAction });

    const addButton = screen.getByRole("button", { name: "Dodaj notatkę" });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);

    const textarea = screen.getByLabelText("Dodaj notatkę") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Zwrot bez uwag." } });
    expect((addButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.submit(textarea.closest("form")!);

    await waitFor(() => expect(addAction).toHaveBeenCalledTimes(1));
    const formData = addAction.mock.calls[0]![1] as FormData;
    expect(formData.get("orderId")).toBe(ORDER_ID);
    expect(formData.get("body")).toBe("Zwrot bez uwag.");
  });
});

describe("OrderNotes — edycja inline", () => {
  it("edycja odsłania treść w polu, a zapis niesie noteId i nową treść", async () => {
    const editAction = vi.fn(ok);
    renderNotes({ editAction });

    const firstItem = screen.getByText("Kabel porysowany.").closest("li")!;
    fireEvent.click(within(firstItem).getByRole("button", { name: "Edytuj" }));

    const editArea = within(firstItem).getByLabelText("Treść notatki") as HTMLTextAreaElement;
    expect(editArea.value).toBe("Kabel porysowany.");
    fireEvent.change(editArea, { target: { value: "Kabel wymieniony." } });
    fireEvent.submit(editArea.closest("form")!);

    await waitFor(() => expect(editAction).toHaveBeenCalledTimes(1));
    const formData = editAction.mock.calls[0]![1] as FormData;
    expect(formData.get("noteId")).toBe(entries[0]!.id);
    expect(formData.get("body")).toBe("Kabel wymieniony.");
  });
});

describe("OrderNotes — usunięcie z potwierdzeniem", () => {
  it("pierwszy klik tylko pyta; akcja rusza dopiero po potwierdzeniu", async () => {
    const deleteAction = vi.fn(ok);
    renderNotes({ deleteAction });

    const firstItem = screen.getByText("Kabel porysowany.").closest("li")!;
    fireEvent.click(within(firstItem).getByRole("button", { name: "Usuń" }));

    // Krok potwierdzenia: pytanie widoczne, akcja jeszcze NIE wywołana.
    expect(within(firstItem).getByText("Usunąć tę notatkę? Tej operacji nie można cofnąć.")).toBeTruthy();
    expect(deleteAction).not.toHaveBeenCalled();

    // Potwierdzenie — teraz akcja rusza z noteId.
    const confirmForm = within(firstItem)
      .getByText("Usunąć tę notatkę? Tej operacji nie można cofnąć.")
      .closest("form")!;
    fireEvent.submit(confirmForm);

    await waitFor(() => expect(deleteAction).toHaveBeenCalledTimes(1));
    const formData = deleteAction.mock.calls[0]![1] as FormData;
    expect(formData.get("noteId")).toBe(entries[0]!.id);
  });
});
