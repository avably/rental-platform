"use client";

/**
 * Podgląd treści wysłanej wiadomości (uwaga właściciela D10, ADR-073).
 *
 * ============== DLACZEGO TREŚĆ STOI W IZOLOWANEJ RAMCE ==============
 *
 * To, co tu wchodzi, jest HTML-em ZAPISANYM W BAZIE, a jego fragmenty
 * pochodzą od klienta (imię i nazwisko, adres, nazwa firmy, uwagi do
 * zamówienia). Wstrzyknięcie go w drzewo panelu — `dangerouslySetInnerHTML`
 * — czyniłoby z historii wiadomości wektor trwałego XSS-a na EKRANIE
 * OPERATORA, z sesją członka tenanta w tle. Nie bronilibyśmy się przed tym
 * „sprawdzeniem, czy szablony escapują": to byłaby obrona przez uważność,
 * przy każdym przyszłym szablonie od nowa.
 *
 * `<iframe srcDoc>` z PUSTYM `sandbox` odbiera treści wszystko naraz:
 * skrypty, formularze, nawigację, dostęp do `window.parent` i do tego samego
 * originu. Nawet HTML z aktywnym ładunkiem jest tam obrazkiem — a to jest
 * własność KONSTRUKCJI, nie skutek poprawnego escapowania po drugiej
 * stronie. Ta sama ramka jest poprawna w Safari (właściciel testuje tam,
 * a przeglądarka in-app to Chromium): `srcdoc` i `sandbox` to atrybuty
 * HTML-a, nie zachowanie zależne od silnika.
 *
 * ============== TREŚĆ SCHODZI DOPIERO NA KLIK ==============
 *
 * Wpis nie niesie treści z serwera — pobiera ją akcja `loadEmailBodyAction`
 * po otwarciu okna (uzasadnienie w tamtym pliku). Skutek uboczny jest
 * pożądany: dane osobowe z korespondencji nie leżą w źródle każdego
 * otwartego zamówienia.
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
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { EmailBodyResult } from "./email-body-actions";

type LoadBody = (input: { logId: string; orderId: string }) => Promise<EmailBodyResult>;

export function EmailPreviewModal({
  logId,
  orderId,
  subject,
  load,
}: {
  logId: string;
  orderId: string;
  subject: string;
  load: LoadBody;
}) {
  const t = useTranslations("emailLog");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<EmailBodyResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    // Za każdym otwarciem czytamy od nowa. Rejestr jest append-only, więc
    // treść się nie zmienia — ale trzymanie jej w stanie komponentu po
    // zamknięciu okna zostawiałoby cudzą korespondencję w pamięci karty
    // bez powodu.
    setResult(null);
    setLoading(true);
    try {
      setResult(await load({ logId, orderId }));
    } catch {
      setResult({ status: "error", message: t("previewFailed") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {t("previewButton")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("previewTitle")}</DialogTitle>
          {/* Temat w opisie okna, a nie w tytule: tytuł nazywa CZYNNOŚĆ,
              temat jest danymi wiadomości i bywa długi. */}
          <DialogDescription className="break-words">{subject}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("previewLoading")}</p>
        ) : null}

        {!loading && result?.status === "body" ? (
          <>
            <iframe
              // `key` per wpis: bez niego Safari potrafi zostawić w ramce
              // poprzedni dokument, gdy zmienia się samo `srcDoc`.
              key={logId}
              title={t("previewFrameTitle")}
              srcDoc={result.html}
              sandbox=""
              className="bg-background h-96 w-full rounded-md border"
            />
            <p className="text-xs text-muted-foreground">{t("previewSandboxNote")}</p>
          </>
        ) : null}

        {!loading && result?.status === "missing" ? (
          <p className="text-sm text-muted-foreground">{t("bodyUnavailable")}</p>
        ) : null}

        {!loading && result?.status === "error" ? (
          <p className="text-sm text-destructive">{result.message}</p>
        ) : null}

        {/* Własny przycisk, nie `showCloseButton` z DialogFooter: tamten ma
            etykietę wpisaną na sztywno po polsku, a ten ekran ma parytet
            EN↔PL (wzorzec z deposit-refund-modal.tsx). */}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("previewClose")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
