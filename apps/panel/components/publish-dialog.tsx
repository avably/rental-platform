"use client";

/**
 * POTWIERDZENIE PUBLIKACJI STRONY (0048, ADR-093) — jeden dialog na obie
 * powierzchnie: listę stron (`site-pages.tsx`) i kreator (`site-builder.tsx`).
 *
 * Wydzielony z listy przy L6 (audyt E2E 2026-08-07): kreator publikował BEZ
 * potwierdzenia, a z listy szło pełne. Dialog jest JEDEN, żeby treść nie mogła
 * się rozjechać między dwiema drogami do tej samej operacji.
 *
 * ================ CO PUBLIKACJA ROBI PO FAZIE 2 (ADR-165) ================
 *
 * Do 0073 wiersz `sites` był WERSJĄ jednej strony, więc publikacja PRZEŁĄCZAŁA
 * sklep i gasiła dotychczasową żywą wersję — i dokładnie to zdanie stało tutaj.
 * Od 0074 publikacja NIE GASI NIKOGO (ADR-158 D5): strony współistnieją, każda
 * pod własnym adresem. Ostrzeżenie przed wygaszeniem opisywało więc skutek,
 * który nie następuje, a wraz z nim zniknął props `liveName` — „którą stronę
 * zgasi ta publikacja" jest pytaniem bez odpowiedzi i nie ma prawa wrócić jako
 * pole, które ktoś kiedyś wypełni.
 *
 * Zostają DWA zdania, bo zostały dwa różne skutki:
 *   • strona ŻYWA — klienci ją już widzą, publikacja wypuszcza do nich zmiany;
 *   • strona ROBOCZA — pojawi się pod SWOIM adresem, reszta sklepu bez zmian.
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
import type { ReactNode } from "react";

export function PublishDialog({
  disabled,
  live,
  name,
  address,
  onConfirm,
  trigger,
}: {
  disabled: boolean;
  /** Czy TĘ stronę klienci już widzą — wtedy publikacja jest odświeżeniem. */
  live: boolean;
  name: string;
  /**
   * ADRES, pod którym strona stanie w sklepie — gotowa ścieżka z
   * `pagePathFromSlug` (`/` dla strony głównej). To jedyna rzecz, która po
   * fazie 2 odróżnia jedną publikację od drugiej, więc operator musi ją
   * zobaczyć ZANIM kliknie: w kreatorze adresu nie widać nigdzie indziej.
   */
  address: string;
  onConfirm: () => void;
  /**
   * Własny przycisk otwierający (asChild) — kreator podaje swój primary z
   * `data-builder-publish` i stanem oczekiwania, lista zostaje przy domyślnym.
   * Parametryzowany jest WYŁĄCZNIE wygląd wejścia; treść ostrzeżenia i droga
   * potwierdzenia są wspólne z konstrukcji.
   */
  trigger?: ReactNode;
}) {
  const t = useTranslations("site");

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" size="sm" variant="secondary" disabled={disabled} data-publish-site>
            {t("publish.publish")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.switchTitle", { name })}</DialogTitle>
          <DialogDescription>
            {live ? t("pages.switchBodySelf") : t("pages.switchBodyNew", { address })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("pages.switchDraftNote")}</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" data-publish-site-confirm onClick={onConfirm}>
              {t("publish.publish")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
