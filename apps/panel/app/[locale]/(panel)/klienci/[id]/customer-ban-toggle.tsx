"use client";

/**
 * Przełącznik ban / unban na karcie klienta (R6b, ADR-080).
 *
 * Stan „zablokowany" jest WYRAŹNY: badge (destructive / secondary) + zdanie
 * o skutku. Sama zmiana stanu wymaga POTWIERDZENIA w oknie dialogowym — ban to
 * decyzja, która odcina klientowi checkout, więc nie dzieje się jednym
 * przypadkowym kliknięciem.
 *
 * `banned` przychodzi z SERWERA (karta czyta customer_bans pod RLS). Akcja jest
 * związana server-side na stan PRZECIWNY (bind(null, id, !banned)); po sukcesie
 * revalidatePath odświeża RSC i komponent dostaje nowy `banned`. Zamykamy okno
 * WYŁĄCZNIE na potwierdzonym sukcesie (wzorzec deposit-refund-modal).
 *
 * Stany wg konwencji: loading={pending} disabled={pending} na przycisku (R2),
 * błąd jako role=alert (a11y).
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

export function CustomerBanToggle({
  banned,
  action,
}: {
  banned: boolean;
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("customers.card.ban");
  const [open, setOpen] = useState(false);

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
      data-customer-ban
      data-banned={banned ? "true" : "false"}
      className="border-border bg-card flex flex-col gap-4 rounded-md border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
              {t("heading")}
            </h2>
            <Badge
              data-customer-ban-badge
              variant={banned ? "destructive" : "secondary"}
            >
              {banned ? t("statusBanned") : t("statusActive")}
            </Badge>
          </div>
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {banned ? t("descriptionBanned") : t("descriptionActive")}
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              data-customer-ban-cta
              variant={banned ? "outline" : "destructive"}
            >
              {banned ? t("unblockCta") : t("blockCta")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{banned ? t("confirmUnblockTitle") : t("confirmBlockTitle")}</DialogTitle>
              <DialogDescription>
                {banned ? t("confirmUnblockBody") : t("confirmBlockBody")}
              </DialogDescription>
            </DialogHeader>

            <form action={formAction} className="flex flex-col gap-4">
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
                  data-customer-ban-confirm
                  variant={banned ? "default" : "destructive"}
                  loading={pending}
                  disabled={pending}
                >
                  {banned ? t("confirmUnblock") : t("confirmBlock")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {state.success === "banned" ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("blockedNotice")}
        </p>
      ) : null}
      {state.success === "unbanned" ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("unblockedNotice")}
        </p>
      ) : null}
    </section>
  );
}
