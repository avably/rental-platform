"use client";

/**
 * LISTA WERSJI STRONY (0048, ADR-093) — ekran, który zastąpił launcher.
 *
 * Ekran odpowiada na trzy pytania i na nic więcej: KTÓRĄ wersję widzi klient,
 * nad czym operator pracuje, i co można z każdą wersją zrobić. Formularzy tu
 * nie ma — treść składa się na płótnie kreatora.
 *
 * DWIE RZECZY, KTÓRE MUSZĄ BYĆ WIDOCZNE OD RAZU, bo bez nich lista kłamie:
 *
 *   1. Która wersja jest ŻYWA. Chip osi `site-publish` dostaje WYŁĄCZNIE ona;
 *      wersje robocze dostają zdanie, a nie chip udający stan spoza mapy (ta
 *      sama zasada, co w launcherze sprzed 0048).
 *   2. Że żywej wersji NIE DA SIĘ usunąć. Przycisk jest wyłączony i mówi, co
 *      zrobić — tym samym zdaniem, którym odmawia trigger w bazie. Interfejs,
 *      który pozwala kliknąć i dopiero potem tłumaczy odmowę, uczy operatora,
 *      że komunikaty błędów są normalną częścią pracy.
 *
 * Publikacja i usunięcie mają POTWIERDZENIE, bo obie zmieniają coś, czego
 * operator nie widzi z tego ekranu: publikacja przestawia sklep, usunięcie
 * kasuje treść bez kosza.
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
} from "@avably/ui";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Link } from "@/i18n/navigation";
import { createSite, deleteSite, publishSite, renameSite } from "@/lib/actions/site";
import { SecondaryStatusChip } from "@/lib/secondary-status";
import { MAX_SITES } from "@/lib/site-validation";

export interface SitePageRow {
  id: string;
  name: string;
  /** Czy TĘ wersję widzi klient. Jedyna prawda o żywości (ADR-093 D1). */
  live: boolean;
  publishedAtLabel: string | null;
  createdAtLabel: string | null;
}

