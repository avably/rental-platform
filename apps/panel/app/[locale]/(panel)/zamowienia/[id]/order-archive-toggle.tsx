"use client";

/**
 * Karta archiwizacji SOFT zamówienia na szczególe (ADR-242).
 *
 * Stan „zarchiwizowane" jest WYRAŹNY: badge + zdanie o skutku. Sama zmiana
 * wymaga POTWIERDZENIA w oknie dialogowym — archiwizacja zdejmuje zamówienie
 * z aktywnej listy, więc nie dzieje się jednym przypadkowym kliknięciem.
 * Operacja jest ODWRACALNA (Przywróć), więc — inaczej niż usunięcie klienta —
 * nie jest „strefą krytyczną" o destrukcyjnym tonie.
 *
 * `archived` przychodzi z SERWERA (szczegół czyta orders.archived_at pod RLS).
 * Wybieramy akcję na podstawie STANU (archiwizuj vs przywróć); `orderId` jedzie
 * ukrytym polem — akcja czyta go z FormData i zawęża tenant-scope z sesji, a
 * `.select()` po UPDATE zamienia „zero wierszy" w czytelną odmowę. Po sukcesie
 * `revalidatePath` odświeża RSC i komponent dostaje nowe `archived`; okno
 * zamykamy WYŁĄCZNIE na potwierdzonym sukcesie (wzorzec CustomerBanToggle).
 */
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import type { FormState } from "@/lib/form-state";

export function OrderArchiveToggle({
  orderId,
  archived,
  archiveAction,
  restoreAction,
}: {
  orderId: string;
  archived: boolean;
  archiveAction: (prevState: FormState, formData: FormData) => Promise<FormState>;
  restoreAction: (prevState: FormState, formData: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("orders.detail.archive");
  const [open, setOpen] = useState(false);

  const action = archived ? restoreAction : archiveAction;
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      if (result.success) setOpen(false);
      return result;
    },
    {},
  );

  return (
    <section
      data-order-archive
      data-archived={archived ? "true" : "false"}
      className="border-border bg-card flex flex-col gap-4 rounded-md border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
              {t("heading")}
            </h2>
            <Badge data-order-archive-badge variant={archived ? "outline" : "secondary"}>
              {archived ? t("statusArchived") : t("statusActive")}
            </Badge>
          </div>
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {archived ? t("descriptionArchived") : t("descriptionActive")}
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" data-order-archive-cta variant="outline">
              {archived ? t("restoreCta") : t("archiveCta")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{archived ? t("confirmRestoreTitle") : t("confirmArchiveTitle")}</DialogTitle>
              <DialogDescription>
                {archived ? t("confirmRestoreBody") : t("confirmArchiveBody")}
              </DialogDescription>
            </DialogHeader>

            <form action={formAction} className="flex flex-col gap-4">
              <input type="hidden" name="orderId" value={orderId} />
              {state.formError ? (
                <p role="alert" className="text-destructive text-sm">
                  {state.formError}
                </p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={pending}>
                    {t("cancel")}
                  </Button>
                </DialogClose>
                <Button
                  type="submit"
                  data-order-archive-confirm
                  variant="default"
                  loading={pending}
                  disabled={pending}
                >
                  {archived ? t("confirmRestore") : t("confirmArchive")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {state.success === "archived" ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("archivedNotice")}
        </p>
      ) : null}
      {state.success === "restored" ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("restoredNotice")}
        </p>
      ) : null}
    </section>
  );
}
