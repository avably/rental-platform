"use client";

/**
 * Wybór pliku faktury i JAWNA decyzja o wysyłce (D3, ADR-033/ADR-076).
 *
 * ============== DLACZEGO OKNO, A NIE PRZYCISK NA KARCIE ==============
 *
 * ADR-033 wymaga, żeby wysyłka do klienta była decyzją operatora, a nie
 * skutkiem ubocznym kliknięcia. Sam `<input type="file">` z automatycznym
 * wysłaniem po wyborze pliku spełniałby literę („operator wybrał plik"),
 * ale nie sens: wybór pliku w oknie systemowym kończy się jednym Enterem
 * i nie pokazuje ADRESATA. Okno pokazuje jedno i drugie — plik i e-mail
 * klienta — i dopiero pod tym stoi przycisk wysyłki.
 *
 * ODLICZANIA Z COFNIĘCIEM TU NIE MA i to jest decyzja, nie przeoczenie.
 * Wzorzec z ADR-075 istnieje dla wysyłek, które są SKUTKIEM czegoś innego
 * (zmiana statusu) i zaskakują operatora tuż po tym, jak zrobił coś
 * zupełnie innego. Tutaj wysyłka jest jedyną rzeczą, po którą się przyszło:
 * operator otworzył okno, wskazał plik ze swojego dysku i przeczytał adres.
 * Drugie potwierdzenie po tych trzech krokach nie dodaje informacji — dodaje
 * mechanikę, przez którą trzeba się przeklikać.
 *
 * ============== BRAMKA PO STRONIE PRZEGLĄDARKI JEST DRUGA, NIE PIERWSZA ==============
 *
 * Rozmiar i typ sprawdzamy też tutaj — po to, żeby operator dostał odpowiedź
 * NATYCHMIAST, zamiast czekać na przesłanie 30-megabajtowego pliku, który
 * i tak zostanie odrzucony. Bramką autorytatywną pozostaje akcja serwerowa
 * (`invoice-actions.ts`): ta kopia jest wygodą, nie zabezpieczeniem, i nie
 * wolno na niej niczego opierać.
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
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";

import type { FormState } from "@/lib/form-state";

import {
  INVOICE_MAX_MB,
  INVOICE_MIME_TYPE,
  checkInvoiceFile,
  type InvoiceFileProblem,
} from "./invoice-email";

type SendAction = (previous: FormState, formData: FormData) => Promise<FormState>;

/** Rozmiar pliku w jednostce, w której operator go widzi w systemie. */
function formatSize(bytes: number, locale: string): string {
  const mb = bytes / (1024 * 1024);
  const value = mb >= 0.1 ? mb : bytes / 1024;
  const unit = mb >= 0.1 ? "MB" : "kB";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

export function InvoiceDialog({
  orderId,
  customerEmail,
  action,
  resend,
}: {
  orderId: string;
  customerEmail: string;
  action: SendAction;
  resend: boolean;
}) {
  const t = useTranslations("orders.invoice");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [localProblem, setLocalProblem] = useState<InvoiceFileProblem | null>(null);
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const fieldId = useId();

  function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPicked(file ? { name: file.name, size: file.size } : null);
    setLocalProblem(file ? checkInvoiceFile(file) : null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Zamknięcie okna czyści wybór: otwarte po raz drugi z zapamiętanym
    // plikiem sugerowałoby, że wyśle TAMTEN — a input i tak jest już pusty.
    if (!next) {
      setPicked(null);
      setLocalProblem(null);
    }
  }

  const problemMessage =
    localProblem === "size"
      ? t("errors.size", { limit: INVOICE_MAX_MB })
      : localProblem === "type"
        ? t("errors.type")
        : localProblem === "empty"
          ? t("errors.empty")
          : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {resend ? t("sendAgain") : t("send")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          {/* Adresat w opisie okna: to jedyna rzecz, której operator nie
              wybiera i której nie może potem odkręcić. */}
          <DialogDescription className="break-all">
            {t("dialogRecipient", { email: customerEmail })}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="orderId" value={orderId} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId}>{t("fileLabel")}</Label>
            <Input
              id={fieldId}
              name="file"
              type="file"
              accept={INVOICE_MIME_TYPE}
              required
              onChange={handlePick}
              aria-describedby={`${fieldId}-hint`}
            />
            <p id={`${fieldId}-hint`} className="text-muted-foreground text-xs">
              {t("fileHint", { limit: INVOICE_MAX_MB })}
            </p>
          </div>

          {picked ? (
            <p className="text-muted-foreground text-xs break-all">
              {picked.name} · {formatSize(picked.size, locale)}
            </p>
          ) : null}

          {/* Ten sam ekran mówi WPROST, czego nie robimy: PDF-a nie
              zostawiamy u siebie. Bez tego zdania historia wysyłek czytałaby
              się jak archiwum faktur, którym nie jest (ADR-076). */}
          <p className="text-muted-foreground text-xs">{t("noArchiveNote")}</p>

          {problemMessage ? (
            <p role="alert" className="text-destructive text-sm">
              {problemMessage}
            </p>
          ) : null}
          {state.formError ? (
            <p role="alert" className="text-destructive text-sm">
              {state.formError}
            </p>
          ) : null}
          {state.success ? (
            <p className="text-status-positive-fg text-sm">{state.success}</p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !picked || localProblem !== null}>
              {pending ? t("sending") : t("confirmSend")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
