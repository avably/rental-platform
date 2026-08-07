"use client";

/**
 * POTWIERDZENIE PUBLIKACJI WERSJI STRONY (0048, ADR-093) — jeden dialog na obie
 * powierzchnie: listę wersji (`site-pages.tsx`) i kreator (`site-builder.tsx`).
 *
 * Wydzielony z listy wersji przy L6 (audyt E2E 2026-08-07): kreator publikował
 * BEZ potwierdzenia, więc operator gasił żywą wersję bez jednego zdania
 * ostrzeżenia — a z listy z pełnym. Dialog jest JEDEN, żeby treść ostrzeżenia
 * nie mogła się rozjechać między drogami do tej samej operacji.
 *
 * Treść mówi o SKUTKU dla sklepu, a nie o czynności: operator, który
 * przełącza wersję, musi wiedzieć, że dotychczasowa strona przestanie być
 * publiczna — i że nie znika z panelu.
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
  liveName,
  onConfirm,
  trigger,
}: {
  disabled: boolean;
  /** Czy TA wersja jest już w sklepie — wtedy publikacja jest odświeżeniem, nie przełączeniem. */
  live: boolean;
  name: string;
  liveName: string | null;
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
            {live
              ? t("pages.switchBodySelf")
              : liveName
                ? t("pages.switchBody", { previous: liveName })
                : t("pages.switchBodyFirst")}
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
