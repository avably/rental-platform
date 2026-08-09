"use client";

/**
 * Realizacja żądania usunięcia danych klienta z karty — art. 17 RODO
 * (C2b, ADR-116).
 *
 * OPERACJA JEST NIEODWRACALNA, więc potwierdzenie nie jest przyciskiem „OK":
 * operator PRZEPISUJE adres e-mail klienta. Wzorzec porównuje serwer, z wiersza
 * w bazie — pole nie niesie prawdy, tylko intencję. Dzięki temu pomyłka o jedną
 * kartę (dwie otwarte zakładki, złe kliknięcie z listy) nie kończy się
 * usunięciem cudzych danych.
 *
 * Sekcja jest widoczna WYŁĄCZNIE dla właściciela organizacji — ta sama granica,
 * co w bazie (`app.erase_customer` odbija zwykłego członka kodem 42501). Ukryty
 * przycisk nie jest zabezpieczeniem; jest zgodnością widoku z prawdą, żeby
 * członek nie klikał w operację, która i tak mu odmówi.
 *
 * Treść mówi WPROST, co zniknie, a co zostanie — bo to jedyne miejsce, w którym
 * operator dowiaduje się, że notatki do zamówień tego klienta przepadną,
 * a rozliczenia i historia zamówień zostaną (obowiązek podatkowy).
 *
 * Stany wg konwencji: loading={pending} disabled={pending} na przycisku
 * potwierdzenia, błąd jako role=alert.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import type { FormState } from "@/lib/form-state";

export function CustomerErasure({
  email,
  action,
}: {
  email: string;
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("customers.card.erasure");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      // Zamykamy WYŁĄCZNIE na potwierdzonym sukcesie (wzorzec przełącznika
      // bana): przy odmowie okno zostaje z komunikatem przy polu.
      if (result.success) {
        setOpen(false);
        setTyped("");
      }
      return result;
    },
    {},
  );

  const confirmationError = state.fieldErrors?.confirmation;

  return (
    <section
      data-customer-erasure
      className="border-destructive/40 bg-card flex flex-col gap-4 rounded-md border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
            {t("heading")}
          </h2>
          <p className="text-muted-foreground text-[13px] leading-[18px]">{t("description")}</p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">{t("scope")}</p>
        </div>

        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setTyped("");
          }}
        >
          <DialogTrigger asChild>
            <Button type="button" data-customer-erasure-cta variant="destructive">
              {t("cta")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("confirmTitle")}</DialogTitle>
              <DialogDescription>{t("confirmBody")}</DialogDescription>
            </DialogHeader>

            <form action={formAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-erasure-confirmation">
                  {t("confirmLabel", { email })}
                </Label>
                <Input
                  id="customer-erasure-confirmation"
                  name="confirmation"
                  data-customer-erasure-input
                  autoComplete="off"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  aria-invalid={confirmationError ? true : undefined}
                  aria-describedby={confirmationError ? "customer-erasure-error" : undefined}
                />
                {confirmationError ? (
                  <p
                    id="customer-erasure-error"
                    role="alert"
                    className="text-destructive text-[13px] leading-[18px] font-medium"
                  >
                    {confirmationError}
                  </p>
                ) : null}
              </div>

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
                  data-customer-erasure-confirm
                  variant="destructive"
                  loading={pending}
                  disabled={pending || typed.trim().length === 0}
                >
                  {t("confirm")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {state.success === "erased" ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("done")}
        </p>
      ) : null}
    </section>
  );
}