export function SitePages({ rows }: { rows: SitePageRow[] }) {
  const t = useTranslations("site");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
    });
  }

  const limitReached = rows.length >= MAX_SITES;

  return (
    <div className="flex flex-col gap-6" data-site-pages>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm">{t("pages.subtitle")}</p>
        <NewPageDialog disabled={pending || limitReached} onCreate={(name) => run(() => createSite({ name }))} />
      </div>

      {limitReached ? (
        <p className="text-muted-foreground text-[13px] leading-[18px]">
          {t("pages.limitReached", { max: MAX_SITES })}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div data-site-pages-empty className="border-border flex flex-col items-start gap-3 rounded-lg border p-6">
          <p className="text-sm font-medium">{t("pages.emptyTitle")}</p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">{t("pages.emptyBody")}</p>
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              data-site-page={row.id}
              data-site-page-live={row.live ? "on" : "off"}
              /*
               * Kotwica z mockupu fazy 2 (`data-publish-status`) PRZENOSI SIĘ
               * z launchera na WIERSZ listy: stan publikacji przestał być
               * własnością ekranu, a stał się własnością wersji strony.
               * Kontrakt spójności ekranów dalej ją znajduje.
               */
              data-publish-status
              className="border-border flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{row.name}</span>
                {row.live ? (
                  <SecondaryStatusChip axis="site-publish" value="published" />
                ) : (
                  <span className="text-muted-foreground text-[13px] leading-[18px]">
                    {t("pages.statusDraft")}
                  </span>
                )}
              </div>

              <p className="text-muted-foreground text-[13px] leading-[18px]">
                {row.live && row.publishedAtLabel
                  ? t("pages.publishedAt", { date: row.publishedAtLabel })
                  : /*
                     * Zdanie o wersji roboczej mówi o TERAŹNIEJSZOŚCI, a nie
                     * o historii — i to jest poprawka znaleziona na weryfikacji
                     * przeglądarkowej. Dotychczasowe `publish.notPublished`
                     * („strona nie była jeszcze publikowana") jest po 0048
                     * FAŁSZEM dla wersji, która była w sklepie i została
                     * zastąpiona: `published_at` zdejmujemy przy przełączeniu
                     * (świadomy koszt D1), więc historii z tej kolumny już nie
                     * odczytamy. Zdanie o stanie bieżącym jest prawdziwe zawsze.
                     */
                    t("pages.notLive")}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button asChild type="button" size="sm">
                  <Link href={`/strona/${row.id}/kreator`} data-open-builder={row.id}>
                    {t("builder.open")}
                  </Link>
                </Button>

                {/*
                  * Publikacja stoi przy KAŻDEJ wersji, także przy żywej, i to
                  * nie jest przeoczenie: dla wersji roboczej znaczy „przełącz
                  * na nią sklep", a dla żywej — „wypuść do klientów zmiany,
                  * które w niej zrobiłem". To drugie jest podstawowym obiegiem
                  * od K5a i zniknięcie go razem z listą byłoby regresem.
                  * Różnicę niesie treść potwierdzenia, nie obecność przycisku.
                  */}
                <PublishDialog
                  disabled={pending}
                  live={row.live}
                  name={row.name}
                  liveName={rows.find((other) => other.live && other.id !== row.id)?.name ?? null}
                  onConfirm={() => run(() => publishSite(row.id))}
                />

                <RenameDialog
                  disabled={pending}
                  current={row.name}
                  onRename={(name) => run(() => renameSite({ siteId: row.id, name }))}
                />

                {row.live ? (
                  <Button type="button" size="sm" variant="ghost" disabled data-delete-site-blocked={row.id}>
                    {t("pages.deleteBlocked")}
                  </Button>
                ) : (
                  <DeleteDialog
                    disabled={pending}
                    name={row.name}
                    onConfirm={() => run(() => deleteSite(row.id))}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Nowa wersja — nazwa jest wymagana od razu, bo lista bez etykiet jest nieużywalna. */
function NewPageDialog({ disabled, onCreate }: { disabled: boolean; onCreate: (name: string) => void }) {
  const t = useTranslations("site");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(t("pages.defaultName"));
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={disabled} data-new-site>
          <Plus className="size-4" aria-hidden />
          {t("pages.new")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.newTitle")}</DialogTitle>
          <DialogDescription>{t("pages.newBody")}</DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          maxLength={80}
          aria-label={t("pages.nameLabel")}
          onChange={(event) => setName(event.target.value)}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            data-new-site-confirm
            disabled={name.trim().length === 0}
            onClick={() => {
              onCreate(name.trim());
              setOpen(false);
            }}
          >
            {t("pages.newConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Potwierdzenie publikacji. Treść mówi o SKUTKU dla sklepu, a nie o czynności:
 * operator, który przełącza wersję, musi wiedzieć, że dotychczasowa strona
 * przestanie być publiczna — i że nie znika z panelu.
 */
function PublishDialog({
  disabled,
  live,
  name,
  liveName,
  onConfirm,
}: {
  disabled: boolean;
  /** Czy TA wersja jest już w sklepie — wtedy publikacja jest odświeżeniem, nie przełączeniem. */
  live: boolean;
  name: string;
  liveName: string | null;
  onConfirm: () => void;
}) {
  const t = useTranslations("site");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary" disabled={disabled} data-publish-site>
          {t("publish.publish")}
        </Button>
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

function RenameDialog({
  disabled,
  current,
  onRename,
}: {
  disabled: boolean;
  current: string;
  onRename: (name: string) => void;
}) {
  const t = useTranslations("site");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(current);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} data-rename-site>
          {t("pages.rename")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.renameTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          maxLength={80}
          aria-label={t("pages.nameLabel")}
          onChange={(event) => setName(event.target.value)}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            data-rename-site-confirm
            disabled={name.trim().length === 0}
            onClick={() => {
              onRename(name.trim());
              setOpen(false);
            }}
          >
            {t("pages.renameConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Potwierdzenie usunięcia. Zdanie „klienci nigdy jej nie widzieli, więc
 * w sklepie nic się nie zmieni" jest PRAWDZIWE dokładnie dlatego, że żywej
 * wersji usunąć się nie da (trigger 0048) — gdyby dało, byłoby kłamstwem.
 */
function DeleteDialog({
  disabled,
  name,
  onConfirm,
}: {
  disabled: boolean;
  name: string;
  onConfirm: () => void;
}) {
  const t = useTranslations("site");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} data-delete-site>
          {t("pages.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.deleteTitle", { name })}</DialogTitle>
          <DialogDescription>{t("pages.deleteBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" variant="destructive" data-delete-site-confirm onClick={onConfirm}>
              {t("pages.deleteConfirm")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
