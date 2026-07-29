"use client";

/**
 * Notatki zamówienia jako LISTA WPISÓW (uwaga właściciela, runda 2026-07-28:
 * „notatki powinny być listą — treść, data — każda kolejna zapisana trafia do
 * listy, nie do uzupełnianego inputa"). ADR-079.
 *
 * Trzy operacje, trzy akcje serwerowe (notes-actions.ts): dodanie nowego wpisu
 * na górze listy, edycja inline istniejącego, twarde usunięcie z
 * potwierdzeniem. Każdy wpis niesie AUTORA (członka zespołu; wpis historyczny
 * przeniesiony z orders.notes pokazuje „—") i DATĘ powstania.
 *
 * Data jest sformatowana NA SERWERZE (page.tsx, jak znaczniki rejestru kaucji)
 * i wchodzi gotowym stringiem — komponent kliencki nie dubluje logiki strefy
 * czasowej. Autor też przychodzi rozwiązany (e-mail albo null → „—").
 *
 * Każdy wpis to własny <NoteItem> z WŁASNYM useActionState edycji i usunięcia:
 * hooki są stabilne w obrębie instancji, więc lista komponentów (po key=id)
 * jest legalna, a stan „edytuję / potwierdzam usunięcie" jest lokalny dla
 * wiersza, nie globalny dla sekcji.
 */
import { Button, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import type { FormState } from "@/lib/form-state";

type NoteAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

export interface OrderNoteEntry {
  id: string;
  body: string;
  /** E-mail autora (członka zespołu) albo null dla wpisu historycznego. */
  author: string | null;
  /** Data powstania, sformatowana na serwerze do locale/strefy tenanta. */
  createdAtLabel: string;
}

export function OrderNotes({
  orderId,
  notes,
  addAction,
  editAction,
  deleteAction,
}: {
  orderId: string;
  notes: OrderNoteEntry[];
  addAction: NoteAction;
  editAction: NoteAction;
  deleteAction: NoteAction;
}) {
  const t = useTranslations("orders.notes");

  return (
    <div className="flex flex-col gap-4">
      <AddNoteForm orderId={orderId} action={addAction} />

      {notes.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              editAction={editAction}
              deleteAction={deleteAction}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pole dodania nowego wpisu — czyści się po udanym zapisie. */
function AddNoteForm({ orderId, action }: { orderId: string; action: NoteAction }) {
  const t = useTranslations("orders.notes");
  const [value, setValue] = useState("");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      if (result.success) setValue("");
      return result;
    },
    {},
  );

  const fieldError = state.fieldErrors?.body;
  const empty = value.trim() === "";

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Label htmlFor="new-note">{t("addLabel")}</Label>
      <Textarea
        id="new-note"
        name="body"
        rows={3}
        maxLength={10000}
        placeholder={t("placeholder")}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={pending}
        aria-invalid={fieldError ? true : undefined}
      />
      {fieldError ? (
        <p role="alert" className="text-destructive text-sm">
          {fieldError}
        </p>
      ) : null}
      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" loading={pending} disabled={pending || empty}>
          {t("addCta")}
        </Button>
      </div>
    </form>
  );
}

/** Jeden wpis: odczyt → edycja inline → potwierdzenie usunięcia. */
function NoteItem({
  note,
  editAction,
  deleteAction,
}: {
  note: OrderNoteEntry;
  editAction: NoteAction;
  deleteAction: NoteAction;
}) {
  const t = useTranslations("orders.notes");
  const [mode, setMode] = useState<"view" | "edit" | "confirmDelete">("view");
  const [editValue, setEditValue] = useState(note.body);

  const [editState, editFormAction, editPending] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await editAction(prev, formData);
      if (result.success) setMode("view");
      return result;
    },
    {},
  );
  const [deleteState, deleteFormAction, deletePending] = useActionState<FormState, FormData>(
    deleteAction,
    {},
  );

  /** Wejście w tryb edycji resetuje pole do bieżącej treści (bez porzuconego szkicu). */
  const openEdit = () => {
    setEditValue(note.body);
    setMode("edit");
  };

  const editError = editState.fieldErrors?.body ?? editState.formError;
  const unchanged = editValue.trim() === note.body.trim();
  const emptyEdit = editValue.trim() === "";

  return (
    <li className="border-border bg-background rounded-md border p-3">
      {mode === "edit" ? (
        <form action={editFormAction} className="flex flex-col gap-2">
          <input type="hidden" name="noteId" value={note.id} />
          <Label htmlFor={`note-edit-${note.id}`} className="sr-only">
            {t("editLabel")}
          </Label>
          <Textarea
            autoFocus
            id={`note-edit-${note.id}`}
            name="body"
            rows={3}
            maxLength={10000}
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            disabled={editPending}
            aria-invalid={editError ? true : undefined}
          />
          {editError ? (
            <p role="alert" className="text-destructive text-sm">
              {editError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              loading={editPending}
              disabled={editPending || emptyEdit || unchanged}
            >
              {t("save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={editPending}
              onClick={() => setMode("view")}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm break-words whitespace-pre-wrap">{note.body}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              <span>{note.author ?? t("authorUnknown")}</span>
              <span className="mx-1.5">·</span>
              <span className="tabular-nums">{note.createdAtLabel}</span>
            </p>
            {mode === "confirmDelete" ? (
              <form action={deleteFormAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="noteId" value={note.id} />
                <span role="alert" className="text-muted-foreground text-xs">
                  {t("deleteConfirm")}
                </span>
                <Button
                  type="submit"
                  size="sm"
                  variant="destructive"
                  loading={deletePending}
                  disabled={deletePending}
                >
                  {t("delete")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={deletePending}
                  onClick={() => setMode("view")}
                >
                  {t("cancel")}
                </Button>
              </form>
            ) : (
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={openEdit}>
                  {t("edit")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setMode("confirmDelete")}
                >
                  {t("delete")}
                </Button>
              </div>
            )}
          </div>
          {deleteState.formError ? (
            <p role="alert" className="text-destructive text-sm">
              {deleteState.formError}
            </p>
          ) : null}
        </div>
      )}
    </li>
  );
}
